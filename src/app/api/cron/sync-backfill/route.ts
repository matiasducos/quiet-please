/**
 * sync-backfill — one-time / on-demand endpoint
 *
 * Processes past tournaments (starts_at < now, status = 'upcoming') that were
 * never progressed through the normal draw → results → completed pipeline.
 * Call manually from Supabase or Vercel dashboard to catch up historical data.
 *
 * For each past tournament:
 *   1. Fetch draw from API → upsert to draws table
 *   2. Fetch results from API → upsert to match_results table
 *   3. Set status = 'completed'
 *
 * Safe to call multiple times (all operations are upserts).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'
import type { Json } from '@/types/database'

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const now = new Date().toISOString()

    // Find past tournaments that haven't been progressed yet
    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('id, external_id, name')
      .in('status', ['upcoming', 'accepting_predictions', 'in_progress'])
      .lt('starts_at', now)
      .order('starts_at', { ascending: true })

    if (!tournaments?.length) {
      return NextResponse.json({ message: 'No past tournaments to backfill', processed: 0 })
    }

    console.log(`[sync-backfill] Processing ${tournaments.length} past tournaments`)
    const results = []

    for (const tournament of tournaments) {
      const result: Record<string, any> = { name: tournament.name }

      try {
        // 1. Sync draw
        const draw = await tennisAdapter.getDraw(tournament.external_id)
        if (draw.matches?.length) {
          await supabase
            .from('draws')
            .upsert(
              { tournament_id: tournament.id, bracket_data: draw as unknown as Json, synced_at: new Date().toISOString() },
              { onConflict: 'tournament_id' }
            )
          result.draw = `${draw.matches.length} matches`
        } else {
          result.draw = 'none'
        }
      } catch (err) {
        result.draw_error = err instanceof Error ? err.message : 'Unknown'
      }

      await new Promise(r => setTimeout(r, 400)) // rate limit between draw + results calls

      try {
        // 2. Sync results
        const matchResults = await tennisAdapter.getResults(tournament.external_id)
        if (matchResults.length) {
          const rows = matchResults.map(r => ({
            tournament_id:      tournament.id,
            external_match_id:  r.externalMatchId,
            round:              r.round,
            winner_external_id: r.winnerExternalId,
            loser_external_id:  r.loserExternalId,
            score:              r.score,
            played_at:          r.playedAt,
          }))
          await supabase
            .from('match_results')
            .upsert(rows, { onConflict: 'tournament_id,external_match_id' })
          result.results = `${matchResults.length} results`
        } else {
          result.results = 'none'
        }
      } catch (err) {
        result.results_error = err instanceof Error ? err.message : 'Unknown'
      }

      // 3. Mark completed (regardless of whether draw/results were found — the
      //    tournament happened, so it's done from a predictions standpoint)
      await supabase
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('id', tournament.id)

      result.status = 'completed'
      results.push(result)

      await new Promise(r => setTimeout(r, 400)) // rate limit between tournaments
    }

    return NextResponse.json({
      message: 'Backfill complete',
      processed: results.length,
      results,
    })
  } catch (err) {
    console.error('[sync-backfill] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
