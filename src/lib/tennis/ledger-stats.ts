import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * ACCURACY and STREAK POWER for one user, as the tournament boards show them.
 *
 * `totalPts` is points as awarded and `basePts` the same points with each
 * row's multiplier divided back out, so `totalPts / basePts` is a
 * points-weighted mean multiplier rather than a mean of multipliers — a
 * semi-final win at 2x moves it far more than an R128 win at 2x, which is the
 * intended reading of "how much did streaks boost this bracket".
 */
export type LedgerStat = { correctPicks: number; totalPts: number; basePts: number }

/*
 * The RPC takes its ids in a POST body, so there is no URL length to overflow.
 * Chunking is only about not shipping a megabyte of uuids for a very large
 * league; the aggregation itself is one row per user either way.
 */
const ID_CHUNK = 500

/**
 * Scoring ledger stats for a set of brackets, aggregated in Postgres
 * (migration 107).
 *
 * Do NOT go back to selecting point_ledger rows and counting them here.
 * PostgREST caps a result at 1000 rows and sets no error when it truncates, and
 * a page of 50 brackets at a slam is over twice that. Because rows arrive in
 * insertion order — which is round order — the half that gets dropped is the
 * late rounds, so the failure is not noise: every entrant reads 1.0x and every
 * accuracy reads low. That is precisely how this shipped, and the fact that it
 * looked plausible is why it survived.
 */
export async function fetchLedgerStats(
  admin: AdminClient,
  predictionIds: string[],
): Promise<Record<string, LedgerStat>> {
  const byUser: Record<string, LedgerStat> = {}
  if (predictionIds.length === 0) return byUser

  for (let i = 0; i < predictionIds.length; i += ID_CHUNK) {
    const chunk = predictionIds.slice(i, i + ID_CHUNK)
    const { data, error } = await admin.rpc('ledger_stats_for_predictions', { pred_ids: chunk })

    if (error) {
      console.error('[ledger-stats] aggregation failed:', error.message)
      continue
    }

    for (const row of (data ?? []) as Array<{
      user_id: string
      correct_picks: number | string
      total_points: number | string | null
      base_points: number | string | null
    }>) {
      // bigint and numeric come back as strings over PostgREST.
      const stat = (byUser[row.user_id] ??= { correctPicks: 0, totalPts: 0, basePts: 0 })
      stat.correctPicks += Number(row.correct_picks ?? 0)
      stat.totalPts     += Number(row.total_points ?? 0)
      stat.basePts      += Number(row.base_points ?? 0)
    }
  }

  return byUser
}

/**
 * A user with no scoring rows has no streak to report — 1.0x, not 0x, because
 * the column is a multiplier and "no bonus" is its identity value.
 */
export const streakPower = (stat?: LedgerStat) =>
  stat && stat.basePts > 0 ? stat.totalPts / stat.basePts : 1
