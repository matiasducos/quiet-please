import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPointsForRound } from '@/lib/tennis'

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

    // Get all match results that haven't been scored yet
    // (not in point_ledger)
    const { data: newResults } = await supabase
      .from('match_results')
      .select(`
        id,
        tournament_id,
        round,
        winner_external_id,
        tournaments (id, category)
      `)
      .not('id', 'in',
        supabase.from('point_ledger').select('match_result_id')
      )

    if (!newResults?.length) {
      return NextResponse.json({ message: 'No new results to score', awarded: 0 })
    }

    // Get all locked predictions for affected tournaments
    const tournamentIds = [...new Set(newResults.map(r => r.tournament_id))]

    const { data: predictions } = await supabase
      .from('predictions')
      .select('id, user_id, tournament_id, picks')
      .in('tournament_id', tournamentIds)
      .eq('is_locked', true)

    if (!predictions?.length) {
      return NextResponse.json({ message: 'No locked predictions found', awarded: 0 })
    }

    let totalAwarded = 0
    const ledgerRows: any[] = []
    const userPointsMap: Record<string, number> = {}
    const predictionPointsMap: Record<string, number> = {}

    for (const result of newResults) {
      const tournament = result.tournaments as any
      if (!tournament?.category) continue

      for (const prediction of predictions) {
        if (prediction.tournament_id !== result.tournament_id) continue

        const picks = prediction.picks as Record<string, string>

        // Find if any pick in this match matches the winner
        // picks format: { matchId: playerExternalId }
        const pickedWinnerId = Object.values(picks).find(
          playerId => playerId === result.winner_external_id
        )

        if (!pickedWinnerId) continue

        // Check that this pick was specifically for this match's round
        // by finding the matchId that had this pick
        const matchPickEntry = Object.entries(picks).find(
          ([, playerId]) => playerId === result.winner_external_id
        )
        if (!matchPickEntry) continue

        const isWinner = result.round === 'F'
        const points = getPointsForRound(
          tournament.category,
          result.round as any,
          isWinner
        )

        if (points <= 0) continue

        ledgerRows.push({
          user_id:         prediction.user_id,
          tournament_id:   result.tournament_id,
          match_result_id: result.id,
          round:           result.round,
          points,
        })

        userPointsMap[prediction.user_id] = (userPointsMap[prediction.user_id] ?? 0) + points
        predictionPointsMap[prediction.id] = (predictionPointsMap[prediction.id] ?? 0) + points
        totalAwarded++
      }
    }

    // Insert point ledger rows
    if (ledgerRows.length > 0) {
      const { error } = await supabase.from('point_ledger').insert(ledgerRows)
      if (error) throw error
    }

    // Update users.total_points
    for (const [userId, pts] of Object.entries(userPointsMap)) {
      await supabase.rpc('increment_user_points', { user_id: userId, points: pts })
    }

    // Update predictions.points_earned
    for (const [predId, pts] of Object.entries(predictionPointsMap)) {
      const { data: pred } = await supabase
        .from('predictions')
        .select('points_earned')
        .eq('id', predId)
        .single()
      await supabase
        .from('predictions')
        .update({ points_earned: (pred?.points_earned ?? 0) + pts })
        .eq('id', predId)
    }

    return NextResponse.json({
      message: 'Points awarded',
      new_results_processed: newResults.length,
      point_entries_created: ledgerRows.length,
      total_point_awards: totalAwarded,
    })
  } catch (err) {
    console.error('[award-points] Error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
