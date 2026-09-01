/**
 * Challenge scope — which rounds of a draw a challenge is played over.
 *
 * A slam draw is 127 matches. Asking two friends to each fill all of them is
 * why challenges do not get finished, and an unfinished bracket against a full
 * one is not a contest: more picks strictly dominates for points, and the
 * `award-points` tiebreak rewards volume on top of that. Scoping a challenge to
 * a handful of rounds makes it a thing both sides complete.
 *
 * `scope_round` on the challenge row is the FIRST round in scope; the scope
 * always runs from there to the final. NULL means the whole draw.
 *
 * Imports are deliberately from the submodules rather than the `@/lib/tennis`
 * barrel: that index calls `createProvider()` at module load and throws without
 * TENNIS_API_KEY, so it cannot be pulled into a client bundle. This module is
 * used on both sides.
 */
import { ROUND_ORDER } from '@/lib/tennis/my-tournament'
import { isByeMatch } from '@/lib/tennis/bracket'
import type { DrawMatch } from '@/lib/tennis/types'

/**
 * Widened once here so callers can pass plain strings. `ROUND_ORDER` is a
 * `const` tuple of the `Round` union, and every round that reaches this module
 * has been round-tripped through JSONB, where it is only ever a string.
 */
const ORDER: readonly string[] = ROUND_ORDER

/** Draw rounds, earliest first. The stored order is not guaranteed. */
export function sortRounds(rounds: string[]): string[] {
  return rounds.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
}

/**
 * The rounds a challenge is played over.
 *
 * An unknown `scopeRound` degrades to the full draw rather than to an empty
 * bracket — a hand-edited row or a draw that lost a round should cost the
 * players nothing.
 */
export function roundsInScope(drawRounds: string[], scopeRound: string | null): string[] {
  const sorted = sortRounds(drawRounds)
  if (!scopeRound) return sorted
  const start = sorted.indexOf(scopeRound)
  if (start === -1) return sorted
  return sorted.slice(start)
}

export function isRoundInScope(
  round: string,
  drawRounds: string[],
  scopeRound: string | null,
): boolean {
  if (!scopeRound) return true
  return roundsInScope(drawRounds, scopeRound).includes(round)
}

/** Match ids a scoped challenge covers — byes excluded, they are not picks. */
export function matchIdsInScope(
  matches: DrawMatch[],
  drawRounds: string[],
  scopeRound: string | null,
): Set<string> {
  const scoped = new Set(roundsInScope(drawRounds, scopeRound))
  return new Set(
    matches.filter(m => scoped.has(m.round) && !isByeMatch(m)).map(m => m.matchId),
  )
}

/**
 * Prose name of each round, for use inside a sentence.
 *
 * Not derived from `ROUND_LABEL`: that map is display shorthand — it holds
 * 'R64' for R64 — and lower-casing it produced "From the r64". The predictor
 * keeps its own copy of this same table for the same reason.
 */
const ROUND_PROSE: Record<string, string> = {
  R128: 'round of 128',
  R64:  'round of 64',
  R32:  'round of 32',
  R16:  'round of 16',
  QF:   'quarterfinals',
  SF:   'semifinals',
  F:    'final',
}

/**
 * Human name for a scope, used in headings, cards and notifications.
 *
 * "From the quarterfinals" rather than "QF onward": this string appears in a
 * sentence far more often than in a table.
 */
export function scopeLabel(scopeRound: string | null): string {
  if (!scopeRound) return 'Full draw'
  if (scopeRound === 'F') return 'The final'
  const prose = ROUND_PROSE[scopeRound]
  // An unrecognised round is shown verbatim rather than dressed up in prose
  // that would read as a real round name.
  if (!prose) return `From ${scopeRound}`
  return `From the ${prose}`
}

/** Short form for chips and list rows, where the sentence form is too long. */
export function scopeChip(scopeRound: string | null): string {
  if (!scopeRound) return 'Full draw'
  return `${scopeRound}+`
}

export interface ScopeOption {
  /** null = the whole draw. */
  round: string | null
  label: string
  /**
   * Matches still to be played in this scope — what each player actually has
   * left to pick, and the number that answers "will we finish this?".
   *
   * Deliberately not the total size of the scope. A challenge started on day
   * five of a slam covers 127 matches on paper and perhaps 30 in practice;
   * quoting the paper figure would make every mid-tournament contest look
   * unplayable, which is the exact problem scoping exists to solve.
   */
  matchCount: number
}

/**
 * Which scopes may be offered for this draw right now.
 *
 * Two conditions, and the second is subtler than it looks:
 *
 * 1. Every contested match BEFORE the round must be played. That is what keeps
 *    a scoped bracket honest — each name in it arrives from a played match, so
 *    nothing feeds in from picks the player was never asked to make.
 *
 * 2. The round must have an undecided match OF ITS OWN. Not "somewhere from
 *    here to the final" — that was the first version, and it offered scopes
 *    that were the same contest wearing different names. Once the round of 16
 *    is complete, "full draw" and "from the quarterfinals" cover an identical
 *    set of live matches; the first just adds eight foregone picks. Offering
 *    both asked the user to choose between a thing and a worse copy of it.
 *
 * Together these are stricter than they first look: a round with an undecided
 * match fails condition 1 for every later round, so in practice this returns
 * exactly ONE option — the round play has actually reached — or none once the
 * draw is over. That is not a limitation of the implementation but of bracket
 * prediction itself: you cannot pick a quarterfinal until you know who is in
 * it. Early in a tournament the only legal contest is the full draw; by the
 * second week it is a ten-match one two friends will finish.
 *
 * The return type stays a list because the shape is right for a second axis
 * that would genuinely offer a choice — scoping by SECTION of the draw ("the
 * top quarter"), which is self-contained and so legal from day one. That is not
 * built; `scope_round` cannot express it.
 */
export function availableScopes(
  matches: DrawMatch[],
  drawRounds: string[],
  matchResults: Record<string, string>,
): ScopeOption[] {
  const sorted = sortRounds(drawRounds)
  const contested = matches.filter(m => !isByeMatch(m))
  const isUndecided = (m: DrawMatch) => matchResults[m.matchId] === undefined

  const options: ScopeOption[] = []

  for (let i = 0; i < sorted.length; i++) {
    const round = sorted[i]
    const earlier = new Set(sorted.slice(0, i))

    const earlierSettled = contested
      .filter(m => earlier.has(m.round))
      .every(m => !isUndecided(m))
    if (!earlierSettled) continue

    // Condition 2 — this round itself must still have something to play for.
    if (!contested.some(m => m.round === round && isUndecided(m))) continue

    const liveInScope = contested.filter(
      m => sorted.indexOf(m.round) >= i && isUndecided(m),
    ).length

    const isFullDraw = i === 0
    options.push({
      round: isFullDraw ? null : round,
      label: isFullDraw ? 'Full draw' : scopeLabel(round),
      matchCount: liveInScope,
    })
  }

  return options
}
