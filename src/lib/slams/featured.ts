import { ALL_SLAMS, type SlamConfig } from './config'
import { getSlamEditions, type SlamEditions } from './data'

/**
 * The next major whose draw has not been published yet, if one is close.
 *
 * Deliberately derived from the tournament rows rather than a hardcoded date.
 * The notice promises a draw that is still to come, so it has to stop the exact
 * moment an admin saves that draw — and the only thing that knows when that
 * happened is `tournaments.status`. A date constant would keep promising a draw
 * that already landed, and would need editing four times a year, forever.
 *
 * Reads through `getSlamEditions`, which shares one `unstable_cache` entry
 * across all four majors (see data.ts). So the four calls below are four
 * in-memory filters over a single cached query, not four round trips — and that
 * entry is tagged `tournament-list`, which `saveManualDraw` already busts. The
 * notice therefore retires itself within one render of the draw being published.
 */

/**
 * How early the notice starts running, in days before the first ball.
 *
 * Three weeks rather than a few days because the notice exists to grow the
 * field, not to announce a fixture: an invite sent the week before the draw is
 * a player on day one, while an invite sent the day the draw lands is somebody
 * still confirming their email while the first round is being played.
 */
const LEAD_DAYS = 21

const DAY_MS = 24 * 60 * 60 * 1000

export type FeaturedSlam = {
  config: SlamConfig
  editions: SlamEditions
  /**
   * Series slug for /play and /tournaments links, or null when no row has been
   * linked to a series yet.
   *
   * Read off the tournament row, never from `config.slug`: the two are
   * independent. `config.slug` names the landing page ('us-open') while the
   * series slug is admin-editable at /admin/tournaments/series, so assuming
   * they match produces links that 404 the moment someone renames a series.
   * Same reasoning as SlamLanding — see the note there.
   */
  seriesSlug: string | null
}

/**
 * Is this edition inside its pre-draw window? Null means "do not feature".
 *
 * `open` and `live` are deliberately excluded rather than ranked below
 * `upcoming`. The notice carries one fixed line — "The draw lands soon" — so
 * the honest lifetime of the notice is exactly the period during which that
 * sentence is true. Publishing the draw retires it, which is the correct
 * behaviour for this copy and one less thing to remember on the day.
 *
 * If the notice should keep running once the draw is out, this is the place to
 * relax — but it needs a second line of copy to go with it, because this one
 * becomes false the moment `saveManualDraw` flips the status.
 */
function isFeaturable(editions: SlamEditions, now: Date): boolean {
  if (editions.phase !== 'upcoming') return false
  if (!editions.nextStartsAt) return false
  const startsIn = Date.parse(editions.nextStartsAt) - now.getTime()
  if (!Number.isFinite(startsIn)) return false
  // A negative value means play has started with the status still `upcoming`,
  // i.e. the draw was never published. Keep showing it rather than dropping the
  // notice on the one day it matters most.
  return startsIn <= LEAD_DAYS * DAY_MS
}

/**
 * The major to feature right now, or null when none is close enough to matter.
 *
 * Null is the normal state for most of the year, and it is what keeps this from
 * being a permanent fixture in the nav — roughly 10 weeks of the season are
 * within `LEAD_DAYS` of a major.
 */
export async function getFeaturedSlam(now: Date = new Date()): Promise<FeaturedSlam | null> {
  const candidates = await Promise.all(
    ALL_SLAMS.map(async config => ({ config, editions: await getSlamEditions(config) })),
  )

  const eligible = candidates.filter(c => isFeaturable(c.editions, now))
  if (eligible.length === 0) return null

  // Never more than one in practice — the majors are months apart — but sorted
  // by start date rather than left to array order, so that if two ever do
  // overlap the sooner one wins instead of whichever comes first in ALL_SLAMS.
  eligible.sort((a, b) => {
    const at = a.editions.nextStartsAt ? Date.parse(a.editions.nextStartsAt) : Number.POSITIVE_INFINITY
    const bt = b.editions.nextStartsAt ? Date.parse(b.editions.nextStartsAt) : Number.POSITIVE_INFINITY
    return at - bt
  })

  const { config, editions } = eligible[0]
  return {
    config,
    editions,
    seriesSlug: editions.atp?.slug ?? editions.wta?.slug ?? null,
  }
}
