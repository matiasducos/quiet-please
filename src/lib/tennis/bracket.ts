/**
 * Shared bracket utilities — extracted from BracketPredictor.tsx
 * Used by both the client-side predictor and server-side scoring engine.
 */

import type { DrawMatch } from './types'

const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']

export type FeedMapEntry = { nextMatchId: string; slot: 'player1' | 'player2' }
export type FeedMap = Record<string, FeedMapEntry>

/**
 * A BYE match has exactly one real player and one null slot.
 * The non-null player auto-advances — no prediction needed.
 */
export function isByeMatch(match: DrawMatch): boolean {
  return (match.player1 !== null && match.player2 === null) ||
         (match.player1 === null && match.player2 !== null)
}

/**
 * Builds a forward feed map: matchId → { nextMatchId, slot }.
 * Given a match in round N, tells you which match in round N+1
 * it feeds into and which slot (player1 or player2) the winner fills.
 *
 * Based on positional ordering: match[i] in current round feeds into
 * match[floor(i/2)] in next round, slot = i%2===0 ? player1 : player2.
 */
export function buildFeedMap(matches: DrawMatch[]): FeedMap {
  const byRound: Record<string, DrawMatch[]> = {}
  for (const m of matches) {
    if (!byRound[m.round]) byRound[m.round] = []
    byRound[m.round].push(m)
  }

  const feedMap: FeedMap = {}

  const rounds = ROUND_ORDER.filter(r => byRound[r])
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const currentRound = rounds[ri]
    const nextRound = rounds[ri + 1]
    const current = byRound[currentRound]
    const next = byRound[nextRound]
    if (!next?.length) continue

    for (let i = 0; i < current.length; i++) {
      const nextMatchIndex = Math.floor(i / 2)
      const slot = i % 2 === 0 ? 'player1' : 'player2'
      if (next[nextMatchIndex]) {
        feedMap[current[i].matchId] = { nextMatchId: next[nextMatchIndex].matchId, slot }
      }
    }
  }

  return feedMap
}

/**
 * Builds a reverse feed map: for a given match + slot, which match fed into it?
 * Returns a map of `${matchId}:${slot}` → feeder matchId.
 */
export function buildReverseFeedMap(feedMap: FeedMap): Record<string, string> {
  const reverse: Record<string, string> = {}
  for (const [matchId, entry] of Object.entries(feedMap)) {
    reverse[`${entry.nextMatchId}:${entry.slot}`] = matchId
  }
  return reverse
}

/**
 * Groups matches by round.
 */
export function getMatchesByRound(matches: DrawMatch[]): Record<string, DrawMatch[]> {
  const byRound: Record<string, DrawMatch[]> = {}
  for (const m of matches) {
    if (!byRound[m.round]) byRound[m.round] = []
    byRound[m.round].push(m)
  }
  return byRound
}

/**
 * Returns the sorted list of rounds present in the match set,
 * ordered from earliest (R128) to latest (F).
 */
export function getSortedRounds(matches: DrawMatch[]): string[] {
  const rounds = Array.from(new Set(matches.map(m => m.round)))
  return rounds.sort((a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b))
}

/**
 * Finds which feeder match supplied a player to a specific slot of a given match.
 * Uses the reverse feed map to trace backwards.
 */
export function getFeederMatchId(
  matchId: string,
  slot: 'player1' | 'player2',
  reverseFeedMap: Record<string, string>,
): string | null {
  return reverseFeedMap[`${matchId}:${slot}`] ?? null
}
