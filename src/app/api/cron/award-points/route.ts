import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPointsForRound } from '@/lib/tennis'
import { sendPointsAwardedEmail } from '@/lib/email'

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false  // Fail closed — never open if secret is missing
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    // Get all match results (includes starts_at for expires_at calculation)
    const { data: allResults } = await supabase
      .from('match_results')
      .select('id, tournament_id, round, winner_external_id, tournaments(id, category, starts_at)')
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

    // Get all locked, non-practice predictions for those tournaments
    const { data: predictions } = await supabase
      .from('predictions')
      .select('id, user_id, tournament_id, picks, expires_at')
      .in('tournament_id', tournamentIds)
      .eq('is_locked', true)
      .eq('is_practice', false)

    if (!predictions?.length) {
      return NextResponse.json({ message: 'No locked predictions found', awarded: 0 })
    }

    console.log(`[award-points] ${predictions.length} locked predictions to check`)

    // Fetch tournament names + starts_at for notification messages and expires_at calculation
    const { data: tournamentData } = await supabase
      .from('tournaments')
      .select('id, name, starts_at')
      .in('id', tournamentIds as string[])
    const tournamentNames: Record<string, string> = {}
    const tournamentStartsAt: Record<string, string> = {}
    for (const t of tournamentData ?? []) {
      tournamentNames[t.id] = t.name
      tournamentStartsAt[t.id] = t.starts_at
    }

    const ledgerRows: any[] = []
    const userPointsDelta: Record<string, number> = {}
    const predictionPointsDelta: Record<string, number> = {}
    // Track per-user per-tournament points for notifications
    const userTournamentPoints: Record<string, Record<string, number>> = {}

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

        if (!userTournamentPoints[prediction.user_id]) userTournamentPoints[prediction.user_id] = {}
        userTournamentPoints[prediction.user_id][result.tournament_id] =
          (userTournamentPoints[prediction.user_id][result.tournament_id] ?? 0) + points
      }
    }

    if (ledgerRows.length === 0) {
      return NextResponse.json({ message: 'No correct predictions found', awarded: 0 })
    }

    // Insert point ledger
    const { error: ledgerError } = await supabase.from('point_ledger').insert(ledgerRows)
    if (ledgerError) throw ledgerError

    // Update user total_points, propagate to league memberships, recalculate ranking_points
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

      // Recalculate rolling 52-week ranking points for this user
      await supabase.rpc('recalculate_ranking_points', { p_user_id: userId })
    }

    // Update prediction points_earned + set expires_at on first award (rolling 52-week window)
    for (const [predId, pts] of Object.entries(predictionPointsDelta)) {
      const pred = (predictions ?? []).find((p: any) => p.id === predId)
      const updateRow: Record<string, any> = {
        points_earned: (pred?.points_earned ?? 0) + pts,
      }
      // Stamp expires_at = tournament.starts_at + 364 days on the first point award
      if (!pred?.expires_at && pred?.tournament_id) {
        const startsAt = tournamentStartsAt[pred.tournament_id]
        if (startsAt) {
          const expiresAt = new Date(new Date(startsAt).getTime() + 364 * 24 * 60 * 60 * 1000)
          updateRow.expires_at = expiresAt.toISOString()
        }
      }
      await supabase.from('predictions').update(updateRow).eq('id', predId)
    }

    // Send points_awarded notifications + emails per user per tournament
    try {
      for (const [userId, tPoints] of Object.entries(userTournamentPoints)) {
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId)
        for (const [tId, pts] of Object.entries(tPoints)) {
          const tName = tournamentNames[tId] ?? 'a tournament'
          await (supabase as any).from('notifications').insert({
            user_id:       userId,
            type:          'points_awarded',
            tournament_id: tId,
            meta:          { points: pts, tournament_name: tName },
          })
          if (authUser?.email) {
            await sendPointsAwardedEmail({
              to:             authUser.email,
              tournamentName: tName,
              tournamentId:   tId,
              points:         pts,
              totalPoints:    userPointsDelta[userId],
            })
          }
        }
      }
    } catch (notifyErr) {
      console.error('[award-points] notification error:', notifyErr)
    }

    // ── Score and finalize completed challenges ────────────────────────────
    let challengesScored = 0
    let challengesExpired = 0
    try {
      // 1. Expire pending challenges for tournaments that have started
      const { data: pendingChallenges } = await supabase
        .from('challenges')
        .select('id, tournament_id')
        .eq('status', 'pending')

      if (pendingChallenges?.length) {
        const pendingTournamentIds = [...new Set(pendingChallenges.map(c => c.tournament_id))]
        const { data: startedTournaments } = await supabase
          .from('tournaments')
          .select('id')
          .in('id', pendingTournamentIds as string[])
          .in('status', ['in_progress', 'completed'])

        const startedIds = new Set((startedTournaments ?? []).map(t => t.id))
        const toExpire = pendingChallenges.filter(c => startedIds.has(c.tournament_id))

        for (const c of toExpire) {
          await supabase
            .from('challenges')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', c.id)
          challengesExpired++
        }
      }

      // 2. Score accepted challenges for completed tournaments
      const { data: acceptedChallenges } = await supabase
        .from('challenges')
        .select('id, challenger_id, challenged_id, tournament_id')
        .eq('status', 'accepted')

      if (acceptedChallenges?.length) {
        const acceptedTournamentIds = [...new Set(acceptedChallenges.map(c => c.tournament_id))]
        const { data: completedTournaments } = await supabase
          .from('tournaments')
          .select('id')
          .in('id', acceptedTournamentIds as string[])
          .eq('status', 'completed')

        const completedIds = new Set((completedTournaments ?? []).map(t => t.id))
        const toScore = acceptedChallenges.filter(c => completedIds.has(c.tournament_id))

        for (const challenge of toScore) {
          const { data: preds } = await supabase
            .from('predictions')
            .select('user_id, points_earned, picks')
            .in('user_id', [challenge.challenger_id, challenge.challenged_id])
            .eq('tournament_id', challenge.tournament_id)
            .eq('is_locked', true)
            .eq('is_practice', false)

          const challengerPred = (preds ?? []).find(p => p.user_id === challenge.challenger_id)
          const challengedPred = (preds ?? []).find(p => p.user_id === challenge.challenged_id)

          const challengerPts   = challengerPred?.points_earned ?? 0
          const challengedPts   = challengedPred?.points_earned ?? 0
          const challengerCount = Object.keys((challengerPred?.picks as Record<string, string> | null) ?? {}).length
          const challengedCount = Object.keys((challengedPred?.picks as Record<string, string> | null) ?? {}).length

          let winner_id: string | null = null
          if (challengerPts > challengedPts)       winner_id = challenge.challenger_id
          else if (challengedPts > challengerPts)  winner_id = challenge.challenged_id
          else if (challengerCount > challengedCount) winner_id = challenge.challenger_id
          else if (challengedCount > challengerCount) winner_id = challenge.challenged_id
          // else draw: winner_id stays null

          await supabase
            .from('challenges')
            .update({
              status:                          'completed',
              challenger_points:               challengerPts,
              challenged_points:               challengedPts,
              challenger_predictions_count:    challengerCount,
              challenged_predictions_count:    challengedCount,
              winner_id,
              updated_at:                      new Date().toISOString(),
            })
            .eq('id', challenge.id)

          challengesScored++
        }
      }
    } catch (challengeErr) {
      console.error('[award-points] challenge scoring error:', challengeErr)
    }

    return NextResponse.json({
      message: 'Points awarded successfully',
      new_results_scored: newResults.length,
      point_entries_created: ledgerRows.length,
      users_awarded: Object.keys(userPointsDelta).length,
      points_by_user: userPointsDelta,
      challenges_scored: challengesScored,
      challenges_expired: challengesExpired,
    })

  } catch (err) {
    console.error('[award-points] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
