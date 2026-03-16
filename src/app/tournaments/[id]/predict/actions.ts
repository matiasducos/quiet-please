'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPointsForRound } from '@/lib/tennis'

export async function savePrediction({
  tournamentId,
  picks,
  predictionId,
  lock = false,
  isPractice = false,
}: {
  tournamentId: string
  picks: Record<string, string>
  predictionId: string | null
  lock?: boolean
  isPractice?: boolean
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Practice mode: score immediately against existing match_results (all results
  // are already in the DB for completed tournaments — no cron needed).
  let pointsEarned = 0
  if (lock && isPractice) {
    const [{ data: tournament }, { data: matchResults }] = await Promise.all([
      supabase.from('tournaments').select('category').eq('id', tournamentId).single(),
      supabase.from('match_results').select('round, winner_external_id').eq('tournament_id', tournamentId),
    ])
    for (const result of matchResults ?? []) {
      if (Object.values(picks).includes(result.winner_external_id)) {
        const isWinner = result.round === 'F'
        pointsEarned += getPointsForRound(
          tournament!.category as any,
          result.round as any,
          isWinner,
        )
      }
    }
  }

  const row: Record<string, any> = {
    user_id:       user.id,
    tournament_id: tournamentId,
    picks,
    is_locked:     lock,
    is_practice:   isPractice,
    updated_at:    new Date().toISOString(),
  }
  if (lock && isPractice) row.points_earned = pointsEarned

  if (predictionId) {
    const { error } = await supabase
      .from('predictions')
      .update(row)
      .eq('id', predictionId)
      .eq('user_id', user.id)
      .eq('is_locked', false)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('predictions')
      .insert({ ...row, submitted_at: new Date().toISOString() } as any)
    if (error) throw error
  }

  revalidatePath(`/tournaments/${tournamentId}`)
}
