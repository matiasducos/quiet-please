import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPointsForRound, calculateStreakMultiplier, buildFeedMap } from '@/lib/tennis'
import type { DrawMatch } from '@/lib/tennis'
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

    // ── 1. Get all match results ──────────────────────────────────────────
    // Exclude BYE auto-advances — they don't award points
    const { data: allResults } = await supabase
      .from('match_results')
      .select('id, tournament_id, round, external_match_id, winner_external_id, tournaments(id, category, starts_at)')
      .or('score.neq.BYE,score.is.null')
      .order('played_at', { ascending: true })

    if (!allResults?.length) {
      return NextResponse.json({ message: 'No match results found', awarded: 0 })
    }

    // ── 2. Get already scored (match_result_id, prediction_id) pairs ──────
    // We now track per-prediction scoring, so the same match_result can be
    // scored for multiple predictions (global + challenge predictions).
    const { data: alreadyScored } = await supabase
      .from('point_ledger')
      .select('match_result_id, prediction_id')

    const scoredPairs = new Set(
      (alreadyScored ?? []).map(r => `${r.match_result_id}:${r.prediction_id}`)
    )

    // Get tournament IDs that have results
    const tournamentIds = Array.from(new Set(allResults.map((r: any) => r.tournament_id)))

    // ── 3. Get ALL predictions for those tournaments ──────────────────────
    // Both global (challenge_id IS NULL) and challenge-specific predictions.
    // No longer filters by is_locked — we score any prediction that has a
    // pick for the match, and auto-lock that pick.
    const { data: predictions } = await supabase
      .from('predictions')
      .select('id, user_id, tournament_id, challenge_id, picks, pick_locks, points_earned, expires_at')
      .in('tournament_id', tournamentIds)

    if (!predictions?.length) {
      return NextResponse.json({ message: 'No predictions found', awarded: 0 })
    }

    console.log(`[award-points] ${predictions.length} predictions to check across ${tournamentIds.length} tournaments`)

    // ── 4. Load bracket data for streak calculation ───────────────────────
    const { data: draws } = await supabase
      .from('draws')
      .select('tournament_id, bracket_data')
      .in('tournament_id', tournamentIds as string[])

    const bracketByTournament: Record<string, { matches: DrawMatch[]; feedMap: ReturnType<typeof buildFeedMap> }> = {}
    for (const d of draws ?? []) {
      const bracket = d.bracket_data as any
      if (bracket?.matches) {
        bracketByTournament[d.tournament_id] = {
          matches: bracket.matches,
          feedMap: buildFeedMap(bracket.matches),
        }
      }
    }

    // Fetch tournament names + starts_at for notifications and expires_at
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

    // ── 5. Score predictions ──────────────────────────────────────────────
    const ledgerRows: any[] = []
    // Track deltas per global-prediction user (for total_points, leagues, rankings)
    const globalUserPointsDelta: Record<string, number> = {}
    const predictionPointsDelta: Record<string, number> = {}
    // Track per-user per-tournament points for notifications (global only)
    const userTournamentPoints: Record<string, Record<string, number>> = {}
    // Track auto-locks to apply
    const autoLocks: Map<string, Record<string, string>> = new Map() // predictionId → { matchId: "auto" }

    for (const result of allResults as any[]) {
      const tournament = result.tournaments as any
      if (!tournament?.category) continue

      const isWinner = result.round === 'F'
      const basePoints = getPointsForRound(
        tournament.category,
        result.round as any,
        isWinner
      )
      if (basePoints <= 0) continue

      const bracket = bracketByTournament[result.tournament_id]

      for (const prediction of predictions) {
        if (prediction.tournament_id !== result.tournament_id) continue

        const picks = prediction.picks as Record<string, string>

        // Auto-lock: if this prediction has a pick for this match, mark it as auto-locked
        if (picks[result.external_match_id]) {
          if (!autoLocks.has(prediction.id)) autoLocks.set(prediction.id, {})
          autoLocks.get(prediction.id)![result.external_match_id] = 'auto'
        }

        // Skip if this (match_result, prediction) pair is already scored
        if (scoredPairs.has(`${result.id}:${prediction.id}`)) continue

        // Per-match check: the pick for THIS specific match must match the winner
        const didPickWinnerForThisMatch = picks[result.external_match_id] === result.winner_external_id
        if (!didPickWinnerForThisMatch) continue

        // Calculate streak multiplier using bracket data
        let streakMultiplier = 1
        if (bracket) {
          streakMultiplier = calculateStreakMultiplier(
            result.external_match_id,
            result.winner_external_id,
            picks,
            bracket.feedMap,
            bracket.matches,
          )
        }

        const totalPoints = basePoints * streakMultiplier

        console.log(
          `[award-points] ${prediction.user_id} pred=${prediction.id} ` +
          `gets ${basePoints}x${streakMultiplier}=${totalPoints} pts for ${result.round}` +
          (prediction.challenge_id ? ` (challenge ${prediction.challenge_id})` : ' (global)')
        )

        ledgerRows.push({
          user_id:           prediction.user_id,
          tournament_id:     result.tournament_id,
          match_result_id:   result.id,
          prediction_id:     prediction.id,
          round:             result.round,
          points:            totalPoints,
          streak_multiplier: streakMultiplier,
        })

        predictionPointsDelta[prediction.id] = (predictionPointsDelta[prediction.id] ?? 0) + totalPoints

        // Only global predictions affect user total_points / leagues / rankings
        if (!prediction.challenge_id) {
          globalUserPointsDelta[prediction.user_id] = (globalUserPointsDelta[prediction.user_id] ?? 0) + totalPoints

          if (!userTournamentPoints[prediction.user_id]) userTournamentPoints[prediction.user_id] = {}
          userTournamentPoints[prediction.user_id][result.tournament_id] =
            (userTournamentPoints[prediction.user_id][result.tournament_id] ?? 0) + totalPoints
        }
      }
    }

    // ── 6. Apply auto-locks to predictions (batched) ──────────────────────
    let autoLocksApplied = 0
    const predMap = new Map((predictions ?? []).map(p => [p.id, p]))
    const autoLockUpdates: Array<PromiseLike<any>> = []
    for (const [predId, newLocks] of autoLocks) {
      const pred = predMap.get(predId)
      if (!pred) continue

      const existingLocks = (pred.pick_locks as Record<string, string>) ?? {}
      const merged = { ...existingLocks }
      let hasNew = false
      for (const [matchId, lockType] of Object.entries(newLocks)) {
        if (!merged[matchId]) {
          merged[matchId] = lockType
          hasNew = true
        }
      }
      if (hasNew) {
        autoLockUpdates.push(
          supabase.from('predictions').update({ pick_locks: merged }).eq('id', predId)
        )
        autoLocksApplied++
      }
    }
    // Run auto-lock updates in parallel batches of 50
    for (let i = 0; i < autoLockUpdates.length; i += 50) {
      await Promise.all(autoLockUpdates.slice(i, i + 50))
    }

    if (autoLocksApplied > 0) {
      console.log(`[award-points] Auto-locked picks on ${autoLocksApplied} predictions`)
    }

    // ── 7. Insert point ledger + update predictions ────────────────────────
    if (ledgerRows.length > 0) {
      const { error: ledgerError } = await supabase.from('point_ledger').insert(ledgerRows)
      if (ledgerError) throw ledgerError

      // ── 8. Update prediction points_earned + expires_at ──────────────────
      // Must run BEFORE ranking recalculation (which reads predictions.points_earned)
      const predictionUpdates = Object.entries(predictionPointsDelta).map(([predId, pts]) => {
        const pred = predMap.get(predId)
        const updateRow: Record<string, any> = {
          points_earned: (pred?.points_earned ?? 0) + pts,
        }
        if (!pred?.expires_at && pred?.tournament_id) {
          const startsAt = tournamentStartsAt[pred.tournament_id]
          if (startsAt) {
            const expiresAt = new Date(new Date(startsAt).getTime() + 364 * 24 * 60 * 60 * 1000)
            updateRow.expires_at = expiresAt.toISOString()
          }
        }
        return supabase.from('predictions').update(updateRow).eq('id', predId)
      })
      for (let i = 0; i < predictionUpdates.length; i += 50) {
        await Promise.all(predictionUpdates.slice(i, i + 50))
      }
    }

    // ── 9. Update global user totals + leagues + rankings ───────────────
    // Always recalculate rankings (even when no new points) to fix any stale data
    const userIds = Object.keys(globalUserPointsDelta)

    // 9a. Update league memberships — batch fetch all, then batch update
    if (userIds.length > 0) {
      const { data: allMemberships } = await supabase
        .from('league_members')
        .select('league_id, user_id, total_points')
        .in('user_id', userIds)

      const leagueUpdates = (allMemberships ?? [])
        .filter(m => globalUserPointsDelta[m.user_id])
        .map(m =>
          supabase
            .from('league_members')
            .update({ total_points: m.total_points + globalUserPointsDelta[m.user_id] })
            .eq('league_id', m.league_id)
            .eq('user_id', m.user_id)
        )

      for (let i = 0; i < leagueUpdates.length; i += 50) {
        await Promise.all(leagueUpdates.slice(i, i + 50))
      }
    }

    // 9b. Recalculate rankings for all users who have scored predictions
    // (not just users with new points this run — ensures stale rankings are fixed)
    const { data: usersWithPoints } = await supabase
      .from('predictions')
      .select('user_id')
      .gt('points_earned', 0)
      .is('challenge_id', null)
    const rankUserIds = Array.from(new Set((usersWithPoints ?? []).map(p => p.user_id)))
    for (let i = 0; i < rankUserIds.length; i += 50) {
      await Promise.all(
        rankUserIds.slice(i, i + 50).map(userId =>
          supabase.rpc('recalculate_ranking_points', { p_user_id: userId })
        )
      )
    }

    // ── 10. Notifications + emails (parallelized, non-blocking) ──────────
    try {
      const notifRows: Array<{ user_id: string; type: string; tournament_id: string; meta: any }> = []
      const emailJobs: Array<{ userId: string; tId: string; tName: string; pts: number }> = []

      for (const [userId, tPoints] of Object.entries(userTournamentPoints)) {
        for (const [tId, pts] of Object.entries(tPoints)) {
          const tName = tournamentNames[tId] ?? 'a tournament'
          notifRows.push({
            user_id: userId,
            type: 'points_awarded',
            tournament_id: tId,
            meta: { points: pts, tournament_name: tName },
          })
          emailJobs.push({ userId, tId, tName, pts })
        }
      }

      // Batch insert all notifications at once
      if (notifRows.length > 0) {
        await (supabase as any).from('notifications').insert(notifRows)
      }

      // Send emails in parallel batches of 10 (to avoid rate limits)
      for (let i = 0; i < emailJobs.length; i += 10) {
        await Promise.all(
          emailJobs.slice(i, i + 10).map(async (job) => {
            try {
              const { data: { user: authUser } } = await supabase.auth.admin.getUserById(job.userId)
              if (authUser?.email) {
                await sendPointsAwardedEmail({
                  to: authUser.email,
                  tournamentName: job.tName,
                  tournamentId: job.tId,
                  points: job.pts,
                  totalPoints: globalUserPointsDelta[job.userId],
                })
              }
            } catch (emailErr) {
              console.error(`[award-points] email error for ${job.userId}:`, emailErr)
            }
          })
        )
      }
    } catch (notifyErr) {
      console.error('[award-points] notification error:', notifyErr)
    }

    // ── 11. Score and finalize completed challenges ───────────────────────
    let challengesScored = 0
    let challengesExpired = 0
    try {
      // 11a. Expire pending challenges for tournaments that have started
      const { data: pendingChallenges } = await supabase
        .from('challenges')
        .select('id, tournament_id')
        .eq('status', 'pending')

      if (pendingChallenges?.length) {
        const pendingTournamentIds = Array.from(new Set(pendingChallenges.map(c => c.tournament_id)))
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

      // 11b. Score accepted challenges for completed tournaments
      // Now uses challenge-specific predictions (challenge_id = challenge.id)
      const { data: acceptedChallenges } = await supabase
        .from('challenges')
        .select('id, challenger_id, challenged_id, tournament_id')
        .eq('status', 'accepted')

      if (acceptedChallenges?.length) {
        const acceptedTournamentIds = Array.from(new Set(acceptedChallenges.map(c => c.tournament_id)))
        const { data: completedTournaments } = await supabase
          .from('tournaments')
          .select('id')
          .in('id', acceptedTournamentIds as string[])
          .eq('status', 'completed')

        const completedIds = new Set((completedTournaments ?? []).map(t => t.id))
        const toScore = acceptedChallenges.filter(c => completedIds.has(c.tournament_id))

        for (const challenge of toScore) {
          // Fetch challenge-specific predictions for both players
          const { data: preds } = await supabase
            .from('predictions')
            .select('user_id, points_earned, picks')
            .eq('challenge_id', challenge.id)
            .eq('tournament_id', challenge.tournament_id)

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
      new_results_processed: allResults.length,
      point_entries_created: ledgerRows.length,
      users_awarded: Object.keys(globalUserPointsDelta).length,
      auto_locks_applied: autoLocksApplied,
      points_by_user: globalUserPointsDelta,
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
