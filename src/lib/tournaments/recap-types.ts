import { ROUND_LABEL } from '@/lib/tennis/my-tournament'
import { formatPoints } from '@/lib/utils/format'
import { nameToFlag } from '@/app/admin/countries'

/**
 * Recap shapes and the pure functions that format them.
 *
 * Split from `recap.ts` on purpose: that module imports `createAdminClient` at
 * the top level, and `TournamentCard` is rendered by two CLIENT components
 * (`TournamentsClientList`, `AdminPanel`). Importing the data layer from the
 * card would drag supabase-js into their bundles for code that can never run
 * there. Nothing in this file touches the network, so it is safe on both sides.
 */

// ── Payload shape ────────────────────────────────────────────────────────────
//
// Every field is optional. The builder wraps its result in `jsonb_strip_nulls`,
// so a stat with nothing to say is ABSENT rather than null — a tournament with
// no final entered has no `crowd_favourite` key at all. Optional-everywhere is
// the honest type for that, and it forces each render site to decide what to do
// when a stat is missing instead of printing a zero it invented.

export interface RecapPlayer {
  id: string
  name: string
  country?: string | null
}

export interface RecapMatchStat {
  winner: RecapPlayer
  loser: RecapPlayer
  round: string
  score?: string | null
  sample: number
  pct: number
}

export interface RecapPayload {
  version: number
  built_at: string

  participation?: {
    brackets: number
    matches: number
    picks_made: number
    points_awarded: number
    challenges: number
  }

  /** Most-backed champion across every bracket's final slot. */
  crowd_favourite?: { player: RecapPlayer; backers: number; sample: number; was_right: boolean }
  /** Most pick slots naming this player, anywhere in the draw. */
  most_picked?: { player: RecapPlayer; picks: number; brackets: number }
  /** Lowest backing at first appearance. */
  least_picked?: { player: RecapPlayer; backers: number; sample: number; backing_pct: number }
  /** Player whose wins paid out the most points across all brackets. */
  points_machine?: { player: RecapPlayer; points: number; scoring_picks: number }
  /** Most-backed champion who did not reach the final, and where they went out. */
  biggest_bust?: { player: RecapPlayer; backers: number; sample: number; exit_round: string }
  /** Least-backed player to reach the quarterfinals. `reached` is 'W' for the champion. */
  dark_horse?: { player: RecapPlayer; backing_pct: number; backers: number; sample: number; reached: string }

  accuracy?: { decided: number; correct: number; pct: number }
  rounds?: Array<{ round: string; decided: number; correct: number; pct: number }>
  hardest_round?: { round: string; pct: number; decided: number; median_pct: number }
  chalk_vs_chaos?: { decided: number; upsets: number; upset_pct: number }
  bracket_buster?: RecapMatchStat & { called_it: number }
  unanimous_and_wrong?: RecapMatchStat & { backed_loser: number }

  podium?: Array<{ username: string; points: number }>
  champion_callers?: { callers: number; sample: number; pct?: number; player: RecapPlayer }
  best_round?: { username: string; round: string; correct: number; decided: number }
  crowd_bracket?: { correct: number; decided: number; beaten: number; field: number; percentile: number }
}

/**
 * Below this many brackets, a percentage is noise wearing a lab coat: "0% of
 * three people called it" is a statement about the sample, not about the
 * tournament. Same threshold and the same reasoning as `src/lib/social/data.ts`.
 */
export const MIN_SAMPLE = 10

/**
 * Whether a stat's percentage can be quoted — measured against ITS OWN sample,
 * never against the tournament's bracket count.
 *
 * This distinction is the whole ballgame, and getting it wrong is not
 * hypothetical: at the 2026 Mifel Open, 91 people entered a bracket and exactly
 * 4 of them filled in the final. Gating on the 91 would have printed "67% of
 * brackets backed Mensik to win it" from three picks.
 *
 * Most users fill the first round and abandon the bracket — point_ledger shows
 * the same shape (369 rows in R32, 5 in R16, 2 in QF) — so later-round samples
 * are routinely an order of magnitude smaller than the entry count. Every stat
 * therefore carries the sample it was computed from, and every percentage is
 * checked against that number.
 */
export function canQuotePct(stat: { sample: number } | undefined | null): boolean {
  return (stat?.sample ?? 0) >= MIN_SAMPLE
}

/**
 * Backing rate above which "dark horse" is not a claim the number supports.
 *
 * The builder returns the LEAST-backed player to reach the quarterfinals, which
 * on a 32-draw with a shallow field can still be someone 41% of brackets picked
 * — and in a two-player match the neutral expectation is 50%, so 41% is barely
 * an underdog. Calling that a dark horse is the label doing work the data has
 * not done. Below 30% the story is real; above it the card is simply dropped.
 */
export const DARK_HORSE_MAX_PCT = 30

export function isDarkHorse(dh: { sample: number; backing_pct: number } | undefined | null): boolean {
  return !!dh && canQuotePct(dh) && dh.backing_pct <= DARK_HORSE_MAX_PCT
}

// ── Formatting ───────────────────────────────────────────────────────────────

export interface Highlight {
  /** Short label — the stat's name. */
  label: string
  /** The answer: usually a player or a number. */
  value: string
  /** The evidence behind it. Omitted when the sample is too small to quote. */
  detail?: string
}

/**
 * '🇪🇸 Carlos Alcaraz', or just the name when the country is unknown.
 *
 * The payload stores the registry's country NAME ("Spain"), because that is
 * what `players.country` holds; the emoji is derived at render time so a stored
 * recap never has to be rebuilt to fix a flag.
 */
export function playerLabel(p: RecapPlayer | undefined): string {
  if (!p) return '—'
  const flag = nameToFlag(p.country)
  return flag ? `${flag} ${p.name}` : p.name
}

export function roundName(round: string): string {
  if (round === 'W') return 'the title'
  return ROUND_LABEL[round] ?? round
}

/**
 * A round as it reads inside a sentence — "in R32", "in the semifinals".
 *
 * Needed because ROUND_LABEL mixes two kinds of name: early rounds keep their
 * code ("R32") and late rounds spell out ("Semifinal"). Lower-casing the label
 * to fit a sentence therefore produced "correct in the r32", and leaving it
 * alone produced "went out in the Semifinal". Only the spelled-out ones take an
 * article and a lower-case first letter, so the distinction has to be explicit.
 */
export function roundPhrase(round: string): string {
  switch (round) {
    case 'W': return 'the title'
    case 'F': return 'the final'
    case 'SF': return 'the semifinals'
    case 'QF': return 'the quarterfinals'
    default: return ROUND_LABEL[round] ?? round
  }
}

/** Whole percent, for a count against a sample that is known to be non-zero. */
function share(count: number, sample: number): number {
  return Math.round((count / sample) * 100)
}

/**
 * The lines that go on a completed tournament card.
 *
 * Ordered by how much of a story each one tells, and filtered by sample size —
 * a stat whose percentage cannot be quoted honestly is skipped rather than
 * softened, so a four-entrant tournament shows fewer lines instead of
 * confident-looking noise. The full set still renders on the recap page, where
 * there is room to caveat.
 */
export function cardHighlights(payload: RecapPayload | null | undefined, max = 3): Highlight[] {
  if (!payload) return []

  const out: Highlight[] = []

  // Each of these is gated on its OWN sample, so a tournament where nobody
  // filled past the first round simply falls through to the stats that do have
  // a sample — points machine, upsets, accuracy — rather than printing a
  // confident percentage drawn from three brackets. Fewer lines beats wrong ones.
  const cf = payload.crowd_favourite
  if (canQuotePct(cf) && cf) {
    out.push({
      label: "Crowd's pick",
      value: playerLabel(cf.player),
      detail: `${share(cf.backers, cf.sample)}% backed them${cf.was_right ? ' — and they were right' : ''}`,
    })
  }

  const bust = payload.biggest_bust
  if (canQuotePct(bust) && bust && bust.backers > 0) {
    out.push({
      label: 'Biggest bust',
      value: playerLabel(bust.player),
      detail: `${share(bust.backers, bust.sample)}% had them winning it — out in ${roundPhrase(bust.exit_round)}`,
    })
  }

  const pm = payload.points_machine
  if (pm) {
    out.push({
      label: 'Points machine',
      value: playerLabel(pm.player),
      detail: `${formatPoints(pm.points)} pts paid out across every bracket`,
    })
  }

  const dh = payload.dark_horse
  if (isDarkHorse(dh) && dh) {
    out.push({
      label: 'Dark horse',
      value: playerLabel(dh.player),
      detail: `Only ${dh.backing_pct}% backed them — reached ${roundPhrase(dh.reached)}`,
    })
  }

  // No sample gate: this is a count of MATCHES, not of brackets. "16 of 31
  // matches went against the crowd" is a fact about the draw, and it is exactly
  // as true whether ten people entered or ten thousand.
  const chaos = payload.chalk_vs_chaos
  if (chaos && chaos.decided > 0) {
    out.push({
      label: 'Upsets',
      value: `${chaos.upsets} of ${chaos.decided}`,
      detail: 'matches went against the crowd',
    })
  }

  // Likewise: `decided` counts picks, and it is large whenever anyone played.
  const acc = payload.accuracy
  if (acc && acc.decided >= MIN_SAMPLE) {
    out.push({
      label: 'Community accuracy',
      value: `${acc.pct}%`,
      detail: `${formatPoints(acc.correct)} of ${formatPoints(acc.decided)} picks called right`,
    })
  }

  return out.slice(0, max)
}
