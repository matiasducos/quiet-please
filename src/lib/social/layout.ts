import type { CardSize } from './templates/frame'

/**
 * The facts the admin studio, the card renderer and the mailer must agree on.
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
 * Re-measured after the QP logo and the CTA footer came off the frame, which
 * returned ~257px of story height and ~213px of square — far more than the
 * enlarged evidence lines spend. These are heights, not editorial preferences:
 * leave them stale when the chrome changes and the reclaimed space just sits on
 * the card as a void while the template still prints "+ 2 more matches".
 *
 * Still lower when the podium is present, which costs roughly two match rows.
 *
 * Measured against the worst case, not the average one: the upset row is taller
 * than the others because it carries a badge, so a square that fits four plain
 * matches can still overpaint its own bottom edge once one of the four is the
 * upset. At most one match per round is ever marked (see RecapArt), which is what
 * makes the worst case bounded and these numbers checkable.
 */
export function recapCapacity(size: CardSize, hasPodium: boolean): number {
  if (size === 'story') return hasPodium ? 5 : 7
  return hasPodium ? 4 : 5
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
  return size === 'story' ? 8 : 6
}

/**
 * How many of those ties fit in the points-awarded email.
 *
 * A third medium for the same list, and it lives beside the card's figure for
 * the reason this file exists at all: the results page's checkbox list is what
 * the admin approves and the email is what gets sent, and both are rendered
 * from this number. A constant kept in the mailer would be invisible to the
 * picker, which would then let someone tick five ties and send four.
 *
 * FOUR, because a quarterfinal round is four ties in every draw size — and so
 * a semifinal is two and a final is one. At four, the sharp end of a tournament
 * is always shown whole, and the cap only ever bites in the early rounds, where
 * a round is 8 to 32 ties and some selection has to happen anyway. That is what
 * the admin's picker is for.
 *
 * It was three, derived by halving the smallest card. That was the wrong
 * reasoning applied to the wrong medium: the card's numbers are measurements,
 * because Satori clips whatever overflows, while an email scrolls and is
 * bounded only by attention. Copying the shape of a constraint into a medium
 * that does not have it cost exactly one quarterfinal, silently.
 *
 * Not a function of size, because an email has one width that matters — the
 * ~500px phone column.
 */
export const EMAIL_UPCOMING_CAPACITY = 4

/**
 * How many highlighted ties fit on the "Draw published" card.
 *
 * Lower than upcomingCapacity despite the rows being the same shape, because
 * this card spends its height on two things that card does not have: the
 * entrants stat block at the top, and a headline-sized "Predictions are open"
 * line at the bottom that wraps to two lines by design. Between them they cost
 * roughly the two rows the difference represents.
 *
 * Budgeted against the worst case at story: a two-line tournament title, every
 * row carrying a seed badge, and the closing line wrapping to two. The closing
 * line is pinned to the bottom with `marginTop: auto`, so whatever this number
 * leaves unspent shows up as one gap in the middle of the card rather than as
 * slack distributed through the list — which is why it is worth re-measuring
 * against the current chrome rather than leaving a safe old figure in place.
 */
export function drawCapacity(size: CardSize): number {
  return size === 'story' ? 9 : 6
}

/**
 * "7% of brackets have Sinner", as it reads on the card, in the picker and in
 * the points email.
 *
 * One shape, always a percentage. It used to fall back to a head count ("3
 * brackets have Sinner") whenever the sample was under ten, which fired on most
 * later-round ties — three of the last six tournaments had a median of three or
 * four brackets per match from the round of 16 on — so the line changed shape
 * exactly where it was published most.
 *
 * The share is out of every global bracket in the tournament, which is what
 * makes one shape safe: the number gets SMALLER as a round thins out, not
 * louder. The two sides of a tie therefore do not sum to 100, and a
 * quarterfinal reading "4% of brackets have Sinner" is not a broken statistic —
 * it is what abandonment looks like. See `pct` in ./data.
 *
 * Only the surname is used. The registry stores "Sinner, Jannik", and the full
 * form turns a five-word line into a nine-word one on a card measured in rows.
 */
export function favouriteLabel(name: string, pct: number): string {
  const surname = name.includes(',') ? name.split(',')[0].trim() : name
  return `${pct}% of brackets have ${surname}`
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
 * single-line title and no podium, so it lands close to the same figure.
 */
/**
 * How many named picks fit under the champion on a picks card.
 *
 * Budgeted against the worst case, which is Winston-Salem Open: a title that
 * wraps to two lines, a champion block, the points strip, and the call to
 * action. The CTA is the one element that cannot be dropped — a card nobody
 * can act on did nothing — so the picks give way to it, not the reverse.
 *
 * Six picks alongside the points strip overflowed, and the way it failed is
 * the reason these numbers are measurements rather than taste: Satori
 * compresses instead of clipping, so nothing was cut off. The call to action
 * was simply printed *through* the points block, both perfectly legible and
 * on top of each other. Nothing warns you; you have to render it and look.
 */
export function picksCapacity(size: CardSize, hasStanding: boolean): number {
  if (size === 'story') return hasStanding ? 4 : 7
  return hasStanding ? 2 : 4
}

export function statsCapacity(size: CardSize, hasPodium: boolean): number {
  if (size === 'story') return hasPodium ? 3 : 4
  return 3
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
  // pct() and count() now suppress under exactly the same two conditions, so a
  // non-null count arrives with a percentage. The fallback is defensive only —
  // it must never become the small-field behaviour again.
  return pct != null ? `${brackets} · ${pct}%` : brackets
}
