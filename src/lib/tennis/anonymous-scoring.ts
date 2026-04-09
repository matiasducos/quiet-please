/**
 * Scores anonymous challenge picks against match results.
 *
 * Reuses the same algorithm as the cron: base points × streak multiplier.
 * Pure function — no DB calls.
 */

import type { Round, TournamentCategory, DrawMatch } from './types'
import { type FeedMap, buildFeedMap } from './bracket'
import { getPointsForRound, calculateStreakMultiplier } from './points'

interface MatchResultEntry {
  external_match_id: string
  round: Round
  winner_external_id: string
  score: string | null
}

interface ScoringResult {
  totalPoints: number
  correctPicks: number
  totalResults: number
}

/**
 * Scores a set of picks against match results for a tournament.
 *
 * @param picks - The bracket picks: { matchId: playerExternalId }
 * @param matchResults - Array of match results for the tournament
 * @param category - Tournament category (grand_slam, masters_1000, etc.)
 * @param matches - The draw matches (for building the feed map / streak calculation)
 * @returns Total points, correct picks count, and total results count
 */
export function scoreAnonymousPicks(
  picks: Record<string, string>,
  matchResults: MatchResultEntry[],
  category: TournamentCategory,
  matches: DrawMatch[],
  lockedPicks?: string[],
): ScoringResult {
  const feedMap: FeedMap = buildFeedMap(matches)
  const lockedPicksSet = new Set(lockedPicks ?? [])

  let totalPoints = 0
  let correctPicks = 0
  const nonByeResults = matchResults.filter(r => r.score !== 'BYE')

  for (const result of nonByeResults) {
    // Skip locked picks — made after match started, no points
    if (lockedPicksSet.has(result.external_match_id)) continue

    const userPick = picks[result.external_match_id]
    if (!userPick || userPick !== result.winner_external_id) continue

    // Correct pick — calculate points
    correctPicks++
    const isWinner = result.round === 'F'
    const basePoints = getPointsForRound(category, result.round, isWinner)
    const streakMultiplier = calculateStreakMultiplier(
      result.external_match_id,
      result.winner_external_id,
      picks,
      feedMap,
      matches,
      lockedPicksSet,
    )
    totalPoints += basePoints * streakMultiplier
  }

  return {
    totalPoints,
    correctPicks,
    totalResults: nonByeResults.length,
  }
}
