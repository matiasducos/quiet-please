import type { Round, TournamentCategory, DrawMatch } from './types'
import { type FeedMap, buildReverseFeedMap, isByeMatch } from './bracket'

// Official ATP/WTA points per round
// Used by the points engine to score correct predictions
export const POINTS_TABLE: Record<TournamentCategory, Partial<Record<Round, number>>> = {
  grand_slam: {
    R128: 10,
    R64:  45,
    R32:  90,
    R16:  180,
    QF:   360,
    SF:   720,
    F:    1200,
    // W (winner) = 2000 — handled separately
  },
  masters_1000: {
    R128: 10,
    R64:  25,
    R32:  45,
    R16:  90,
    QF:   180,
    SF:   360,
    F:    600,
    // W = 1000
  },
  '500': {
    R32:  20,
    R16:  30,
    QF:   60,
    SF:   90,
    F:    150,
    // W = 500
  },
  '250': {
    R32:  6,
    R16:  13,
    QF:   29,
    SF:   45,
    F:    80,
    // W = 250
  },
}

// Winner points (separate because the round label is 'W' internally)
export const WINNER_POINTS: Record<TournamentCategory, number> = {
  grand_slam:   2000,
  masters_1000: 1000,
  '500':        500,
  '250':        250,
}

export function getPointsForRound(
  category: TournamentCategory,
  round: Round,
  isWinner: boolean
): number {
  if (isWinner && round === 'F') {
    return WINNER_POINTS[category]
  }
  return POINTS_TABLE[category][round] ?? 0
}

/**
 * Calculates the streak multiplier for a correct prediction.
 *
 * Formula: 1 + n, where n = number of consecutive previous rounds where
 * the user correctly predicted the same player winning, traced backwards
 * through the bracket's feeder chain.
 *
 * Example (ATP 250, user predicted Player X for every round):
 *   R32 → multiplier = 1 (no previous round)
 *   R16 → multiplier = 2 (streak: R32)
 *   QF  → multiplier = 3 (streak: R32, R16)
 *   SF  → multiplier = 4 (streak: R32, R16, QF)
 *   F   → multiplier = 5 (streak: R32 through SF)
 *
 * BYE matches are transparent: the algorithm traces through them without
 * counting them as part of the streak, since BYEs auto-advance.
 */
export function calculateStreakMultiplier(
  matchId: string,
  winnerExternalId: string,
  picks: Record<string, string>,
  feedMap: FeedMap,
  matches: DrawMatch[],
): number {
  const reverseFeedMap = buildReverseFeedMap(feedMap)
  const matchMap = new Map(matches.map(m => [m.matchId, m]))

  // Find which slot the winner occupies in this match to trace backwards
  const match = matchMap.get(matchId)
  if (!match) return 1

  // Determine which slot the winner came from
  const winnerSlot = getWinnerSlot(match, winnerExternalId, picks, matchMap, feedMap)
  if (!winnerSlot) return 1

  // Trace backwards through feeder matches
  let streak = 0
  let currentMatchId = matchId
  let currentSlot = winnerSlot

  while (true) {
    // Find the feeder match for this slot
    const feederMatchId = reverseFeedMap[`${currentMatchId}:${currentSlot}`]
    if (!feederMatchId) break // No feeder — first round reached

    const feederMatch = matchMap.get(feederMatchId)
    if (!feederMatch) break

    // If the feeder is a BYE, trace through it transparently
    if (isByeMatch(feederMatch)) {
      // BYE auto-advances — find which slot of the feeder's feeder
      // First, determine which slot of the feeder had the real player
      const feederEntry = feedMap[feederMatchId]
      if (!feederEntry) break // BYE in first round, end of chain

      // The BYE match's feeder slot tells us which half to trace
      // Since it's a BYE, we need to continue tracing the non-null side
      const byePlayer = feederMatch.player1 ?? feederMatch.player2
      if (!byePlayer || byePlayer.externalId !== winnerExternalId) break

      // Find which slot of the feeder match had the player (to trace further back)
      const byeSlot = feederMatch.player1 ? 'player1' : 'player2'
      // Look up the feeder's feeder for that slot
      const deeperFeederId = reverseFeedMap[`${feederMatchId}:${byeSlot}`]
      if (!deeperFeederId) break // BYE was in first round

      currentMatchId = feederMatchId
      currentSlot = byeSlot
      continue // Don't count BYE in streak, just pass through
    }

    // Normal match: check if user picked the same winner here
    if (picks[feederMatchId] === winnerExternalId) {
      streak++
      // Continue tracing: find which slot of the feeder match the winner occupied
      const feederWinnerSlot = getWinnerSlot(feederMatch, winnerExternalId, picks, matchMap, feedMap)
      if (!feederWinnerSlot) break
      currentMatchId = feederMatchId
      currentSlot = feederWinnerSlot
    } else {
      break // Streak broken
    }
  }

  return 1 + streak
}

/**
 * Determines which slot ('player1' | 'player2') a winner occupies in a match.
 * Handles cases where players are propagated from earlier rounds via picks.
 */
function getWinnerSlot(
  match: DrawMatch,
  winnerExternalId: string,
  picks: Record<string, string>,
  matchMap: Map<string, DrawMatch>,
  feedMap: FeedMap,
): 'player1' | 'player2' | null {
  // Direct match: player is directly seeded in this match
  if (match.player1?.externalId === winnerExternalId) return 'player1'
  if (match.player2?.externalId === winnerExternalId) return 'player2'

  // Indirect: player was propagated from a previous round via a pick
  // Check each feeder match to see which side the winner could come from
  for (const [feederId, entry] of Object.entries(feedMap)) {
    if (entry.nextMatchId !== match.matchId) continue
    const feederMatch = matchMap.get(feederId)
    if (!feederMatch) continue

    // Does the feeder resolve to the winner (via pick or BYE)?
    if (isByeMatch(feederMatch)) {
      const byePlayer = feederMatch.player1 ?? feederMatch.player2
      if (byePlayer?.externalId === winnerExternalId) return entry.slot
    } else if (picks[feederId] === winnerExternalId) {
      return entry.slot
    }
  }

  return null
}
