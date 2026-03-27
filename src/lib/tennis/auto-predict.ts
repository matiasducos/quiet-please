/**
 * Auto-prediction engine.
 *
 * Given a tournament draw, match results, and a user's priority player list,
 * generates bracket predictions by propagating picks round-by-round.
 *
 * For in-progress tournaments, already-played matches are treated as immutable
 * facts — the actual winner is used (not predicted), and the auto-predictor
 * only generates picks for remaining unplayed matches.
 *
 * Rules:
 *  - Already-played matches: use the actual result (immutable, not a "pick")
 *  - If one player in a match is in the priority list → pick that player.
 *  - If both are in the list → pick the higher-priority one (lower number).
 *  - If neither is in the list → leave unpredicted.
 *  - BYE matches auto-advance the real player (no pick needed).
 *  - Processing rounds in order (R128→F) ensures downstream matches
 *    can always resolve who won earlier rounds.
 */

import type { DrawMatch } from './types'
import {
  buildFeedMap,
  buildReverseFeedMap,
  isByeMatch,
  getMatchesByRound,
  getSortedRounds,
} from './bracket'

export interface PriorityPlayer {
  externalId: string
  priority: number // 1 = highest
}

export interface AutoPicksResult {
  picks: Record<string, string>       // matchId → playerExternalId
  pickSources: Record<string, string> // matchId → "auto"
}

/**
 * Generate auto-picks for a bracket given a user's priority player list.
 *
 * @param matches - The full bracket from the draw
 * @param priorityPlayers - User's priority players sorted by priority (1 = highest)
 * @param matchResults - Already-played match results: matchId → winnerExternalId.
 *                       These are treated as immutable facts, not predictions.
 * @returns picks + pickSources, or null if no picks could be generated
 */
export function generateAutoPicks(
  matches: DrawMatch[],
  priorityPlayers: PriorityPlayer[],
  matchResults: Record<string, string> = {},
): AutoPicksResult | null {
  if (priorityPlayers.length === 0 || matches.length === 0) return null

  // Priority lookup: externalId → priority (1 = best)
  const priorityMap = new Map<string, number>()
  for (const p of priorityPlayers) {
    priorityMap.set(p.externalId, p.priority)
  }

  const feedMap = buildFeedMap(matches)
  const reverseFeedMap = buildReverseFeedMap(feedMap)
  const byRound = getMatchesByRound(matches)
  const sortedRounds = getSortedRounds(matches)

  const picks: Record<string, string> = {}
  const pickSources: Record<string, string> = {}

  // Track determined winners per match.
  // Sources: BYE auto-advances, actual match results, and our auto-picks.
  // Later rounds use this to resolve who is in each slot.
  const matchWinners: Record<string, string> = {}

  // Phase 1a: Pre-populate BYE winners (any round)
  for (const m of matches) {
    if (isByeMatch(m)) {
      const winner = m.player1 ?? m.player2
      if (winner) {
        matchWinners[m.matchId] = winner.externalId
      }
    }
  }

  // Phase 1b: Pre-populate actual match results (already-played matches)
  // These are immutable facts — the auto-predictor does NOT override them.
  const playedMatchIds = new Set<string>()
  for (const [matchId, winnerId] of Object.entries(matchResults)) {
    matchWinners[matchId] = winnerId
    playedMatchIds.add(matchId)
  }

  // Phase 2: Process round-by-round, earliest to latest
  for (const round of sortedRounds) {
    const roundMatches = byRound[round]
    if (!roundMatches) continue

    for (const match of roundMatches) {
      // BYEs already handled — skip
      if (isByeMatch(match)) continue

      // Already-played matches are immutable — don't generate a pick
      if (playedMatchIds.has(match.matchId)) continue

      // Resolve who is in each slot (may be null if feeder match unresolvable)
      const p1Id = resolveSlotPlayer(match, 'player1', reverseFeedMap, matchWinners)
      const p2Id = resolveSlotPlayer(match, 'player2', reverseFeedMap, matchWinners)

      // Check if either resolved player is in the priority list
      const p1Priority = p1Id ? priorityMap.get(p1Id) : undefined
      const p2Priority = p2Id ? priorityMap.get(p2Id) : undefined

      let winnerId: string | null = null

      if (p1Priority !== undefined && p2Priority !== undefined) {
        // Both in list → lower priority number wins
        winnerId = p1Priority <= p2Priority ? p1Id! : p2Id!
      } else if (p1Priority !== undefined) {
        // p1 is in list (p2 may be known or unknown) → pick p1
        winnerId = p1Id!
      } else if (p2Priority !== undefined) {
        // p2 is in list (p1 may be known or unknown) → pick p2
        winnerId = p2Id!
      } else if (p1Id && p2Id) {
        // Both known but neither is in the priority list → leave unpredicted
        continue
      } else {
        // One or both slots unknown AND no priority player → skip
        continue
      }

      picks[match.matchId] = winnerId
      pickSources[match.matchId] = 'auto'
      matchWinners[match.matchId] = winnerId
    }
  }

  if (Object.keys(picks).length === 0) return null
  return { picks, pickSources }
}

/**
 * Resolve which player occupies a slot in a match.
 *
 * Checks in order:
 *  1. Direct draw data (first-round matches have players directly)
 *  2. Feeder match winner from matchWinners (BYE, result, or our pick)
 *
 * Returns the player's externalId, or null if unresolvable.
 */
function resolveSlotPlayer(
  match: DrawMatch,
  slot: 'player1' | 'player2',
  reverseFeedMap: Record<string, string>,
  matchWinners: Record<string, string>,
): string | null {
  // 1. Direct player on the draw
  const direct = match[slot]
  if (direct) return direct.externalId

  // 2. Find the feeder match for this slot
  const feederKey = `${match.matchId}:${slot}`
  const feederMatchId = reverseFeedMap[feederKey]
  if (!feederMatchId) return null

  // 3. Check if we determined a winner for the feeder match
  return matchWinners[feederMatchId] ?? null
}
