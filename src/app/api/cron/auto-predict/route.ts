import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'
import { withCronLogging } from '@/lib/cron-logger'
import { insertNotifications } from '@/lib/notifications'
import { getTournamentISOWeeks } from '@/lib/utils/iso-week'
import { generateAutoPicks } from '@/lib/tennis/auto-predict'
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
    // Must be accepting_predictions, have a draw with players, and have a surface set
    // Include both accepting_predictions and in_progress tournaments.
    // In-progress: a user might be enabled after the tournament started —
    // auto-picks are still useful for unplayed matches.
    const { data: tournaments, error: tErr } = await supabase
      .from('tournaments')
      .select('id, external_id, name, tour, category, surface, location, flag_emoji, starts_at, ends_at')
      .in('status', ['accepting_predictions', 'in_progress'])
      .not('surface', 'is', null)

    if (tErr) throw new Error(`Tournaments query failed: ${tErr.message}`)
    if (!tournaments?.length) {
      return { status: 200, body: { message: 'No eligible tournaments', processed: 0 } }
    }

    // Fetch draws for these tournaments
    const tournamentIds = tournaments.map(t => t.id)
    const { data: draws } = await supabase
      .from('draws')
      .select('tournament_id, bracket_data, synced_at')
      .in('tournament_id', tournamentIds)

    if (!draws?.length) {
      return { status: 200, body: { message: 'No draws found', processed: 0 } }
    }

    const drawMap = new Map(draws.map(d => [d.tournament_id, d]))

    // Check which tournaments already had auto-predict runs
    const { data: existingRuns } = await supabase
      .from('auto_predict_runs')
      .select('tournament_id, created_at')
      .in('tournament_id', tournamentIds)
      .eq('triggered_by', 'cron')
      .order('created_at', { ascending: false })

    // Latest run per tournament
    const latestRunMap = new Map<string, string>()
    for (const run of existingRuns ?? []) {
      if (!latestRunMap.has(run.tournament_id)) {
        latestRunMap.set(run.tournament_id, run.created_at)
      }
    }

    // Filter to tournaments needing processing:
    // Either no run exists, OR draw was synced more recently than the last run
    const eligibleTournaments = tournaments.filter(t => {
      const draw = drawMap.get(t.id)
      if (!draw) return false

      // Check draw has actual players (not just a shell)
      const matches = ((draw.bracket_data as any)?.matches ?? []) as DrawMatch[]
      const hasPlayers = matches.some(m => m.player1 !== null || m.player2 !== null)
      if (!hasPlayers) return false

      const lastRunAt = latestRunMap.get(t.id)
      if (!lastRunAt) return true // Never run before

      // Re-run if draw was synced more recently (draw change)
      return new Date(draw.synced_at) > new Date(lastRunAt)
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
      predMap.set(`${pred.user_id}:${pred.tournament_id}`, { id: pred.id, is_fully_locked: pred.is_fully_locked })
    }

    // ── 4. Process each tournament × user ───────────────────────────────────
    const results: Array<{ tournament: string; users: number; created: number; updated: number; errors: string[] }> = []
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

      for (const userId of userIds) {
        try {
          // a. Resolve player list for this user + tournament
          const tourConfigs = userConfigs.get(userId)?.get(tournament.tour)
          if (!tourConfigs) continue // User has no config for this tour

          // Surface-specific override → default fallback
          const surface = tournament.surface as string
          const surfacePlayers = (tourConfigs as any)[surface] as PlayerConfig[] | undefined
          const priorityPlayers = (surfacePlayers && surfacePlayers.length > 0)
            ? surfacePlayers
            : tourConfigs.default

          if (!priorityPlayers || priorityPlayers.length === 0) continue

          // b. Check if user already has a fully-locked prediction (manual lock — respect it)
          const existingPred = predMap.get(`${userId}:${tournament.id}`)
          if (existingPred?.is_fully_locked) continue

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

              if (newRank <= existingRank) continue // Lower or equal priority — skip

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

          // d. Generate auto picks
          const autoResult = generateAutoPicks(
            matches,
            priorityPlayers.map(p => ({ externalId: p.player_external_id, priority: p.priority })),
          )

          if (!autoResult) continue // No picks possible

          const { picks, pickSources } = autoResult
          const now = new Date().toISOString()

          // Build pick_locks: every predicted match gets 'auto_lock_all'
          const pickLocks: Record<string, string> = {}
          for (const matchId of Object.keys(picks)) {
            pickLocks[matchId] = 'auto_lock_all'
          }

          // e. Upsert prediction
          tournamentResult.users++

          if (existingPred) {
            // UPDATE existing (unlocked) prediction
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

      results.push(tournamentResult)
    }

    // Bulk insert notifications
    if (allNotifications.length > 0) {
      await insertNotifications(allNotifications)
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
