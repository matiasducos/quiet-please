import { createAdminClient } from '@/lib/supabase/admin'

export type EngagementMap = Record<string, { predictions: number; challenges: number }>

/**
 * Batch-fetch prediction + challenge counts for a set of tournament IDs.
 * Returns a map: tournamentId → { predictions, challenges }
 */
export async function getTournamentEngagement(tournamentIds: string[]): Promise<EngagementMap> {
  if (tournamentIds.length === 0) return {}

  const supabase = createAdminClient()

  const [{ data: predRows, error: predErr }, { data: challengeRows, error: challengeErr }] = await Promise.all([
    supabase.rpc('count_predictions_by_tournament', { t_ids: tournamentIds }),
    supabase.rpc('count_challenges_by_tournament', { t_ids: tournamentIds }),
  ])

  if (predErr) console.error('engagement: predictions count failed', predErr.message)
  if (challengeErr) console.error('engagement: challenges count failed', challengeErr.message)

  const map: EngagementMap = {}

  for (const row of predRows ?? []) {
    map[row.tournament_id] = { predictions: Number(row.cnt), challenges: 0 }
  }
  for (const row of challengeRows ?? []) {
    if (!map[row.tournament_id]) map[row.tournament_id] = { predictions: 0, challenges: 0 }
    map[row.tournament_id].challenges = Number(row.cnt)
  }

  return map
}
