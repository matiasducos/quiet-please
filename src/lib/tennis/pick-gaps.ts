/**
 * "Which round can this person still predict, and have they?"
 *
 * Pure derivation, no queries — the same shape as my-tournament.ts, and for the
 * same reason: the answer is needed both by a notice that runs on every page
 * and by a verification script, so it must be callable without a request.
 *
 * The question is subtler than "picks < matches". A bracket entered halfway
 * through a tournament can never fill its first rounds — those matches are
 * played and unpickable forever — so a raw count says "incomplete" about a
 * bracket that is entirely caught up. What actually matters is whether there is
 * a match the person could pick *right now* and has not.
 *
 * A match is pickable when both of its slots resolve to somebody, and the
 * predictor fills a slot from whichever of these comes first (BracketPredictor
 * `getEffectivePlayer`):
 *
 *   1. the draw itself names the player  — first round, or a seeded bye
 *   2. the feeder match has been played  — the real winner advances
 *   3. the feeder match has been picked  — the user's own pick advances
 *
 * Which gives the useful property that makes this worth having: the earliest
 * round holding a pickable, unpicked match *is* "the next round to predict",
 * and having none of them left is exactly "predicted all the way to the final".
 * The final's slots resolve as soon as both semis carry a pick or a result, so
 * a bracket with no gaps cannot be missing the final.
 */

import { buildFeedMap } from './bracket'

export const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'] as const

/** Full wording for prose — "predict the Quarterfinals now". */
export const ROUND_PROSE: Record<string, string> = {
  R128: 'the Round of 128', R64: 'the Round of 64', R32: 'the Round of 32',
  R16: 'the Round of 16', QF: 'the Quarterfinals', SF: 'the Semifinals', F: 'the Final',
}

/** The same words without the article, for listing several — "the Quarterfinals, Semifinals and Final". */
const ROUND_NOUN: Record<string, string> = {
  R128: 'Round of 128', R64: 'Round of 64', R32: 'Round of 32',
  R16: 'Round of 16', QF: 'Quarterfinals', SF: 'Semifinals', F: 'Final',
}

/** "the Quarterfinals, Semifinals and Final" — the article carries the whole list. */
export function listRounds(rounds: string[]): string {
  const names = rounds.map(r => ROUND_NOUN[r] ?? r)
  if (names.length === 0) return ''
  if (names.length === 1) return `the ${names[0]}`
  return `the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * A draw match reduced to the four facts this file needs.
 *
 * Deliberately not `DrawMatch`. The caller caches these across every user on
 * the site, and a grand slam draw carries 127 matches each holding two player
 * objects with names, countries, rankings and seeds — none of which changes the
 * answer to "is this slot occupied". Booleans keep the cache entry small enough
 * to sit in front of a per-request read.
 */
export interface GapMatch {
  matchId: string
  round: string
  /** the draw itself names a player here (first round, or a bye) */
  hasPlayer1: boolean
  hasPlayer2: boolean
  /** exactly one real player and one null slot — advances for free, never picked */
  isBye: boolean
}

export interface RoundGap {
  round: string
  /** pickable matches in this round with no pick on them */
  missing: number
}

export interface PickGaps {
  /** earliest round holding a pickable, unpicked match — null when there are none */
  nextRound: string | null
  /** every round with a gap, earliest first */
  rounds: RoundGap[]
  /** pickable, unpicked matches across the whole draw */
  totalMissing: number
}

const EMPTY: PickGaps = { nextRound: null, rounds: [], totalMissing: 0 }

/**
 * Reduce a stored draw to the fields above.
 *
 * `bracket_data.matches` is a snapshot written by the admin draw builder, so
 * the slots are plain objects or null — a bye is a match with exactly one of
 * them filled, the same rule `isByeMatch` applies in the predictor.
 */
export function toGapMatches(
  matches: Array<{ matchId: string; round: string; player1?: unknown; player2?: unknown }>,
): GapMatch[] {
  return matches.map(m => {
    const hasPlayer1 = m.player1 != null
    const hasPlayer2 = m.player2 != null
    return {
      matchId: m.matchId,
      round: m.round,
      hasPlayer1,
      hasPlayer2,
      isBye: hasPlayer1 !== hasPlayer2,
    }
  })
}

/**
 * Every round this bracket would give up by locking right now, earliest first.
 *
 * Deliberately NOT `findPickGaps`. That one answers "what can you pick today",
 * so it stops at the rounds whose slots resolve — a bracket with the semis
 * unpicked has no gap in the final, because the final has nobody in it yet.
 * Locking does not stop there: it forecloses the semis, which forecloses the
 * final, all the way down. Warning about only the reachable round would understate
 * the cost of the button by two rounds on a bracket abandoned at the quarters.
 */
export function findForfeitedRounds(
  matches: GapMatch[],
  played: ReadonlySet<string>,
  picked: ReadonlySet<string>,
): string[] {
  const rounds = new Set<string>()
  for (const m of matches) {
    if (m.isBye) continue
    if (played.has(m.matchId)) continue   // already gone, locking costs nothing
    if (picked.has(m.matchId)) continue
    rounds.add(m.round)
  }
  return [...rounds].sort(
    (a, b) => ROUND_ORDER.indexOf(a as never) - ROUND_ORDER.indexOf(b as never),
  )
}

/**
 * @param matches draw matches, in draw order — `buildFeedMap` reads position
 * @param played  match ids with a recorded result, byes included
 * @param picked  match ids this bracket has a pick on
 */
export function findPickGaps(
  matches: GapMatch[],
  played: ReadonlySet<string>,
  picked: ReadonlySet<string>,
): PickGaps {
  if (matches.length === 0) return EMPTY

  const feedMap = buildFeedMap(matches)

  // nextMatchId → the feeder filling each of its slots.
  const feeders: Record<string, { player1?: string; player2?: string }> = {}
  for (const [matchId, entry] of Object.entries(feedMap)) {
    if (!feeders[entry.nextMatchId]) feeders[entry.nextMatchId] = {}
    feeders[entry.nextMatchId][entry.slot] = matchId
  }

  const byId = new Map(matches.map(m => [m.matchId, m]))

  /**
   * Does somebody come out of this match yet?
   *
   * Note the order: a result outranks a pick, which is what lets a bracket
   * that skipped a round still pick the next one — the real winner feeds
   * through the hole. Same precedence as the predictor.
   */
  function advances(matchId: string): boolean {
    const m = byId.get(matchId)
    if (!m) return false
    if (m.isBye) return true
    return played.has(matchId) || picked.has(matchId)
  }

  function slotFilled(m: GapMatch, slot: 'player1' | 'player2'): boolean {
    if (slot === 'player1' ? m.hasPlayer1 : m.hasPlayer2) return true
    const feeder = feeders[m.matchId]?.[slot]
    return feeder ? advances(feeder) : false
  }

  const missingByRound: Record<string, number> = {}
  let totalMissing = 0

  for (const m of matches) {
    if (m.isBye) continue
    if (played.has(m.matchId)) continue   // gone — this one can never be picked again
    if (picked.has(m.matchId)) continue
    if (!slotFilled(m, 'player1') || !slotFilled(m, 'player2')) continue

    missingByRound[m.round] = (missingByRound[m.round] ?? 0) + 1
    totalMissing++
  }

  if (totalMissing === 0) return EMPTY

  const rounds: RoundGap[] = Object.entries(missingByRound)
    .map(([round, missing]) => ({ round, missing }))
    .sort((a, b) => ROUND_ORDER.indexOf(a.round as never) - ROUND_ORDER.indexOf(b.round as never))

  return { nextRound: rounds[0].round, rounds, totalMissing }
}
