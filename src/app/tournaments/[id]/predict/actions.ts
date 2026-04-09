'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { getTournamentISOWeeks } from '@/lib/utils/iso-week'
import { insertNotifications } from '@/lib/notifications'
import { rateLimit } from '@/lib/rate-limit'
import { canPredictForStatus, isManualLockMode } from '@/lib/app-settings'
import { trackServerEvent } from '@/lib/posthog/server'
import { checkPredictionMilestones, checkEngagementAchievements, checkChallengeAchievements } from '@/lib/achievements/check'
import { notifyAchievements } from '@/lib/achievements/notify'

export type SaveResult =
  | { success: true; predictionId?: string }
  | { success: false; error: 'slot_taken'; conflictingTournamentName: string }
  | { success: false; error: 'played_matches'; matchIds: string[] }
  | { success: false; error: 'unknown'; message: string }

/**
 * Save or update a bracket prediction.
 *
 * Supports:
 * - Global predictions (challengeId = null) — affect leaderboard, leagues, rankings
 * - Challenge predictions (challengeId = UUID) — separate picks per challenge
 * - Per-pick voluntary locks (lockMatchIds)
 * - Full bracket lock-all (lockAll)
 * - Importing global picks into a new challenge prediction (importFromGlobal)
 */
export async function savePrediction({
  tournamentId,
  picks,
  predictionId,
  challengeId = null,
  lockMatchIds,
  lockAll = false,
  importFromGlobal = false,
}: {
  tournamentId: string
  picks: Record<string, string>
  predictionId: string | null
  challengeId?: string | null
  lockMatchIds?: string[]
  lockAll?: boolean
  importFromGlobal?: boolean
}): Promise<SaveResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'unknown', message: 'Not authenticated' }

  // Rate limit: 20 saves per minute per user
  const rl = rateLimit(`save:${user.id}`, { maxRequests: 20, windowMs: 60_000 })
  if (rl.limited) return { success: false, error: 'unknown', message: `Too many requests. Try again in ${rl.retryAfter}s.` }

  // ── 0. Verify tournament status is allowed under current prediction mode ──
  const { data: tournamentRow } = await supabase
    .from('tournaments')
    .select('status')
    .eq('id', tournamentId)
    .single()
  if (!tournamentRow) return { success: false, error: 'unknown', message: 'Tournament not found' }
  // Challenges always allow in_progress + accepting_predictions regardless of the
  // global prediction mode toggle — only standalone predictions respect the toggle.
  const allowed = challengeId
    ? ['accepting_predictions', 'in_progress'].includes(tournamentRow.status)
    : await canPredictForStatus(tournamentRow.status)
  if (!allowed) return { success: false, error: 'unknown', message: 'Predictions are closed for this tournament — the prediction window has passed.' }

  // ── 1. Guard against changing picks for played matches ─────────────────
  // Fetch match results for this tournament to determine which picks are frozen
  const { data: matchResultRows } = await supabase
    .from('match_results')
    .select('external_match_id')
    .eq('tournament_id', tournamentId)

  const playedMatchIds = new Set(
    (matchResultRows ?? []).map((r: any) => r.external_match_id)
  )

  // If the user is submitting changed picks for played matches, reject
  if (predictionId) {
    const { data: existingPred } = await supabase
      .from('predictions')
      .select('picks')
      .eq('id', predictionId)
      .single()

    if (existingPred) {
      const oldPicks = (existingPred.picks as Record<string, string>) ?? {}
      const changedPlayedMatches: string[] = []
      for (const matchId of playedMatchIds) {
        if (matchId in picks && matchId in oldPicks && picks[matchId] !== oldPicks[matchId]) {
          changedPlayedMatches.push(matchId)
        }
      }
      if (changedPlayedMatches.length > 0) {
        return { success: false, error: 'played_matches', matchIds: changedPlayedMatches }
      }
    }
  }

  // ── 1b. Admin match locks (manual_lock mode — applies to ALL prediction types) ─
  // Locked picks are SAVED (not stripped) but tagged so the scoring engine skips them.
  let adminLockedMatchIds: Set<string> = new Set()
  if (await isManualLockMode()) {
    const { data: drawRow } = await supabase
      .from('draws')
      .select('locked_matches')
      .eq('tournament_id', tournamentId)
      .single()

    const adminLocked = (drawRow?.locked_matches as Record<string, string>) ?? {}
    adminLockedMatchIds = new Set(Object.keys(adminLocked))
  }

  // ── 2. Build lock state ────────────────────────────────────────────────
  let pickLocksUpdate: Record<string, string> | undefined
  let isFullyLocked = false
  let fullyLockedAt: string | undefined

  if (lockAll) {
    // Lock entire bracket: stamp every current pick as "auto_lock_all"
    isFullyLocked = true
    fullyLockedAt = new Date().toISOString()
    pickLocksUpdate = {}
    for (const matchId of Object.keys(picks)) {
      pickLocksUpdate[matchId] = 'auto_lock_all'
    }
  } else if (lockMatchIds && lockMatchIds.length > 0) {
    // Per-pick voluntary lock: only lock specific matches
    // Don't allow locking matches that are already auto-locked (played)
    pickLocksUpdate = {}
    for (const matchId of lockMatchIds) {
      if (!playedMatchIds.has(matchId)) {
        pickLocksUpdate[matchId] = 'voluntary'
      }
    }
  }

  // ── 3. Build the row ──────────────────────────────────────────────────
  const row: Record<string, any> = {
    user_id:       user.id,
    tournament_id: tournamentId,
    picks,
    updated_at:    new Date().toISOString(),
  }
  if (challengeId) row.challenge_id = challengeId

  // Pick source tracking: all user-submitted picks are "manual"
  const newPickSources: Record<string, string> = {}
  for (const matchId of Object.keys(picks)) {
    newPickSources[matchId] = 'manual'
  }

  if (isFullyLocked) {
    row.is_fully_locked = true
    row.fully_locked_at = fullyLockedAt
  }
  // For INSERT path: set pick_locks directly on the row
  if (pickLocksUpdate) {
    row.pick_locks = pickLocksUpdate
  }

  // ── 4. UPDATE or INSERT ──────────────────────────────────────────────
  let insertedPredictionId: string | undefined

  if (predictionId) {
    // Merge lock state + pick sources + locked_picks: fetch existing, then merge
    const { data: existingPred } = await supabase
      .from('predictions')
      .select('picks, pick_locks, pick_sources, locked_picks')
      .eq('id', predictionId)
      .single()

    if (pickLocksUpdate) {
      const existingLocks = (existingPred?.pick_locks as Record<string, string>) ?? {}
      row.pick_locks = { ...existingLocks, ...pickLocksUpdate }
    }

    // Merge pick_sources: preserve existing "auto" for untouched matches,
    // override with "manual" for matches the user explicitly submitted
    const existingSources = (existingPred?.pick_sources as Record<string, string>) ?? {}
    row.pick_sources = { ...existingSources, ...newPickSources }

    // Build locked_picks: tag picks made on admin-locked matches
    const oldPicks = (existingPred?.picks as Record<string, string>) ?? {}
    const existingLockedPicks = new Set((existingPred?.locked_picks as string[]) ?? [])
    const newLockedPicks = new Set<string>()
    for (const matchId of adminLockedMatchIds) {
      if (!(matchId in picks)) continue
      // If pick existed before lock and hasn't changed, preserve its non-locked status
      if (oldPicks[matchId] && picks[matchId] === oldPicks[matchId] && !existingLockedPicks.has(matchId)) continue
      newLockedPicks.add(matchId)
    }
    // Also keep existing locked_picks for matches still in picks
    for (const matchId of existingLockedPicks) {
      if (matchId in picks) newLockedPicks.add(matchId)
    }
    row.locked_picks = Array.from(newLockedPicks)

    const { error } = await supabase
      .from('predictions')
      .update(row)
      .eq('id', predictionId)
      .eq('user_id', user.id)
      .eq('is_fully_locked', false)   // Can't update a fully locked prediction

    if (error) return { success: false, error: 'unknown', message: error.message }

  } else {
    // ── 5. INSERT new prediction ──────────────────────────────────────────

    // Import global picks into challenge prediction if requested
    if (importFromGlobal && challengeId) {
      const { data: globalPred } = await supabase
        .from('predictions')
        .select('picks')
        .eq('user_id', user.id)
        .eq('tournament_id', tournamentId)
        .is('challenge_id', null)
        .single()

      if (globalPred?.picks) {
        // Start with global picks, overlay any explicit picks the user sent
        const globalPicks = globalPred.picks as Record<string, string>
        row.picks = { ...globalPicks, ...picks }
      }
    }

    // Weekly slot enforcement: only for global (non-challenge) predictions
    // Manual tournaments and challenge predictions are exempt
    if (!challengeId) {
      const { data: tournament, error: tErr } = await supabase
        .from('tournaments')
        .select('tour, starts_at, ends_at, name, is_manual')
        .eq('id', tournamentId)
        .single()

      if (tErr || !tournament) {
        return { success: false, error: 'unknown', message: 'Tournament not found' }
      }

      if (!tournament.is_manual) {
        const circuit = tournament.tour as 'ATP' | 'WTA'
        const weeks = getTournamentISOWeeks(tournament.starts_at, tournament.ends_at)

        // Batch check: single query for all weeks instead of N separate queries
        if (weeks.length > 0) {
          const weekFilters = weeks.map(w =>
            `and(iso_year.eq.${w.year},iso_week.eq.${w.week})`
          ).join(',')
          const { data: conflicts } = await supabase
            .from('weekly_slots')
            .select('tournament_id, tournaments(name)')
            .eq('user_id', user.id)
            .eq('circuit', circuit)
            .neq('tournament_id', tournamentId)
            .or(weekFilters)
            .limit(1)

          if (conflicts && conflicts.length > 0) {
            const conflictingName = (conflicts[0].tournaments as any)?.name ?? 'another tournament'
            return { success: false, error: 'slot_taken', conflictingTournamentName: conflictingName }
          }
        }

        // Insert slot rows — use regular insert to catch unique constraint violations
        // from concurrent requests (the pre-check above is not atomic).
        const slotRows = weeks.map(w => ({
          user_id:       user.id,
          circuit,
          iso_year:      w.year,
          iso_week:      w.week,
          tournament_id: tournamentId,
        }))
        const { error: slotError } = await supabase
          .from('weekly_slots')
          .upsert(slotRows, { onConflict: 'user_id,circuit,iso_year,iso_week', ignoreDuplicates: false })
        if (slotError) {
          // Unique constraint violation = a concurrent request took the slot
          if (slotError.code === '23505') {
            // Re-query to get the conflicting tournament name for a user-friendly message
            const weekFilters = weeks.map(w =>
              `and(iso_year.eq.${w.year},iso_week.eq.${w.week})`
            ).join(',')
            const { data: raceConflicts } = await supabase
              .from('weekly_slots')
              .select('tournament_id, tournaments(name)')
              .eq('user_id', user.id)
              .eq('circuit', circuit)
              .neq('tournament_id', tournamentId)
              .or(weekFilters)
              .limit(1)
            const conflictingName = (raceConflicts?.[0]?.tournaments as any)?.name ?? 'another tournament'
            return { success: false, error: 'slot_taken', conflictingTournamentName: conflictingName }
          }
          return { success: false, error: 'unknown', message: slotError.message }
        }
      }
    }

    // Set initial pick_locks if any locks were requested
    if (pickLocksUpdate) {
      row.pick_locks = pickLocksUpdate
    }

    // Set pick_sources for new predictions (all manual)
    row.pick_sources = newPickSources

    // Tag picks made on admin-locked matches (new prediction — all locked picks are new)
    const finalPicks = row.picks as Record<string, string>
    const insertLockedPicks: string[] = []
    for (const matchId of adminLockedMatchIds) {
      if (matchId in finalPicks) insertLockedPicks.push(matchId)
    }
    row.locked_picks = insertLockedPicks

    const { data: newPred, error } = await supabase
      .from('predictions')
      .insert({ ...row, submitted_at: new Date().toISOString() } as any)
      .select('id')
      .single()
    if (error) return { success: false, error: 'unknown', message: error.message }

    insertedPredictionId = newPred?.id
  }

  revalidatePath(`/tournaments/${tournamentId}`)
  if (challengeId) revalidatePath('/challenges')

  // ── 6. Notifications ──────────────────────────────────────────────────────
  if (lockAll) {
    try {
      const admin = createAdminClient()

      if (challengeId) {
        // Notify challenge opponent that you locked your picks
        const [{ data: challenge }, { data: currentUserProfile }, { data: tournamentMeta }] = await Promise.all([
          admin.from('challenges').select('challenger_id, challenged_id').eq('id', challengeId).single(),
          admin.from('users').select('username').eq('id', user.id).single(),
          admin.from('tournaments').select('name, location, flag_emoji').eq('id', tournamentId).single(),
        ])
        if (challenge && currentUserProfile && tournamentMeta) {
          const opponentId = challenge.challenger_id === user.id
            ? challenge.challenged_id
            : challenge.challenger_id
          await insertNotifications([{
            user_id:       opponentId,
            type:          'challenge_picks_locked',
            tournament_id: tournamentId,
            meta: {
              username:        currentUserProfile.username,
              tournament_name: tournamentMeta.name,
              tournament_location: tournamentMeta.location ?? null,
              tournament_flag_emoji: tournamentMeta.flag_emoji ?? null,
              challenge_id:    challengeId,
            },
          }])
        }
      } else {
        // Notify friends that you locked your global picks
        const [{ data: friendships }, { data: currentUserProfile }, { data: tournamentMeta }] = await Promise.all([
          admin
            .from('friendships')
            .select('requester_id, addressee_id')
            .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
            .eq('status', 'accepted'),
          admin.from('users').select('username').eq('id', user.id).single(),
          admin.from('tournaments').select('name, location, flag_emoji').eq('id', tournamentId).single(),
        ])
        if (friendships && friendships.length > 0 && currentUserProfile && tournamentMeta) {
          const friendIds = friendships.map(f =>
            f.requester_id === user.id ? f.addressee_id : f.requester_id
          )
          await insertNotifications(
            friendIds.map(friendId => ({
              user_id:       friendId,
              type:          'friend_picks_locked',
              tournament_id: tournamentId,
              meta: {
                username:        currentUserProfile.username,
                tournament_name: tournamentMeta.name,
                tournament_location: tournamentMeta.location ?? null,
                tournament_flag_emoji: tournamentMeta.flag_emoji ?? null,
              },
            }))
          )
        }
      }
    } catch (e) {
      console.error('[savePrediction] lock notification error', e)
    }
  }

  trackServerEvent(user.id, 'prediction_submitted', {
    tournament_id: tournamentId,
    challenge_id: challengeId ?? undefined,
    type: challengeId ? 'challenge' : 'global',
    picks_count: Object.keys(picks).length,
  })

  // ── 7. Achievement checks (fire-and-forget) ─────────────────────────────
  if (!challengeId) {
    // Global prediction: check prediction milestones + engagement
    const achAdmin = createAdminClient()
    Promise.all([
      checkPredictionMilestones(achAdmin, user.id),
      checkEngagementAchievements(achAdmin, user.id, tournamentId),
    ]).then(([predResults, engResults]) => {
      notifyAchievements(achAdmin, [...predResults, ...engResults])
    }).catch(err => console.error('[savePrediction] achievement check error', err))
  } else {
    // Challenge prediction: check challenger achievement
    const achAdmin = createAdminClient()
    checkChallengeAchievements(achAdmin, user.id)
      .then(results => notifyAchievements(achAdmin, results))
      .catch(err => console.error('[savePrediction] challenge achievement check error', err))
  }

  return { success: true, predictionId: insertedPredictionId }
}

/**
 * Import global picks into a challenge prediction.
 * Returns the global picks map so the UI can pre-fill the bracket.
 */
export async function importGlobalPicks(
  tournamentId: string,
): Promise<{ picks: Record<string, string> } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: globalPred } = await supabase
    .from('predictions')
    .select('picks')
    .eq('user_id', user.id)
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)
    .single()

  if (!globalPred?.picks) {
    return { error: 'No global prediction found for this tournament' }
  }

  return { picks: globalPred.picks as Record<string, string> }
}
