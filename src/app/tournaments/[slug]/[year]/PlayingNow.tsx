import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import TournamentCard from '@/components/TournamentCard'
import { getLiveTournaments, getUpcomingTournaments } from '@/lib/tournaments/cached'
import { getTournamentEngagement } from '@/lib/tournaments/engagement'
import { getPredictableStatuses } from '@/lib/app-settings'

/**
 * Somewhere to go when this page has nothing to give.
 *
 * An upcoming edition with no draw is a dead end: the visitor searched for a
 * tournament, found the right page, and every route onward from it is closed
 * until a bracket exists. The reminder box above captures the intent for
 * later; this captures it NOW, by pointing at the tournaments where a bracket
 * can be filled in today.
 *
 * The heading is derived rather than fixed, and that is load-bearing. "Playing
 * right now" over a tournament that starts on Monday is a plain falsehood, so
 * the two sets are never mixed: live events if there are any, otherwise the
 * ones whose draws are open, otherwise nothing at all. An empty section under
 * a confident heading is worse than no section.
 */

/** Two, because the grid is two-up on desktop and one-up at 375px. */
const SHOWN = 2

/**
 * Prediction counts for the shown cards, cached across pages.
 *
 * The wrapper is the point. Everything else this component reads is already
 * shared — the live list is global — so the two cards are IDENTICAL on every
 * undrawn edition page, and there are enough of those that an uncached pair of
 * RPCs per page would run the same two queries a hundred times over during a
 * build, and again on every revalidation.
 *
 * Keyed on the ids so a change in which tournaments are live is a different
 * cache entry rather than a stale count on the wrong card, and tagged with the
 * rest of the tournament data so an admin edit clears it.
 */
const getCachedEngagement = unstable_cache(
  async (ids: string[]) => getTournamentEngagement(ids),
  ['playing-now-engagement'],
  { revalidate: 60, tags: ['tournament-list'] },
)

export default async function PlayingNow({
  excludeTournamentIds,
}: {
  /** The edition being viewed — both tours of it — so it can't advertise itself. */
  excludeTournamentIds: string[]
}) {
  const exclude = new Set(excludeTournamentIds)

  // Both are `unstable_cache`d and shared across every visitor and every one of
  // the ~2,400 edition pages, so this costs no per-page query. Over-fetched by
  // a couple so the exclusion below can't empty the list.
  const [live, predictableStatuses] = await Promise.all([
    getLiveTournaments(SHOWN + 2),
    getPredictableStatuses(),
  ])

  let shown = live.filter(t => !exclude.has(t.id)).slice(0, SHOWN)
  let mode: 'live' | 'open' = 'live'

  if (shown.length === 0) {
    const upcoming = await getUpcomingTournaments(SHOWN + 4)
    shown = upcoming
      .filter(t => t.status === 'accepting_predictions' && !exclude.has(t.id))
      .slice(0, SHOWN)
    mode = 'open'
  }

  if (shown.length === 0) return null

  // Social proof. Sorted so two pages that show the same pair in a different
  // order still hit one cache entry rather than two.
  const engagement = await getCachedEngagement(shown.map(t => t.id).sort())

  // Whether a live tournament can still be predicted depends on the global
  // prediction mode — under `pre_tournament` it cannot, and promising picks on
  // one would send people to a closed door.
  const livePredictable = predictableStatuses.includes('in_progress')

  const heading = mode === 'live' ? 'Playing right now' : 'Open right now'
  const blurb =
    mode === 'live'
      ? livePredictable
        ? 'This draw isn’t out yet — but these are underway, and you can still pick the rounds to come.'
        : 'This draw isn’t out yet. Here’s what’s being played while you wait.'
      : 'These draws are published and taking predictions today.'

  return (
    <div className="mb-8">
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.25rem' }}>
        {heading}
      </h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '0.9rem' }}>
        {blurb}
      </p>

      <div className={`grid gap-3 ${shown.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        {shown.map(t => (
          <TournamentCard
            key={t.id}
            t={{
              ...t,
              prediction_count: engagement[t.id]?.predictions ?? 0,
              challenge_count: engagement[t.id]?.challenges ?? 0,
            }}
            predictableStatuses={predictableStatuses}
          />
        ))}
      </div>

      {/* The cards land on each tournament's own edition page, which is where
          the signed-out "Fill in this bracket — free" CTA already lives and
          already knows that tournament's status. Duplicating that decision
          here is how the two would drift apart. */}
      <Link
        href="/tournaments"
        className="inline-flex items-center min-h-[44px] mt-2"
        style={{ color: 'var(--court)', fontSize: '0.85rem' }}
      >
        Every tournament this season →
      </Link>
    </div>
  )
}
