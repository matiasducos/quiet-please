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
  // R64 exists on these two tiers only for draws larger than 32 — a 48-player
  // field laid out in a 64 bracket, where the 16 seeds take byes and 32 players
  // actually play. Winston-Salem 2026 was the first such event in the database,
  // and until it arrived both tables started at R32; `getPointsForRound` ends in
  // `?? 0`, so all 16 of its real first-round matches paid nothing and 315
  // correct picks earned zero.
  //
  // Deliberately NOT the ATP value. ATP awards a first-round loser nothing at
  // these tiers, and the top two tables here are the real ATP tables to the
  // point — but a round with 16 live matches that cannot score is a dead round
  // for players, so this departs from ATP on this one row and keeps the shape
  // of the table it sits in (each round roughly double the one before).
  '500': {
    R64:  10,
    R32:  20,
    R16:  30,
    QF:   60,
    SF:   90,
    F:    150,
    // W = 500
  },
  '250': {
    R64:  3,
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

/**
 * Lock types that represent a commitment the player made *before* the result.
 *
 * `pick_locks` records how each pick came to be locked, and only three of the
 * four values mean the player chose it: 'voluntary' (one pick), 'round' (a whole
 * round) and 'auto_lock_all' (the entire bracket, or an auto-predict bracket,
 * which is generated and locked in one shot before play).
 *
 * The fourth, 'auto', is written by the award-points cron once a match has been
 * played, purely as a record. It is the one value that must NOT count: it
 * arrives after the answer is known, so treating it as a commitment would hand
 * the multiplier to everyone who never locked anything.
 */
const COMMITTED_LOCK_TYPES = new Set(['voluntary', 'round', 'auto_lock_all'])

/**
 * The picks in this bracket that were committed before their match was decided.
 *
 * Pass to `calculateStreakMultiplier` to gate the streak on locking. Omit it and
 * every pick counts, which is the pre-existing behaviour and what the anonymous
 * scorer still wants — those brackets have no lock UI to earn the multiplier
 * with.
 */
export function committedPicks(
  pickLocks: Record<string, string> | null | undefined,
): Set<string> {
  const out = new Set<string>()
  for (const [matchId, lockType] of Object.entries(pickLocks ?? {})) {
    if (COMMITTED_LOCK_TYPES.has(lockType)) out.add(matchId)
  }
  return out
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
 *
 * `committed` gates the whole thing on the player having locked. A streak is a
 * run of calls somebody stood behind, so an unlocked pick is worth base points
 * at x1 and ends the run — the next round starts from x1 again. That is the same
 * treatment `lockedPicks` already gives a pick made after its match was locked,
 * which is why both are handled at the same point in the trace rather than as
 * two competing notions of "streak".
 *
 * Omitting `committed` scores every pick as committed. The anonymous brackets
 * rely on that: they run this same function and have no way to lock.
 */
export function calculateStreakMultiplier(
  matchId: string,
  winnerExternalId: string,
  picks: Record<string, string>,
  feedMap: FeedMap,
  matches: DrawMatch[],
  lockedPicks?: Set<string>,
  committed?: ReadonlySet<string>,
): number {
  // An uncommitted pick has no streak of its own to speak of — base points x1.
  if (committed && !committed.has(matchId)) return 1

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

    // A locked pick (made after match started) breaks the streak chain
    if (lockedPicks?.has(feederMatchId)) break

    // So does one the player never committed to. Same rule, same place: a run
    // is only a run while every link was called in advance.
    if (committed && !committed.has(feederMatchId)) break

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
