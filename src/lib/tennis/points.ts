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
  // These two were the odd ones out: grand_slam and masters_1000 above have
  // always been the real ATP tables value for value, while 250 and 500 carried
  // invented numbers sitting 40–55% below ATP (a 250 semifinal paid 45 against
  // ATP's 100). Realigned 2026-08-24 so all four tiers mean the same thing.
  //
  // NO R64 ROW, and that is deliberate rather than an omission. A 48-player
  // draw is laid out in a 64 bracket — 16 seeds take byes, 32 players play a
  // real first round — so R64 matches genuinely exist at these tiers, and
  // `getPointsForRound` ends in `?? 0`, so every one of them pays nothing.
  // That is the ATP rule: a first-round loser at a 250 or 500 earns no ranking
  // points at all. Winston-Salem 2026 is the first such event here and its 16
  // first-round matches score zero because of this line. Do not "fix" it by
  // adding an R64 row without deciding to diverge from ATP on purpose.
  //
  // The F rows are unreachable — every caller passes `isWinner` for round 'F',
  // so `getPointsForRound` short-circuits to WINNER_POINTS — but they carry the
  // real ATP runner-up figures anyway, so a reader is not misled and a future
  // caller that stops forcing isWinner degrades to the right number instead of
  // to a made-up one.
  '500': {
    R32:  25,
    R16:  50,
    QF:   100,
    SF:   200,
    F:    330,
    // W = 500
  },
  '250': {
    R32:  13,
    R16:  25,
    QF:   50,
    SF:   100,
    F:    165,
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
 * Every round in the scoring table, as a list.
 *
 * Written as the keys of a `Record<Round, true>` on purpose: adding a member to
 * the `Round` union makes this object fail to typecheck until the new round is
 * listed here, so the list cannot silently fall behind the type.
 */
const ALL_ROUNDS = Object.keys({
  R128: true, R64: true, R32: true, R16: true, QF: true, SF: true, F: true,
} satisfies Record<Round, true>) as Round[]

/**
 * The (category, round) pairs where a correct pick earns nothing.
 *
 * The award-points cron skips a result entirely when its round pays zero
 * (`if (basePoints <= 0) continue`), so those correct picks never get a
 * point_ledger row — not because they are pending, but because they are
 * finished. Anything asserting "every correct pick has a ledger row" has to
 * subtract this set first or it reports permanent, unfixable pending work.
 * That is exactly what the admin "not awarded" banner did for the 807 correct
 * R64 picks at Winston-Salem 2026, the first 250 played here.
 *
 * Derived from `getPointsForRound`, never hand-listed: this is the same
 * function the cron scores with, called with the same `isWinner` rule, so the
 * set cannot drift from what actually pays. Callers outside TypeScript (the
 * `scoring_status` SQL function) are passed the result rather than keeping
 * their own copy of the table.
 */
export function unpaidRounds(): Array<{ category: TournamentCategory; round: Round }> {
  const out: Array<{ category: TournamentCategory; round: Round }> = []
  for (const category of Object.keys(POINTS_TABLE) as TournamentCategory[]) {
    for (const round of ALL_ROUNDS) {
      // Mirrors the cron: it forces isWinner for 'F', so a final always pays.
      if (getPointsForRound(category, round, round === 'F') <= 0) {
        out.push({ category, round })
      }
    }
  }
  return out
}

/**
 * The earlier of two optional ISO timestamps, or whichever one is present.
 *
 * Used to decide when a match stopped being predictable. Returns undefined only
 * when neither is known, which the caller reads as "no evidence either way" and
 * falls back to the pre-099 rule rather than guessing.
 */
function earliest(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return Date.parse(a) <= Date.parse(b) ? a : b
}

/**
 * Calculates the streak multiplier for a correct prediction.
 *
 * Formula: 1 + n, where n = number of consecutive previous rounds where the
 * user correctly predicted the same player winning, traced backwards through
 * the bracket's feeder chain — and, once commit times exist, where that round
 * was still undecided when this pick was committed.
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
 *
 * `lockTimes`, `playedAt` and `adminLockedAt` add the stacking rule: a link
 * counts only if THIS pick was committed BEFORE that link's match stopped being
 * an honest unknown. The multiplier therefore measures how many rounds below a
 * pick were still open at the moment it was committed — the risk the pick
 * actually carried — rather than how long the run happens to be.
 *
 * Waiting for a round to resolve and re-picking the winner is not a prediction.
 * Neither is assembling a run one round at a time, each pick blind only to the
 * round directly beneath it: that used to score the same as calling the whole
 * run in advance, and no longer does.
 *
 * "Stopped being an unknown" is the EARLIER of two moments, and it has to be
 * both: `played_at` is when the result was ENTERED, which on this app is by
 * hand and can be hours after the match finished, while `locked_matches` is
 * when the organiser froze the match because it was starting. Using the result
 * alone would hand a stacking credit to anyone who watched the match end and
 * locked their next round before the operator got to the keyboard.
 *
 * Both are optional, and that is the forward-only switch: `pick_lock_times`
 * only exists for picks committed after migration 099, so a link with no
 * recorded lock time is judged by the old rule and historical brackets keep
 * the multipliers they were awarded. Nothing is repriced by a re-run.
 */
export function calculateStreakMultiplier(
  matchId: string,
  winnerExternalId: string,
  picks: Record<string, string>,
  feedMap: FeedMap,
  matches: DrawMatch[],
  lockedPicks?: Set<string>,
  committed?: ReadonlySet<string>,
  /** matchId -> ISO time the pick was committed (predictions.pick_lock_times). */
  lockTimes?: Record<string, string>,
  /** matchId -> ISO time the result was entered (match_results.played_at). */
  playedAt?: Record<string, string>,
  /** matchId -> ISO time the organiser locked the match (draws.locked_matches). */
  adminLockedAt?: Record<string, string>,
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

    // The stacking rule, anchored to THIS pick (2026-09-04).
    //
    // Every link is judged against the moment the scored pick was committed —
    // `matchId`, fixed — not against the moment that link's own downstream pick
    // was committed. So the multiplier counts exactly one thing: how many
    // rounds below this pick were still undecided when the player called it.
    //
    // The walking version (`lockTimes[currentMatchId]`) let a chain be
    // assembled a round at a time, each step blind only to the round directly
    // beneath it, and paid that the same as a call made blind to all of them.
    // Two players, same four picks on the same player: one who committed the
    // whole chain before the first round was played, and one who waited to see
    // that round land before committing the rest, both scored x4. Only the
    // first took the risk the x4 is meant to price.
    //
    // Reward tracks risk now: commit deep and early with three rounds still
    // open and it pays x4; commit the same pick once two of those rounds have
    // resolved and it pays x2, because that is what was actually at stake.
    //
    // Still skipped when either timestamp is missing, which is what keeps
    // pre-099 brackets scoring exactly as they always did.
    const committedAt = lockTimes?.[matchId]
    const decidedAt = earliest(playedAt?.[feederMatchId], adminLockedAt?.[feederMatchId])
    if (committedAt && decidedAt && Date.parse(committedAt) >= Date.parse(decidedAt)) {
      break
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
