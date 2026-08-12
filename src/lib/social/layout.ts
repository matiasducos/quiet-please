import type { CardSize } from './templates/frame'

/**
 * The two facts the admin studio and the card renderer must agree on.
 *
 * Both live here, with no imports beyond a type, because the studio is a client
 * component: `./data` pulls in the service-role Supabase client and
 * `./templates/frame` re-exports `./fonts`, which reads the font binaries off
 * disk with `node:fs`. Importing either into the browser bundle fails the build.
 *
 * They are shared rather than duplicated for a reason beyond tidiness — the
 * studio's checkbox list is what an admin approves and the PNG is what gets
 * posted. If the capacity or the wording drifted between the two, the approved
 * card and the published one would differ.
 */

/**
 * How many match rows fit on a recap card.
 *
 * Satori has no overflow handling worth the name: a row past the bottom of the
 * canvas is simply clipped, and the card is on its way to a public feed. So the
 * count is capped rather than trusted to the layout.
 *
 * The numbers are one lower than they were before per-match pick counts existed
 * — every match now carries a second line of its own — and lower again when the
 * podium is present, which costs roughly two match rows of height.
 *
 * Measured against the worst case, not the average one: the upset row is taller
 * than the others because it carries a badge, so a square that fits three plain
 * matches can still overpaint its own footer once one of the three is the upset.
 * At most one match per round is ever marked (see RecapArt), which is what makes
 * the worst case bounded and these numbers checkable.
 */
export function recapCapacity(size: CardSize, hasPodium: boolean): number {
  if (size === 'story') return hasPodium ? 4 : 6
  return hasPodium ? 3 : 4
}

/**
 * How many upcoming ties fit on the "Up next" card.
 *
 * Matches recapCapacity's no-podium figures, and for the same reason: the rows
 * are the same shape — a two-player line with a second line of crowd evidence
 * under it — and this card carries no podium at any size, so the taller budget
 * always applies. It has no upset badge either, which is the one thing that made
 * the recap's worst case taller than its average, so these numbers have slack
 * the recap's do not.
 */
export function upcomingCapacity(size: CardSize): number {
  return size === 'story' ? 6 : 4
}

/**
 * How many highlighted ties fit on the "Draw published" card.
 *
 * Lower than upcomingCapacity despite the rows being the same shape, because
 * this card spends its height on two things that card does not have: the
 * entrants stat block at the top, and a headline-sized "Predictions are open"
 * line at the bottom that wraps to two lines by design. Between them they cost
 * roughly the two rows the difference represents.
 *
 * Budgeted against the worst case at story: a two-line tournament title, five
 * rows each carrying a seed badge, and the closing line wrapping to two. That
 * leaves ~100px of the 1440px content band unspent, which is the margin for a
 * name that wraps somewhere unexpected.
 */
export function drawCapacity(size: CardSize): number {
  return size === 'story' ? 5 : 3
}

/**
 * "68% of brackets have Sinner", as it reads on the card and in the picker.
 *
 * The percentage is a share of the brackets that picked THIS match — never of
 * the tournament's entry count. Below MIN_SAMPLE (see ./data) the caller passes
 * a null pct and the head count carries the line alone: "7 brackets have Sinner"
 * is a fact at any sample size, where "23%" of seven brackets is not.
 *
 * Only the surname is used. The registry stores "Sinner, Jannik", and the full
 * form turns a five-word line into a nine-word one on a card measured in rows.
 */
export function favouriteLabel(name: string, count: number, pct: number | null): string {
  const surname = name.includes(',') ? name.split(',')[0].trim() : name
  if (pct != null) return `${pct}% of brackets have ${surname}`
  const brackets = `${count.toLocaleString('en-GB')} ${count === 1 ? 'bracket has' : 'brackets have'}`
  return `${brackets} ${surname}`
}

/**
 * How many stat rows fit on the tournament-recap card.
 *
 * Same reasoning as recapCapacity above, with one extra trap. The stats column
 * is centred vertically, so overflow does not simply clip at the bottom — it
 * spills from BOTH ends, and the first symptom is the tournament subtitle
 * disappearing under the hero block at the top. Measured, not estimated: at
 * three rows plus a podium the story card overpainted its own header and its
 * footer simultaneously.
 *
 * Budgeted against the worst case, which is a two-line tournament title
 * ("Mubadala Citi DC Open" wraps at story size) — that costs ~200px before the
 * content column starts. The square is half the height but carries a
 * single-line title and no podium, so it lands on the same figure.
 */
export function statsCapacity(size: CardSize, hasPodium: boolean): number {
  if (size === 'story') return hasPodium ? 2 : 3
  return 2
}

/**
 * "How many brackets called this match", as it reads on the card.
 *
 * `count` is null when the number is not known — the pick-count lookup failed,
 * or the tournament has no brackets to count. Null means print nothing at all;
 * it must never collapse into "0", which is a different and much louder claim.
 *
 * Zero gets its own sentence. "only 0% of brackets called it" was the previous
 * wording and it reads as a rounding artefact rather than the fact it is: not a
 * single bracket in the field had this result.
 */
export function pickedLabel(count: number | null, pct: number | null): string | null {
  if (count == null) return null
  if (count === 0) return 'No bracket called it'
  const brackets = `${count.toLocaleString('en-GB')} ${count === 1 ? 'bracket' : 'brackets'} called it`
  // The percentage is suppressed on small fields (see MIN_SAMPLE in ./data), but
  // the raw count is a plain fact and stays.
  return pct != null ? `${brackets} · ${pct}%` : brackets
}
