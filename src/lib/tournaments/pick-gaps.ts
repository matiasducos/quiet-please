import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canPredictForStatus } from '@/lib/app-settings'
import { getTournamentISOWeeks } from '@/lib/utils/iso-week'
import { findPickGaps, toGapMatches, type GapMatch } from '@/lib/tennis/pick-gaps'
import { TEST_EXTERNAL_ID } from '@/app/test-tournaments/constants'
import { getLiveTournaments } from './cached'

/**
 * The one live tournament this person is leaving points on the table in.
 *
 * Answers "is there a round they could be predicting right now and aren't", for
 * the site notice in Nav — which means it runs on every signed-in page view and
 * has to behave accordingly. The budget is one cached read plus one indexed
 * per-user query in the common case; the third query only fires for the person
 * who has no bracket at all, and only once a gap has already been found.
 */

export interface PickGapPrompt {
  tournamentId: string
  name: string
  location: string | null
  flagEmoji: string | null
  /** canonical /tournaments/<slug> segment, null when the row has no series */
  seriesSlug: string | null
  /** earliest round with a pickable, unpicked match */
  round: string
  /** how many matches in that round are still empty */
  missing: number
  /** false when they have never opened a bracket here at all */
  hasBracket: boolean
}

/**
 * The draw reduced to what `findPickGaps` reads, plus the played match ids.
 *
 * One entry per tournament, shared across every user — which is the only reason
 * this is affordable in Nav. Players, seeds and countries are dropped before the
 * value is cached, so a grand slam costs a few kilobytes rather than the whole
 * bracket snapshot.
 *
 * 60s to match `getLiveTournaments`, and tagged `tournament-list` so saving a
 * draw or entering a result does not leave the notice pointing at a round that
 * has already been played. Worst case the notice is one minute stale, which
 * costs a click on a round that turns out to be locked.
 */
export const getBracketShape = unstable_cache(
  async (tournamentId: string): Promise<{ matches: GapMatch[]; played: string[] }> => {
    const admin = createAdminClient()

    const [{ data: draw, error: drawError }, { data: results, error: resultsError }] = await Promise.all([
      admin.from('draws').select('bracket_data').eq('tournament_id', tournamentId).maybeSingle(),
      admin.from('match_results').select('external_match_id').eq('tournament_id', tournamentId),
    ])

    if (drawError) console.error('[pick-gaps] draw lookup failed:', drawError.message)
    if (resultsError) console.error('[pick-gaps] results lookup failed:', resultsError.message)

    const raw = (draw?.bracket_data as { matches?: Array<{ matchId: string; round: string }> })?.matches ?? []

    return {
      matches: toGapMatches(raw),
      played: (results ?? []).map(r => r.external_match_id),
    }
  },
  ['bracket-shape'],
  { revalidate: 60, tags: ['tournament-list'] },
)

/**
 * Would sending them to this bracket dead-end on the slot screen?
 *
 * Only asked about a tournament they have no prediction in — one ATP and one
 * WTA entry per ISO week, so somebody already entered elsewhere this week would
 * land on predict/page.tsx's "slot taken" screen. A notice that promises points
 * and delivers a wall is worse than no notice, so this mirrors that page's
 * pre-check rather than trusting it to be rare.
 *
 * Including its exemptions: that page skips the limit entirely for the sandbox
 * and for hand-entered tournaments, and today every real tournament is
 * hand-entered — so this is dead weight until that changes, which is exactly
 * why it has to keep matching rather than be dropped.
 */
async function slotIsFree(
  userId: string,
  tournament: { id: string; tour: string; starts_at: string; ends_at: string },
): Promise<boolean> {
  const supabase = await createClient()
  const weeks = getTournamentISOWeeks(tournament.starts_at, tournament.ends_at)
  if (weeks.length === 0) return true

  const { data, error } = await supabase
    .from('weekly_slots')
    .select('tournament_id')
    .eq('user_id', userId)
    .eq('circuit', tournament.tour)
    .in('iso_year', [...new Set(weeks.map(w => w.year))])
    .in('iso_week', weeks.map(w => w.week))
    .neq('tournament_id', tournament.id)
    .limit(1)

  // Fail closed: an error here means we cannot tell, and the cost of guessing
  // wrong is a notice that lands on a wall.
  if (error) {
    console.error('[pick-gaps] weekly slot check failed:', error.message)
    return false
  }
  return (data?.length ?? 0) === 0
}

export async function getPickGapPrompt(userId: string): Promise<PickGapPrompt | null> {
  // In `pre_tournament` mode an in-progress tournament is not predictable at
  // all and the CTA would redirect straight back — no notice to show.
  if (!(await canPredictForStatus('in_progress'))) return null

  const live = await getLiveTournaments(4)
  if (live.length === 0) return null

  const supabase = await createClient()
  const { data: predictions, error } = await supabase
    .from('predictions')
    .select('tournament_id, picks, is_fully_locked')
    .eq('user_id', userId)
    .is('challenge_id', null)
    .in('tournament_id', live.map(t => t.id))

  if (error) {
    console.error('[pick-gaps] predictions lookup failed:', error.message)
    return null
  }

  const byTournament = new Map(predictions?.map(p => [p.tournament_id, p]) ?? [])

  for (const t of live) {
    // The sandbox tournament exists for the test harness. Nobody is missing out
    // on it. (`is_manual` does NOT identify it — every real tournament here is
    // manual, because the draws are entered by hand.)
    if (t.external_id === TEST_EXTERNAL_ID) continue

    const prediction = byTournament.get(t.id)

    // They pressed "Lock all picks". Nothing in the bracket can move, so there
    // is no round left for them to predict however many holes it has.
    if (prediction?.is_fully_locked === true) continue

    const { matches, played } = await getBracketShape(t.id)
    if (matches.length === 0) continue

    const picks = (prediction?.picks ?? {}) as Record<string, string>
    const gaps = findPickGaps(
      matches,
      new Set(played),
      new Set(Object.keys(picks).filter(id => Boolean(picks[id]))),
    )

    if (!gaps.nextRound) continue   // picked through to the final — nothing to say

    const slotLimited = t.is_manual !== true && t.external_id !== TEST_EXTERNAL_ID
    if (!prediction && slotLimited && !(await slotIsFree(userId, t))) continue

    return {
      tournamentId: t.id,
      name: t.name,
      location: t.location ?? null,
      flagEmoji: t.flag_emoji ?? null,
      seriesSlug: t.slug ?? null,
      round: gaps.nextRound,
      missing: gaps.rounds[0].missing,
      hasBracket: Boolean(prediction),
    }
  }

  return null
}
