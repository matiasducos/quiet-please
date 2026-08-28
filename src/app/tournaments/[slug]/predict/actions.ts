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
import { markReferralFirstPrediction } from '@/lib/referrals'

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
 * - Whole-round locks (lockRound) — the rest of the bracket stays editable
 * - Full bracket lock-all (lockAll)
 * - Importing global picks into a new challenge prediction (importFromGlobal)
 */
export async function savePrediction({
  tournamentId,
  picks,
  predictionId,
  challengeId = null,
  lockMatchIds,
  lockRound,
  lockAll = false,
  importFromGlobal = false,
}: {
  tournamentId: string
  picks: Record<string, string>
  predictionId: string | null
  challengeId?: string | null
  lockMatchIds?: string[]
  /**
   * Round code (R64, QF, …) to commit in full. The round's matches are resolved
   * from the draw rather than taken from the client, so a hand-crafted request
   * cannot lock a match in a round it does not belong to.
   */
  lockRound?: string
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
  } else if (lockRound) {
    // Whole-round lock. `is_fully_locked` stays false on purpose: this is the
    // point of the feature — commit the quarters, keep picking the semis.
    //
    // Only matches that actually carry a pick are locked. Locking an empty slot
    // would forfeit it for nothing, which is precisely the trap the round lock
    // exists to avoid; the UI warns about the empties instead.
    const { data: drawRow, error: drawErr } = await supabase
      .from('draws')
      .select('bracket_data')
      .eq('tournament_id', tournamentId)
      .single()

    if (drawErr || !drawRow?.bracket_data) {
      return { success: false, error: 'unknown', message: drawErr?.message ?? 'Draw not found' }
    }

    const roundMatchIds = new Set(
      ((drawRow.bracket_data as { matches?: Array<{ matchId: string; round: string }> }).matches ?? [])
        .filter(m => m.round === lockRound)
        .map(m => m.matchId),
    )

    pickLocksUpdate = {}
    for (const matchId of roundMatchIds) {
      if (!picks[matchId]) continue           // nothing to commit
      if (playedMatchIds.has(matchId)) continue // already decided
      pickLocksUpdate[matchId] = 'round'
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
      // First lock wins. A lock records when a pick stopped being changeable, so
      // a later one must not rewrite it — and now that the multiplier is gated on
      // committing *before* the result, overwriting would matter: 'auto' is what
      // the cron stamps on a played match, and letting a subsequent "lock all"
      // turn that into 'auto_lock_all' would back-date a commitment nobody made.
      // Same non-overwriting rule the cron itself follows.
      const merged = { ...((existingPred?.pick_locks as Record<string, string>) ?? {}) }
      for (const [matchId, lockType] of Object.entries(pickLocksUpdate)) {
        if (!merged[matchId]) merged[matchId] = lockType
      }
      row.pick_locks = merged
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

    // Referral attribution: if this is the invitee's first global prediction,
    // stamp the referrals row and award the inviter's next Recruiter tier.
    // Idempotent — re-runs on subsequent predictions no-op after the stamp.
    markReferralFirstPrediction(achAdmin, user.id)
      .catch(err => console.error('[savePrediction] referral first-pred error', err))
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

export type UnlockResult =
  | { success: true; withdrawn: number; alreadyUnlocked: boolean }
  | { success: false; error: 'tournament_closed' | 'opponent_locked' | 'not_found' | 'unknown'; message: string }

/**
 * Reopen a fully-locked bracket.
 *
 * "Lock all picks" used to be the end of the bracket — the FAQ said so, and so
 * did the button. That was the single most expensive piece of copy on the site:
 * new users read it as "submit", locked a first round, and never got their
 * tournament back.
 *
 * The state transition lives in Postgres (`unlock_prediction`, migration 094)
 * rather than here, because the RLS policy from 017 deliberately forbids
 * updating a locked row and should keep doing so — the alternative was to widen
 * that policy, which would also permit rewriting the picks on a locked bracket.
 * The function is the one narrow exception, scoped to auth.uid()'s own row.
 *
 * This wrapper adds only what the database has no business knowing: the
 * prediction-mode toggle, which can close global predictions before the
 * tournament's status does.
 */
export async function unlockPrediction(predictionId: string): Promise<UnlockResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'unknown', message: 'Not authenticated' }

  const rl = rateLimit(`unlock:${user.id}`, { maxRequests: 10, windowMs: 60_000 })
  if (rl.limited) return { success: false, error: 'unknown', message: `Too many requests. Try again in ${rl.retryAfter}s.` }

  // Read the row for the toggle check only — ownership is enforced inside the
  // function, which is why this select does not need to be trusted.
  const { data: pred } = await supabase
    .from('predictions')
    .select('id, tournament_id, challenge_id, tournaments(status)')
    .eq('id', predictionId)
    .eq('user_id', user.id)
    .single()

  if (!pred) return { success: false, error: 'not_found', message: 'Prediction not found' }

  // Same window as picking. A challenge ignores the toggle exactly as it does
  // in savePrediction — the two must agree, or we would reopen a bracket that
  // cannot then be saved.
  // PostgREST types an embedded to-one relation as an array in some shapes and
  // an object in others; both are read the same way here.
  const joined = pred.tournaments as { status?: string } | { status?: string }[] | null
  const status = (Array.isArray(joined) ? joined[0]?.status : joined?.status) ?? ''
  const allowed = pred.challenge_id
    ? ['accepting_predictions', 'in_progress'].includes(status)
    : await canPredictForStatus(status)

  if (!allowed) {
    return {
      success: false,
      error: 'tournament_closed',
      message: 'Predictions are closed for this tournament — unlocking would not let you change anything.',
    }
  }

  const { data, error } = await supabase.rpc('unlock_prediction', { p_prediction_id: predictionId })

  // Postgres errors here are ours, not the user's — a missing function, a
  // permissions slip. They render inside the bracket, so they say something a
  // person can act on and the detail goes to the server log.
  if (error) {
    console.error('[unlockPrediction] rpc error', error)
    return { success: false, error: 'unknown', message: 'Could not unlock your bracket just now. Please try again.' }
  }

  const result = (data ?? {}) as { ok?: boolean; error?: string; withdrawn?: number; already_unlocked?: boolean }

  if (!result.ok) {
    if (result.error === 'opponent_locked') {
      return {
        success: false,
        error: 'opponent_locked',
        message: 'Your opponent has locked, so both brackets are revealed. Unlocking now would mean picking with their bracket in front of you.',
      }
    }
    if (result.error === 'tournament_closed') {
      return { success: false, error: 'tournament_closed', message: 'This tournament is no longer accepting changes.' }
    }
    if (result.error === 'not_found') {
      return { success: false, error: 'not_found', message: 'Prediction not found' }
    }
    return { success: false, error: 'unknown', message: result.error ?? 'Unlock failed' }
  }

  revalidatePath(`/tournaments/${pred.tournament_id}`)
  if (pred.challenge_id) revalidatePath(`/challenges/${pred.challenge_id}`)

  trackServerEvent(user.id, 'prediction_unlocked', {
    tournament_id: pred.tournament_id,
    challenge_id: pred.challenge_id ?? undefined,
    type: pred.challenge_id ? 'challenge' : 'global',
    // How many streak commitments the unlock gave back. Zero means the bracket
    // was locked before anything had been played — the mis-click case.
    withdrawn: result.withdrawn ?? 0,
  })

  return {
    success: true,
    withdrawn: result.withdrawn ?? 0,
    alreadyUnlocked: result.already_unlocked === true,
  }
}

export type UnlockPicksResult =
  | { success: true; released: number }
  | { success: false; error: 'bracket_fully_locked' | 'tournament_closed' | 'not_found' | 'unknown'; message: string }

/**
 * Release the streak commitment on specific picks, or on a whole round.
 *
 * The companion to unlockPrediction. That one reverses "Lock all picks"; this
 * one reverses "Lock {round}" and "Lock pick" — which matter more, because the
 * round lock is the button this page recommends. Committing a round was a
 * one-way door for as long as the feature existed, and the bracket unlock did
 * not open it: that button only renders on a fully-locked bracket.
 *
 * Like lockRound, a round is resolved to its matches from the draw server-side,
 * so a hand-crafted request cannot reach across rounds. Unlocking is the less
 * dangerous direction, but the two should not disagree about what a round is.
 */
export async function unlockPicks({
  predictionId,
  matchIds,
  round,
}: {
  predictionId: string
  matchIds?: string[]
  round?: string
}): Promise<UnlockPicksResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'unknown', message: 'Not authenticated' }

  const rl = rateLimit(`unlockpicks:${user.id}`, { maxRequests: 20, windowMs: 60_000 })
  if (rl.limited) return { success: false, error: 'unknown', message: `Too many requests. Try again in ${rl.retryAfter}s.` }

  const { data: pred } = await supabase
    .from('predictions')
    .select('id, tournament_id, challenge_id, tournaments(status)')
    .eq('id', predictionId)
    .eq('user_id', user.id)
    .single()

  if (!pred) return { success: false, error: 'not_found', message: 'Prediction not found' }

  const joined = pred.tournaments as { status?: string } | { status?: string }[] | null
  const status = (Array.isArray(joined) ? joined[0]?.status : joined?.status) ?? ''
  const allowed = pred.challenge_id
    ? ['accepting_predictions', 'in_progress'].includes(status)
    : await canPredictForStatus(status)

  if (!allowed) {
    return { success: false, error: 'tournament_closed', message: 'Predictions are closed for this tournament.' }
  }

  let targets = matchIds ?? []

  if (round) {
    const { data: drawRow, error: drawErr } = await supabase
      .from('draws')
      .select('bracket_data')
      .eq('tournament_id', pred.tournament_id)
      .single()

    if (drawErr || !drawRow?.bracket_data) {
      return { success: false, error: 'unknown', message: drawErr?.message ?? 'Draw not found' }
    }

    targets = ((drawRow.bracket_data as { matches?: Array<{ matchId: string; round: string }> }).matches ?? [])
      .filter(m => m.round === round)
      .map(m => m.matchId)
  }

  if (targets.length === 0) return { success: true, released: 0 }

  const { data, error } = await supabase.rpc('unlock_picks', {
    p_prediction_id: predictionId,
    p_match_ids: targets,
  })

  if (error) {
    console.error('[unlockPicks] rpc error', error)
    return { success: false, error: 'unknown', message: 'Could not unlock those picks just now. Please try again.' }
  }

  const result = (data ?? {}) as { ok?: boolean; error?: string; released?: number }

  if (!result.ok) {
    if (result.error === 'bracket_fully_locked') {
      return {
        success: false,
        error: 'bracket_fully_locked',
        message: 'Your whole bracket is locked. Unlock the bracket first, which releases these picks with it.',
      }
    }
    if (result.error === 'tournament_closed') {
      return { success: false, error: 'tournament_closed', message: 'This tournament is no longer accepting changes.' }
    }
    if (result.error === 'not_found') {
      return { success: false, error: 'not_found', message: 'Prediction not found' }
    }
    return { success: false, error: 'unknown', message: result.error ?? 'Unlock failed' }
  }

  revalidatePath(`/tournaments/${pred.tournament_id}`)
  if (pred.challenge_id) revalidatePath(`/challenges/${pred.challenge_id}`)

  trackServerEvent(user.id, 'picks_unlocked', {
    tournament_id: pred.tournament_id,
    challenge_id: pred.challenge_id ?? undefined,
    scope: round ? 'round' : 'match',
    round: round ?? undefined,
    released: result.released ?? 0,
  })

  return { success: true, released: result.released ?? 0 }
}
