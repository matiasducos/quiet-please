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
 */
export function recapCapacity(size: CardSize, hasPodium: boolean): number {
  if (size === 'story') return hasPodium ? 4 : 6
  // Two, not three, on a square with a podium. Three overflowed by about 15px in
  // practice — "3rd place" printed straight through "108 brackets in play" — and
  // the square canvas is 840px shorter than the story with the same headline,
  // footer and podium to pay for. The measured numbers, verified in the studio.
  return hasPodium ? 2 : 4
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
