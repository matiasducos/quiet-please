import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'

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

    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('id, external_id, name')
      .in('status', ['accepting_predictions', 'in_progress'])

    if (!tournaments?.length) {
      return NextResponse.json({ message: 'No active tournaments', synced: 0 })
    }

    const results = []

    for (const tournament of tournaments) {
      try {
        const matchResults = await tennisAdapter.getResults(tournament.external_id)

        if (!matchResults.length) {
          results.push({ name: tournament.name, status: 'no_results' })
          continue
        }

        const rows = matchResults.map(r => ({
          tournament_id:      tournament.id,
          external_match_id:  r.externalMatchId,
          round:              r.round,
          winner_external_id: r.winnerExternalId,
          loser_external_id:  r.loserExternalId,
          score:              r.score,
          played_at:          r.playedAt,
        }))

        const { error } = await supabase
          .from('match_results')
          .upsert(rows, { onConflict: 'tournament_id,external_match_id' })

        if (error) {
          results.push({ name: tournament.name, status: 'error', error: error.message })
          continue
        }

        // Update tournament to in_progress
        await supabase
          .from('tournaments')
          .update({ status: 'in_progress' })
          .eq('id', tournament.id)
          .eq('status', 'accepting_predictions')

        results.push({ name: tournament.name, status: 'synced', matches: matchResults.length })
      } catch (err) {
        results.push({ name: tournament.name, status: 'error', error: err instanceof Error ? err.message : 'Unknown' })
      }
    }

    return NextResponse.json({ message: 'Result sync complete', results })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
