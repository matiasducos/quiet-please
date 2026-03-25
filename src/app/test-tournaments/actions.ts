'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPointsForRound } from '@/lib/tennis'
import { TEST_EXTERNAL_ID, TEST_DRAW, TEST_RESULTS } from './constants'

/** Verify the caller is an admin. Throws if not. */
async function requireAdminAction() {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const isDev = process.env.NODE_ENV === 'development'
  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!isDev && !adminIds.includes(user.id)) throw new Error('Not authorized')
  return user
}

// ── Reset ──────────────────────────────────────────────────────────────────
// Wipes all test tournament state (predictions, results, points) and puts
// it back to "accepting_predictions" with the hardcoded draw.
export async function resetTestTournament() {
  const supabase = createAdminClient()
  await requireAdminAction()

  const { data: existing } = await supabase
    .from('tournaments')
    .select('id')
    .eq('external_id', TEST_EXTERNAL_ID)
    .single()

  let tournamentId: string

  if (existing) {
    tournamentId = existing.id

    // Reverse any points previously awarded for this tournament
    const { data: ledger } = await supabase
      .from('point_ledger')
      .select('user_id, points')
      .eq('tournament_id', tournamentId)

    const userPointsToDeduct: Record<string, number> = {}
    for (const entry of (ledger ?? [])) {
      userPointsToDeduct[entry.user_id] = (userPointsToDeduct[entry.user_id] ?? 0) + entry.points
    }

    for (const [userId, pts] of Object.entries(userPointsToDeduct)) {
      const { data: userData } = await supabase.from('users').select('total_points').eq('id', userId).single()
      const newTotal = Math.max(0, (userData?.total_points ?? 0) - pts)
      await supabase.from('users').update({ total_points: newTotal }).eq('id', userId)

      const { data: memberships } = await supabase
        .from('league_members').select('league_id, total_points').eq('user_id', userId)
      for (const m of memberships ?? []) {
        await supabase.from('league_members')
          .update({ total_points: Math.max(0, m.total_points - pts) })
          .eq('league_id', m.league_id).eq('user_id', userId)
      }
    }

    // Clear all test data
    await supabase.from('point_ledger').delete().eq('tournament_id', tournamentId)
    await supabase.from('match_results').delete().eq('tournament_id', tournamentId)
    await supabase.from('predictions').delete().eq('tournament_id', tournamentId)
    await supabase.from('tournaments').update({ status: 'accepting_predictions' }).eq('id', tournamentId)
  } else {
    // First run — create the tournament
    const { data: created, error } = await supabase
      .from('tournaments')
      .insert({
        external_id:   TEST_EXTERNAL_ID,
        name:          'BNP Paribas Open (Test)',
        tour:          'ATP',
        category:      'masters_1000',
        surface:       'hard',
        status:        'accepting_predictions',
        location:      'Indian Wells, CA',
        flag_emoji:    '🇺🇸',
        starts_at:     '2026-03-09',
        ends_at:       '2026-03-22',
        draw_close_at: '2026-03-09',
      })
      .select('id')
      .single()
    if (error || !created) throw new Error(error?.message ?? 'Failed to create test tournament')
    tournamentId = created.id
  }

  // Always re-upsert the draw so it's fresh
  await supabase
    .from('draws')
    .upsert(
      { tournament_id: tournamentId, bracket_data: TEST_DRAW as any, synced_at: new Date().toISOString() },
      { onConflict: 'tournament_id' },
    )

  revalidatePath('/test-tournaments')
  return { tournamentId }
}

// ── Simulate ───────────────────────────────────────────────────────────────
// Seeds the predetermined match results and scores all locked predictions.
export async function simulateResults(tournamentId: string) {
  const supabase = createAdminClient()
  await requireAdminAction()

  // 1. Upsert match results
  const rows = TEST_RESULTS.map(r => ({
    tournament_id:      tournamentId,
    external_match_id:  r.matchId,
    round:              r.round,
    winner_external_id: r.winner,
    loser_external_id:  r.loser,
    score:              r.score,
    played_at:          new Date().toISOString(),
  }))
  await supabase.from('match_results').upsert(rows, { onConflict: 'tournament_id,external_match_id' })

  // 2. Fetch inserted rows to get their DB IDs
  const { data: matchResults } = await supabase
    .from('match_results')
    .select('id, external_match_id, round, winner_external_id')
    .eq('tournament_id', tournamentId)

  // 3. Get all locked predictions
  const { data: predictions } = await supabase
    .from('predictions')
    .select('id, user_id, picks')
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)

  const ledgerRows: any[] = []
  const predictionPointsDelta: Record<string, number> = {}
  const userPointsDelta: Record<string, number> = {}

  for (const result of (matchResults ?? [])) {
    const isWinner = result.round === 'F'
    const points = getPointsForRound('masters_1000', result.round as any, isWinner)
    if (points <= 0) continue

    for (const prediction of (predictions ?? [])) {
      const picks = prediction.picks as Record<string, string>
      if (!Object.values(picks).includes(result.winner_external_id)) continue

      ledgerRows.push({
        user_id:         prediction.user_id,
        tournament_id:   tournamentId,
        match_result_id: result.id,
        round:           result.round,
        points,
      })
      predictionPointsDelta[prediction.id] = (predictionPointsDelta[prediction.id] ?? 0) + points
      userPointsDelta[prediction.user_id]   = (userPointsDelta[prediction.user_id] ?? 0) + points
    }
  }

  if (ledgerRows.length > 0) {
    await supabase.from('point_ledger').insert(ledgerRows)

    for (const [predId, pts] of Object.entries(predictionPointsDelta)) {
      const { data: pred } = await supabase.from('predictions').select('points_earned').eq('id', predId).single()
      await supabase.from('predictions')
        .update({ points_earned: (pred?.points_earned ?? 0) + pts })
        .eq('id', predId)
    }

    for (const [userId, pts] of Object.entries(userPointsDelta)) {
      await supabase.rpc('increment_user_points', { user_id: userId, points: pts })
      const { data: memberships } = await supabase
        .from('league_members').select('league_id, total_points').eq('user_id', userId)
      for (const m of memberships ?? []) {
        await supabase.from('league_members')
          .update({ total_points: m.total_points + pts })
          .eq('league_id', m.league_id).eq('user_id', userId)
      }
    }
  }

  // Flip tournament to in_progress
  await supabase.from('tournaments').update({ status: 'in_progress' }).eq('id', tournamentId)

  revalidatePath('/test-tournaments')
  revalidatePath(`/tournaments/${tournamentId}`)
  return { pointsAwarded: userPointsDelta }
}
