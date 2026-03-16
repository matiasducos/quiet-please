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

    // Get all match results
    const { data: allResults } = await supabase
      .from('match_results')
      .select('id, tournament_id, round, winner_external_id, tournaments(id, category)')
      .order('played_at', { ascending: true })

    if (!allResults?.length) {
      return NextResponse.json({ message: 'No match results found', awarded: 0 })
    }

    // Get already scored result IDs from point_ledger
    const { data: alreadyScored } = await supabase
      .from('point_ledger')
      .select('match_result_id')

    const scoredIds = new Set((alreadyScored ?? []).map(r => r.match_result_id))

    // Filter to only new unscored results
    const newResults = (allResults as any[]).filter(r => !scoredIds.has(r.id))

    if (!newResults.length) {
      return NextResponse.json({ message: 'No new results to score', awarded: 0 })
    }

    console.log(`[award-points] ${newResults.length} new results to score`)

    // Get tournament IDs from new results
    const tournamentIds = [...new Set(newResults.map(r => r.tournament_id))]

    // Get all locked predictions for those tournaments
    const { data: predictions } = await supabase
      .from('predictions')
      .select('id, user_id, tournament_id, picks')
      .in('tournament_id', tournamentIds)
      .eq('is_locked', true)

    if (!predictions?.length) {
      return NextResponse.json({ message: 'No locked predictions found', awarded: 0 })
    }

    console.log(`[award-points] ${predictions.length} locked predictions to check`)

    const ledgerRows: any[] = []
    const userPointsDelta: Record<string, number> = {}
    const predictionPointsDelta: Record<string, number> = {}

    for (const result of newResults) {
      const tournament = result.tournaments as any
      if (!tournament?.category) continue

      const isWinner = result.round === 'F'
      const points = getPointsForRound(
        tournament.category,
        result.round as any,
        isWinner
      )
      if (points <= 0) continue

      for (const prediction of predictions) {
        if (prediction.tournament_id !== result.tournament_id) continue

        const picks = prediction.picks as Record<string, string>
        // Check if any pick value matches the winner
        const didPickWinner = Object.values(picks).includes(result.winner_external_id)
        if (!didPickWinner) continue

        console.log(`[award-points] ${prediction.user_id} gets ${points} pts for ${result.round}`)

        ledgerRows.push({
          user_id:         prediction.user_id,
          tournament_id:   result.tournament_id,
          match_result_id: result.id,
          round:           result.round,
          points,
        })

        userPointsDelta[prediction.user_id] = (userPointsDelta[prediction.user_id] ?? 0) + points
        predictionPointsDelta[prediction.id] = (predictionPointsDelta[prediction.id] ?? 0) + points
      }
    }

    if (ledgerRows.length === 0) {
      return NextResponse.json({ message: 'No correct predictions found', awarded: 0 })
    }

    // Insert point ledger
    const { error: ledgerError } = await supabase.from('point_ledger').insert(ledgerRows)
    if (ledgerError) throw ledgerError

    // Update user total_points and propagate to league memberships
    for (const [userId, pts] of Object.entries(userPointsDelta)) {
      await supabase.rpc('increment_user_points', { user_id: userId, points: pts })

      const { data: memberships } = await supabase
        .from('league_members')
        .select('league_id, total_points')
        .eq('user_id', userId)

      for (const m of memberships ?? []) {
        await supabase
          .from('league_members')
          .update({ total_points: m.total_points + pts })
          .eq('league_id', m.league_id)
          .eq('user_id', userId)
      }
    }

    // Update prediction points_earned
    for (const [predId, pts] of Object.entries(predictionPointsDelta)) {
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
      message: 'Points awarded successfully',
      new_results_scored: newResults.length,
      point_entries_created: ledgerRows.length,
      users_awarded: Object.keys(userPointsDelta).length,
      points_by_user: userPointsDelta,
    })

  } catch (err) {
    console.error('[award-points] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}