/**
 * Live status sync cron — polls DSG for match status updates
 * and auto-locks matches that have started.
 *
 * Triggered every 2 minutes by an external cron service (cron-job.org)
 * or manually from the admin panel.
 *
 * Only runs when prediction_mode === 'realtime'. Exits early otherwise.
 *
 * Flow:
 *   1. Call get_matches_updates once (single API call for ALL competitions)
 *   2. Group matches by competition_id
 *   3. For each in-progress tournament with a DSG competition ID:
 *      - Filter DSG matches for that competition
 *      - Map DSG matches → bracket matches via player_id_map
 *      - Auto-lock started matches in draws.locked_matches
 */

import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDSGClient, isDSGConfigured } from '@/lib/tennis/providers/dsg'
import type { DSGMatch } from '@/lib/tennis/providers/dsg'
import { getDsgToApiTennisMap } from '@/lib/tennis/player-mapping'
import { findMatchesToLock } from '@/lib/tennis/live-status'
import type { DSGLiveMatch } from '@/lib/tennis/live-status'
import { withCronLogging } from '@/lib/cron-logger'
import { getPredictionMode } from '@/lib/app-settings'
import type { DrawMatch } from '@/lib/tennis/types'

export const maxDuration = 30  // 30s budget — this runs every 2 min

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false  // Fail closed
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

/**
 * Normalize a raw DSGMatch from get_matches_updates to our DSGLiveMatch shape.
 * Round comes from match_extra.round.round_name in the updates endpoint.
 */
function normalizeDsgMatch(m: DSGMatch): DSGLiveMatch {
  return {
    match_id: m.match_id ?? '',
    status: m.status ?? '',
    contestant_a_id: m.contestant_a_id ?? '',
    contestant_b_id: m.contestant_b_id ?? '',
    round_name: m.match_extra?.round?.round_name ?? '',
    competition_id: m.match_extra?.competition?.competition_id,
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronLogging('sync-live-status', async () => {
    // ── Gate: only run in realtime mode ────────────────────────────────────
    const mode = await getPredictionMode()
    if (mode !== 'realtime') {
      return {
        status: 200,
        body: { message: `Skipped — prediction mode is "${mode}", not "realtime"`, mode },
      }
    }

    if (!isDSGConfigured()) {
      return {
        status: 200,
        body: { message: 'Skipped — DSG credentials not configured' },
      }
    }

    const supabase = createAdminClient()
    const dsg = getDSGClient()

    // ── 1. Get eligible tournaments ───────────────────────────────────────
    const { data: tournaments, error: tErr } = await supabase
      .from('tournaments')
      .select('id, name, dsg_competition_id')
      .eq('status', 'in_progress')
      .not('dsg_competition_id', 'is', null)

    if (tErr) throw tErr

    if (!tournaments?.length) {
      return {
        status: 200,
        body: { message: 'No in-progress tournaments with DSG mapping', tournaments_checked: 0 },
      }
    }

    // ── 2. Load verified player mapping (shared across all tournaments) ───
    const dsgToApiMap = await getDsgToApiTennisMap()
    const mappingCount = Object.keys(dsgToApiMap).length

    if (mappingCount === 0) {
      return {
        status: 200,
        body: { message: 'No verified player mappings found — cannot match DSG players', tournaments_checked: 0 },
      }
    }

    // ── 3. Single DSG API call: fetch recent match updates ────────────────
    let allDsgMatches: DSGMatch[]
    try {
      allDsgMatches = await dsg.getMatchUpdates(5)  // last 5 minutes
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'sync-live-status', step: 'fetch-updates' } })
      throw err
    }

    // Group by competition_id for efficient per-tournament processing
    const byCompetition = new Map<string, DSGLiveMatch[]>()
    for (const raw of allDsgMatches) {
      const normalized = normalizeDsgMatch(raw)
      const compId = normalized.competition_id
      if (!compId) continue
      if (!byCompetition.has(compId)) byCompetition.set(compId, [])
      byCompetition.get(compId)!.push(normalized)
    }

    // ── 4. Process each tournament ────────────────────────────────────────
    const results: Array<{
      name: string
      checked: number
      locked: number
      newLocks: string[]
      errors: string[]
    }> = []

    for (const tournament of tournaments) {
      const tournamentResult = {
        name: tournament.name ?? 'Unknown',
        checked: 0,
        locked: 0,
        newLocks: [] as string[],
        errors: [] as string[],
      }

      try {
        // Filter DSG matches for this competition
        const dsgMatchesForTournament = byCompetition.get(tournament.dsg_competition_id!) ?? []
        tournamentResult.checked = dsgMatchesForTournament.length

        if (dsgMatchesForTournament.length === 0) {
          results.push(tournamentResult)
          continue
        }

        // Fetch bracket data + current locks
        const { data: drawRow, error: drawErr } = await supabase
          .from('draws')
          .select('bracket_data, locked_matches')
          .eq('tournament_id', tournament.id)
          .single()

        if (drawErr || !drawRow?.bracket_data) {
          tournamentResult.errors.push(drawErr?.message ?? 'No bracket data found')
          results.push(tournamentResult)
          continue
        }

        const bracketData = drawRow.bracket_data as { matches: DrawMatch[] }
        const bracketMatches = bracketData.matches ?? []
        const currentLocks = (drawRow.locked_matches as Record<string, string>) ?? {}

        // Find matches to lock
        const toLock = findMatchesToLock(
          dsgMatchesForTournament,
          bracketMatches,
          dsgToApiMap,
          currentLocks,
        )

        if (toLock.length > 0) {
          // Merge new locks into existing (additive — never removes locks)
          const now = new Date().toISOString()
          const updatedLocks = { ...currentLocks }
          for (const lock of toLock) {
            updatedLocks[lock.matchId] = now
          }

          const { error: updateErr } = await supabase
            .from('draws')
            .update({ locked_matches: updatedLocks })
            .eq('tournament_id', tournament.id)

          if (updateErr) {
            tournamentResult.errors.push(`Failed to write locks: ${updateErr.message}`)
          } else {
            tournamentResult.locked = toLock.length
            tournamentResult.newLocks = toLock.map(l => `${l.matchId} (${l.reason})`)
            console.log(
              `[sync-live-status] Auto-locked ${toLock.length} matches for ${tournament.name}: ` +
              tournamentResult.newLocks.join(', ')
            )
          }
        }

        // Write audit log
        await supabase.from('dsg_sync_log').insert({
          tournament_id: tournament.id,
          matches_checked: tournamentResult.checked,
          matches_locked: tournamentResult.locked,
          errors: tournamentResult.errors.length > 0 ? tournamentResult.errors : [],
        })

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        tournamentResult.errors.push(msg)
        Sentry.captureException(err, {
          tags: { cron: 'sync-live-status', tournament: tournament.name },
        })
      }

      results.push(tournamentResult)
    }

    const totalLocked = results.reduce((sum, r) => sum + r.locked, 0)
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0)

    return {
      status: totalErrors > 0 && totalLocked === 0 ? 207 : 200,
      body: {
        message: 'Live status sync complete',
        mode: 'realtime',
        player_mappings: mappingCount,
        dsg_matches_fetched: allDsgMatches.length,
        tournaments_checked: tournaments.length,
        total_matches_locked: totalLocked,
        total_errors: totalErrors,
        results,
      },
    }
  })
}
