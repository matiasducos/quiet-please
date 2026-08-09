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
 * Fill a bot's bracket the way a person fills one: pick a match, then carry
 * that pick forward so the next round has two named players to choose between.
 *
 * This used to refuse to cascade — a slot only counted as "known" if it came
 * from the draw, a BYE or a real result — on the reasoning that a speculative
 * pick is not a fact. The effect was that a bot could only ever fill matches
 * reality had already set up: round one at draw time, then whatever a new
 * result happened to expose between two cron runs. Since results here are
 * entered by hand, that made the outcome a function of typing schedule.
 * Measured across three finished tournaments, every one a different shape:
 *
 *   Washington  R32 100%, then 0% for every later round
 *   Mifel       R32 72%, R16 0%, QF 0%, SF 34%, F 0%
 *   Gstaad      R32 7% (brackets made after round one was played), F 100%
 *
 * A bracket is a chain of conditional predictions — "I think A wins, so I
 * think A plays B next" — so declining to cascade is declining to produce a
 * bracket. Cascading here does not weaken any guarantee: these picks are
 * already marked `bot_fill`, already locked on write, and already scored only
 * against real results, which are seeded below and never overwritten.
 *
 * Rules per match:
 *  - Skip BYEs, already-played matches, admin-locked matches, and matches
 *    that already have a pick.
 *  - If one player is in the priority list → pick them (both → lower number).
 *  - Otherwise → random 50/50.
 *
 * Returns picks + pickSources ('bot_fill'), or null if nothing to fill.
 */
export function generateGapFillPicks(
  matches: DrawMatch[],
  existingPicks: Record<string, string>,
  priorityPlayers: PriorityPlayer[],
  matchResults: Record<string, string> = {},
  adminLockedMatchIds: Set<string> = new Set(),
  random: () => number = Math.random,
): AutoPicksResult | null {
  if (matches.length === 0) return null

  const priorityMap = new Map<string, number>()
  for (const p of priorityPlayers) {
    priorityMap.set(p.externalId, p.priority)
  }

  const feedMap = buildFeedMap(matches)
  const reverseFeedMap = buildReverseFeedMap(feedMap)
  const byRound = getMatchesByRound(matches)
  const sortedRounds = getSortedRounds(matches)

  const matchWinners: Record<string, string> = {}
  for (const m of matches) {
    if (isByeMatch(m)) {
      const winner = m.player1 ?? m.player2
      if (winner) matchWinners[m.matchId] = winner.externalId
    }
  }
  // Real results are seeded after byes and are never overwritten below, so a
  // played match always resolves to what actually happened.
  for (const [matchId, winnerId] of Object.entries(matchResults)) {
    matchWinners[matchId] = winnerId
  }
  // Picks the bracket already holds cascade too. Without this, a bot that
  // filled round one on an earlier run would never resolve round two — the
  // chain would restart from facts every time and stall in the same place.
  for (const [matchId, winnerId] of Object.entries(existingPicks)) {
    if (matchWinners[matchId] === undefined) matchWinners[matchId] = winnerId
  }

  const picks: Record<string, string> = {}
  const pickSources: Record<string, string> = {}

  // Earliest round first: a later round can only resolve once the round
  // feeding it has been decided, which is the whole point of cascading.
  for (const round of sortedRounds) {
    for (const match of byRound[round] ?? []) {
      if (isByeMatch(match)) continue
      if (matchResults[match.matchId]) continue
      if (adminLockedMatchIds.has(match.matchId)) continue
      if (existingPicks[match.matchId]) continue

      const p1Id = resolveSlotPlayer(match, 'player1', reverseFeedMap, matchWinners)
      const p2Id = resolveSlotPlayer(match, 'player2', reverseFeedMap, matchWinners)
      // Still unresolvable — an admin-locked or unplayed feeder with no pick.
      // The chain stops here rather than guessing at a player who has no name.
      if (!p1Id || !p2Id) continue

      const p1Priority = priorityMap.get(p1Id)
      const p2Priority = priorityMap.get(p2Id)

      let winnerId: string
      if (p1Priority !== undefined && p2Priority !== undefined) {
        winnerId = p1Priority <= p2Priority ? p1Id : p2Id
      } else if (p1Priority !== undefined) {
        winnerId = p1Id
      } else if (p2Priority !== undefined) {
        winnerId = p2Id
      } else {
        winnerId = random() < 0.5 ? p1Id : p2Id
      }

      picks[match.matchId] = winnerId
      pickSources[match.matchId] = 'bot_fill'
      // The line that makes it a bracket rather than a list of guesses.
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
