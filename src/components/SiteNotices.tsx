import FeaturedSlamNotice from './FeaturedSlamNotice'
import PickGapNotice from './PickGapNotice'
import { getPickGapPrompt } from '@/lib/tournaments/pick-gaps'

/**
 * At most one announcement bar, and which one.
 *
 * There are two now and their windows overlap: the invite notice runs for the
 * three weeks before a major's draw, which is roughly ten weeks of the season,
 * and something is nearly always on court during them. Two stacked bars above
 * the nav is 90px of a 375px viewport spent on announcements, so this picks.
 *
 * The pick-gap notice wins. It is about points already at stake in a tournament
 * this person entered, it expires when the next round starts, and it is the one
 * whose value the reader can measure. The invite ask has three weeks to land.
 *
 * Note that a *dismissed* pick-gap notice does not fall through to the invite
 * bar — the gap existing is what suppresses it, not the gap being shown. Having
 * a second, different bar appear in the same spot the instant you press × reads
 * as the site arguing with you, and the invite notice will come back on its own
 * once the tournament is over.
 */
export default async function SiteNotices({ userId }: { userId?: string | null }) {
  // Signed-out visitors have no bracket to have holes in. This also keeps the
  // per-request queries off every marketing page view.
  const prompt = userId ? await getPickGapPrompt(userId) : null
  if (prompt) return <PickGapNotice prompt={prompt} />

  return <FeaturedSlamNotice />
}
