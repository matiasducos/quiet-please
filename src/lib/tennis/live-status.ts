import { createAdminClient } from '@/lib/supabase/admin'
import { buildMyTournament, type DrawMatch, type MyTournament } from './my-tournament'

/**
 * A user's own standing in each of a handful of live tournaments — for the
 * dashboard's "Live right now" cards.
 *
 * Reuses buildMyTournament() rather than aggregating in Postgres, which is
 * safe here in a way it is not on a profile: this is bounded by the number of
 * tournaments running at once (a few), not by everything a user has ever
 * entered. A grand slam is ~127 results, so even four at once stays well inside
 * the 1000-row response cap.
 */
export interface LiveStatus {
  tournamentId: string
  pointsSoFar: number
  correct: number
  decided: number
  ridingCount: number
  /** the two players with most still at stake, for a one-line summary */
  topRiding: { name: string; riding: number }[]
  currentRound: string | null
}

export async function getLiveStatuses(
  userId: string,
  tournamentIds: string[],
): Promise<Record<string, LiveStatus>> {
  if (tournamentIds.length === 0) return {}

  const admin = createAdminClient()

  const { data: predictions, error: predErr } = await admin
    .from('predictions')
    .select('id, tournament_id, picks')
    .eq('user_id', userId)
    .is('challenge_id', null)
    .in('tournament_id', tournamentIds)

  if (predErr) {
    console.error('[live-status] predictions failed:', predErr.message)
    return {}
  }
  if (!predictions?.length) return {}

  const entered = predictions.map(p => p.tournament_id)

  const [{ data: results, error: resErr }, { data: draws }, { data: ledger }] = await Promise.all([
    admin.from('match_results')
      .select('tournament_id, external_match_id, winner_external_id, loser_external_id, round')
      .in('tournament_id', entered)
      .or('score.neq.BYE,score.is.null'),
    admin.from('draws').select('tournament_id, bracket_data').in('tournament_id', entered),
    admin.from('point_ledger')
      .select('tournament_id, points, prediction_id, match_results(external_match_id)')
      .eq('user_id', userId)
      .in('tournament_id', entered),
  ])

  if (resErr) {
    console.error('[live-status] match_results failed:', resErr.message)
    return {}
  }

  const drawByTournament = Object.fromEntries(
    (draws ?? []).map(d => [d.tournament_id, ((d.bracket_data as { matches?: DrawMatch[] })?.matches ?? [])]),
  )

  const out: Record<string, LiveStatus> = {}

  for (const pred of predictions) {
    const tid = pred.tournament_id
    const tResults = (results ?? []).filter(r => r.tournament_id === tid)
    if (tResults.length === 0) continue // nothing played yet — nothing to report

    const pointsByMatch: Record<string, number> = {}
    for (const row of (ledger ?? []) as unknown as Array<{
      tournament_id: string
      points: number
      prediction_id: string | null
      match_results?: { external_match_id: string } | { external_match_id: string }[] | null
    }>) {
      if (row.tournament_id !== tid || row.prediction_id !== pred.id) continue
      const m = row.match_results
      const ext = (Array.isArray(m) ? m[0]?.external_match_id : m?.external_match_id) ?? null
      if (ext) pointsByMatch[ext] = (pointsByMatch[ext] ?? 0) + row.points
    }

    const summary: MyTournament = buildMyTournament({
      picks: (pred.picks as Record<string, string>) ?? {},
      results: tResults,
      matches: drawByTournament[tid] ?? [],
      pointsByMatch,
    })

    out[tid] = {
      tournamentId: tid,
      pointsSoFar: summary.pointsSoFar,
      correct: summary.correct,
      decided: summary.decided,
      ridingCount: summary.stillRiding.length,
      topRiding: summary.stillRiding.slice(0, 2).map(p => ({ name: p.name, riding: p.riding })),
      currentRound: summary.currentRound,
    }
  }

  return out
}
