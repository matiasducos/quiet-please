import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'
import { withCronLogging } from '@/lib/cron-logger'
import { insertNotifications } from '@/lib/notifications'
import { sendAutoPredsEmail } from '@/lib/email'
import { getTournamentISOWeeks } from '@/lib/utils/iso-week'
import { generateAutoPicks } from '@/lib/tennis/auto-predict'
import { getPredictableStatuses, isManualLockMode } from '@/lib/app-settings'
import type { DrawMatch } from '@/lib/tennis/types'

// Allow up to 60 s — need headroom for multiple user × tournament combos
export const maxDuration = 60

// Category priority: higher rank = wins the weekly slot
const CATEGORY_RANK: Record<string, number> = {
  grand_slam: 4,
  masters_1000: 3,
  '500': 2,
  '250': 1,
}

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronLogging('auto-predict', async () => {
    const supabase = createAdminClient()

    // ── 1. Find eligible tournaments ────────────────────────────────────────
    // Must have a draw with players and a surface set.
    // Statuses are determined by the app-wide prediction mode setting:
    //   'anytime' → accepting_predictions + in_progress
    //   'pre_tournament' → accepting_predictions only
    const predictableStatuses = await getPredictableStatuses()
    const { data: tournaments, error: tErr } = await supabase
      .from('tournaments')
      .select('id, external_id, name, tour, category, surface, location, flag_emoji, starts_at, ends_at, status')
      .in('status', predictableStatuses)
      .not('surface', 'is', null)

    if (tErr) throw new Error(`Tournaments query failed: ${tErr.message}`)
    if (!tournaments?.length) {
      return { status: 200, body: { message: 'No eligible tournaments', processed: 0 } }
    }

    // Fetch draws + match results for these tournaments
    const tournamentIds = tournaments.map(t => t.id)
    const [{ data: draws }, { data: allMatchResults }] = await Promise.all([
      supabase
        .from('draws')
        .select('tournament_id, bracket_data, locked_matches, synced_at')
        .in('tournament_id', tournamentIds),
      supabase
        .from('match_results')
        .select('tournament_id, external_match_id, winner_external_id')
        .in('tournament_id', tournamentIds),
    ])

    if (!draws?.length) {
      return { status: 200, body: { message: 'No draws found', processed: 0 } }
    }

    // Build match results map per tournament: matchId → winnerExternalId
    const resultsMap = new Map<string, Record<string, string>>()
    for (const r of allMatchResults ?? []) {
      if (!resultsMap.has(r.tournament_id)) resultsMap.set(r.tournament_id, {})
      resultsMap.get(r.tournament_id)![r.external_match_id] = r.winner_external_id
    }

    const drawMap = new Map(draws.map(d => [d.tournament_id, d]))

    // Check which tournaments already had successful auto-predict runs
    // (runs that actually created predictions)
    const { data: existingRuns } = await supabase
      .from('auto_predict_runs')
      .select('tournament_id, created_at, predictions_created, predictions_updated')
      .in('tournament_id', tournamentIds)
      .order('created_at', { ascending: false })

    // Latest run per tournament
    const latestRunMap = new Map<string, { created_at: string; had_predictions: boolean }>()
    for (const run of existingRuns ?? []) {
      if (!latestRunMap.has(run.tournament_id)) {
        latestRunMap.set(run.tournament_id, {
          created_at: run.created_at,
          had_predictions: (run.predictions_created ?? 0) > 0 || (run.predictions_updated ?? 0) > 0,
        })
      }
    }

    // Filter to tournaments needing processing.
    // Once auto-predictions are created and locked, they are FINAL — no re-runs.
    // Eligible if:
    //  - No successful run exists (never processed, or all previous runs had 0 predictions)
    //  - Draw changed since last run (player withdrawal / lucky loser)
    const eligibleTournaments = tournaments.filter(t => {
      const draw = drawMap.get(t.id)
      if (!draw) return false

      // Check draw has actual players (not just a shell)
      const matches = ((draw.bracket_data as any)?.matches ?? []) as DrawMatch[]
      const hasPlayers = matches.some(m => m.player1 !== null || m.player2 !== null)
      if (!hasPlayers) return false

      const lastRun = latestRunMap.get(t.id)
      if (!lastRun) return true // Never run before

      // Re-run if previous run produced 0 predictions (new users/configs may exist now)
      if (!lastRun.had_predictions) return true

      // Re-run if draw was synced more recently (draw change — player withdrawal)
      if (new Date(draw.synced_at) > new Date(lastRun.created_at)) return true

      return false
    })

    if (!eligibleTournaments.length) {
      return { status: 200, body: { message: 'All tournaments already processed', processed: 0 } }
    }

    // ── 2. Fetch auto-predict users + their player configs ──────────────────
    const { data: enabledUsers } = await supabase
      .from('users')
      .select('id')
      .eq('auto_predict_enabled', true)

    if (!enabledUsers?.length) {
      return { status: 200, body: { message: 'No users with auto-predict enabled', processed: 0 } }
    }

    const userIds = enabledUsers.map(u => u.id)

    // Batch fetch all player configs for these users
    const { data: allPlayerConfigs } = await supabase
      .from('auto_predict_players')
      .select('user_id, tour, surface, player_external_id, priority')
      .in('user_id', userIds)
      .order('priority', { ascending: true })

    // Group configs by user → tour → surface
    type PlayerConfig = { player_external_id: string; priority: number }
    const userConfigs = new Map<string, Map<string, { default: PlayerConfig[]; hard: PlayerConfig[]; clay: PlayerConfig[]; grass: PlayerConfig[] }>>()

    for (const row of allPlayerConfigs ?? []) {
      if (!userConfigs.has(row.user_id)) userConfigs.set(row.user_id, new Map())
      const tourMap = userConfigs.get(row.user_id)!
      if (!tourMap.has(row.tour)) tourMap.set(row.tour, { default: [], hard: [], clay: [], grass: [] })
      const surfaceMap = tourMap.get(row.tour)!
      const surface = (row.surface ?? 'default') as keyof typeof surfaceMap
      surfaceMap[surface].push({ player_external_id: row.player_external_id, priority: row.priority })
    }

    // ── 3. Fetch existing predictions + weekly slots for these users ────────
    const { data: existingPredictions } = await supabase
      .from('predictions')
      .select('id, user_id, tournament_id, is_fully_locked')
      .in('user_id', userIds)
      .in('tournament_id', tournamentIds)
      .is('challenge_id', null)

    const predMap = new Map<string, { id: string; is_fully_locked: boolean }>()
    for (const pred of existingPredictions ?? []) {
      predMap.set(`${pred.user_id}:${pred.tournament_id}`, {
        id: pred.id,
        is_fully_locked: pred.is_fully_locked,
      })
    }

    // ── 4. Process each tournament × user ───────────────────────────────────
    const results: Array<{ tournament: string; users: number; created: number; updated: number; errors: string[]; skipped?: Array<{ userId: string; reason: string }> }> = []
    const allNotifications: Array<{ user_id: string; type: string; tournament_id: string; meta: Record<string, unknown> }> = []

    for (const tournament of eligibleTournaments) {
      const draw = drawMap.get(tournament.id)!
      const matches = ((draw.bracket_data as any)?.matches ?? []) as DrawMatch[]
      const tournamentResult = { tournament: tournament.name, users: 0, created: 0, updated: 0, errors: [] as string[] }

      // Pre-compute weekly slot info for this tournament
      let weeks: Array<{ year: number; week: number }> = []
      if (tournament.starts_at && tournament.ends_at) {
        weeks = getTournamentISOWeeks(tournament.starts_at, tournament.ends_at)
      }

      // Track skip reasons for debugging
      const skipped: Array<{ userId: string; reason: string }> = []

      for (const userId of userIds) {
        try {
          // a. Resolve player list for this user + tournament
          const tourConfigs = userConfigs.get(userId)?.get(tournament.tour)
          if (!tourConfigs) {
            skipped.push({ userId, reason: `no_config_for_${tournament.tour}` })
            continue
          }

          // Surface-specific override → default fallback
          const surface = tournament.surface as string
          const surfacePlayers = (tourConfigs as any)[surface] as PlayerConfig[] | undefined
          const priorityPlayers = (surfacePlayers && surfacePlayers.length > 0)
            ? surfacePlayers
            : tourConfigs.default

          if (!priorityPlayers || priorityPlayers.length === 0) {
            skipped.push({ userId, reason: 'no_players_configured' })
            continue
          }

          // b. Check if user already has a fully-locked prediction — immutable, never overwrite
          const existingPred = predMap.get(`${userId}:${tournament.id}`)
          if (existingPred?.is_fully_locked) {
            skipped.push({ userId, reason: 'already_fully_locked' })
            continue
          }

          // c. Weekly slot check
          if (weeks.length > 0) {
            const circuit = tournament.tour
            const weekFilters = weeks.map(w =>
              `and(iso_year.eq.${w.year},iso_week.eq.${w.week})`
            ).join(',')

            const { data: conflicts } = await supabase
              .from('weekly_slots')
              .select('tournament_id, tournaments(category)')
              .eq('user_id', userId)
              .eq('circuit', circuit)
              .neq('tournament_id', tournament.id)
              .or(weekFilters)
              .limit(1)

            if (conflicts && conflicts.length > 0) {
              const existingCategory = (conflicts[0].tournaments as any)?.category as string
              const existingRank = CATEGORY_RANK[existingCategory] ?? 0
              const newRank = CATEGORY_RANK[tournament.category] ?? 0

              if (newRank <= existingRank) {
                skipped.push({ userId, reason: `weekly_slot_conflict_${existingCategory}` })
                continue
              }

              // Higher priority: delete old weekly slots and prediction
              const oldTournamentId = conflicts[0].tournament_id
              await supabase
                .from('weekly_slots')
                .delete()
                .eq('user_id', userId)
                .eq('circuit', circuit)
                .eq('tournament_id', oldTournamentId)

              await supabase
                .from('predictions')
                .delete()
                .eq('user_id', userId)
                .eq('tournament_id', oldTournamentId)
                .is('challenge_id', null)
            }
          }

          // d. Generate auto picks (pass match results for in-progress tournaments)
          const playerIds = priorityPlayers.map(p => p.player_external_id)
          const tournamentResults = resultsMap.get(tournament.id) ?? {}
          const autoResult = generateAutoPicks(
            matches,
            priorityPlayers.map(p => ({ externalId: p.player_external_id, priority: p.priority })),
            tournamentResults,
          )

          if (!autoResult) {
            // Enhanced diagnostics: find where configured players appear in the draw
            const playerMatches = matches.filter(m =>
              playerIds.includes(m.player1?.externalId ?? '') || playerIds.includes(m.player2?.externalId ?? '')
            ).map(m => `${m.round}:${m.matchId}(${m.player1?.externalId ?? 'null'} vs ${m.player2?.externalId ?? 'null'})`)

            const roundCounts = matches.reduce((acc, m) => {
              acc[m.round] = (acc[m.round] ?? 0) + 1
              return acc
            }, {} as Record<string, number>)

            skipped.push({
              userId,
              reason: `no_picks_generated (configured: [${playerIds.join(',')}], total_matches: ${matches.length}, rounds: ${JSON.stringify(roundCounts)}, player_appears_in: [${playerMatches.join('; ')}])`,
            })
            continue
          }

          let { picks, pickSources } = autoResult

          // Strip admin-locked matches from auto-picks (manual_lock mode)
          if (await isManualLockMode()) {
            const adminLocked = (draw.locked_matches as Record<string, string>) ?? {}
            for (const matchId of Object.keys(adminLocked)) {
              delete picks[matchId]
              delete pickSources[matchId]
            }
            if (Object.keys(picks).length === 0) {
              skipped.push({ userId, reason: 'all_matches_admin_locked' })
              continue
            }
          }

          const now = new Date().toISOString()

          // Build pick_locks: every predicted match gets 'auto_lock_all'
          const pickLocks: Record<string, string> = {}
          for (const matchId of Object.keys(picks)) {
            pickLocks[matchId] = 'auto_lock_all'
          }

          // e. Upsert prediction
          tournamentResult.users++

          if (existingPred) {
            // UPDATE existing unlocked draft prediction — replace and lock.
            // (Locked predictions are already skipped above, so this only runs for drafts.)
            const { error } = await supabase
              .from('predictions')
              .update({
                picks,
                pick_sources: pickSources,
                pick_locks: pickLocks,
                is_fully_locked: true,
                fully_locked_at: now,
                updated_at: now,
              })
              .eq('id', existingPred.id)

            if (error) {
              tournamentResult.errors.push(`Update ${userId}: ${error.message}`)
              continue
            }
            tournamentResult.updated++
          } else {
            // INSERT new prediction
            const { error } = await supabase
              .from('predictions')
              .insert({
                user_id: userId,
                tournament_id: tournament.id,
                picks,
                pick_sources: pickSources,
                pick_locks: pickLocks,
                is_fully_locked: true,
                fully_locked_at: now,
                submitted_at: now,
                updated_at: now,
              })

            if (error) {
              tournamentResult.errors.push(`Insert ${userId}: ${error.message}`)
              continue
            }
            tournamentResult.created++
          }

          // f. Upsert weekly slots
          if (weeks.length > 0) {
            const slotRows = weeks.map(w => ({
              user_id: userId,
              circuit: tournament.tour,
              iso_year: w.year,
              iso_week: w.week,
              tournament_id: tournament.id,
            }))
            await supabase
              .from('weekly_slots')
              .upsert(slotRows, { onConflict: 'user_id,circuit,iso_year,iso_week' })
          }

          // g. Queue notification
          allNotifications.push({
            user_id: userId,
            type: 'auto_predictions_generated',
            tournament_id: tournament.id,
            meta: {
              tournament_name: tournament.name,
              tournament_location: tournament.location ?? null,
              tournament_flag_emoji: tournament.flag_emoji ?? null,
              picks_count: Object.keys(picks).length,
            },
          })
        } catch (err) {
          Sentry.captureException(err)
          tournamentResult.errors.push(`User ${userId}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Insert audit row for this tournament
      await supabase.from('auto_predict_runs').insert({
        tournament_id: tournament.id,
        triggered_by: latestRunMap.has(tournament.id) ? 'draw_change' : 'cron',
        users_processed: tournamentResult.users,
        predictions_created: tournamentResult.created,
        predictions_updated: tournamentResult.updated,
        errors: tournamentResult.errors.length > 0 ? tournamentResult.errors : null,
      })

      results.push({ ...tournamentResult, skipped })
    }

    // Bulk insert notifications
    if (allNotifications.length > 0) {
      await insertNotifications(allNotifications)
    }

    // Fire-and-forget emails for auto-prediction notifications
    if (allNotifications.length > 0) {
      const emailUserIds = [...new Set(allNotifications.map(n => n.user_id))]
      const { data: emailPrefs } = await supabase
        .from('users')
        .select('id, email_notifications, unsubscribe_token')
        .in('id', emailUserIds)
      const prefsMap = new Map((emailPrefs ?? []).map((p: { id: string; email_notifications: boolean | null; unsubscribe_token: string | null }) => [p.id, p]))

      const sendEmails = async () => {
        for (let i = 0; i < allNotifications.length; i += 10) {
          await Promise.allSettled(
            allNotifications.slice(i, i + 10).map(async (notif) => {
              try {
                const prefs = prefsMap.get(notif.user_id)
                if (prefs?.email_notifications === false) return
                const { data: { user: authUser } } = await supabase.auth.admin.getUserById(notif.user_id)
                if (!authUser?.email) return
                await sendAutoPredsEmail({
                  to: authUser.email,
                  tournamentName: (notif.meta?.tournament_name as string) ?? 'a tournament',
                  tournamentId: notif.tournament_id,
                  picksCount: (notif.meta?.picks_count as number) ?? 0,
                  unsubscribeToken: prefs?.unsubscribe_token ?? '',
                })
              } catch (e) {
                console.error(`[auto-predict] email error for ${notif.user_id}:`, e)
                Sentry.captureException(e)
              }
            }),
          )
        }
      }
      sendEmails().catch(e => { console.error('[auto-predict] email batch error:', e); Sentry.captureException(e) })
    }

    const totalCreated = results.reduce((s, r) => s + r.created, 0)
    const totalUpdated = results.reduce((s, r) => s + r.updated, 0)

    return {
      status: 200,
      body: {
        message: 'Auto-predict complete',
        tournaments: results.length,
        predictions_created: totalCreated,
        predictions_updated: totalUpdated,
        details: results,
      },
    }
  })
}
