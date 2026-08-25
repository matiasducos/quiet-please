import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

// `starts_year` and the series slug ride along so cards can link to the
// canonical /tournaments/<slug>/<year> instead of the /tournaments/<uuid>
// redirect. Not an inner join: a tournament with no series still belongs on the
// homepage, it just falls back to the UUID link.
// `external_id` and `is_manual` ride along so callers can apply the same two
// exemptions the predict page does: the sandbox tournament, and hand-entered
// tournaments, which are not subject to the weekly slot limit.
/**
 * Backstop window for the shared tournament lists.
 *
 * These three caches are invalidated by tag, not by clock: every writer that
 * can change a tournament's status (admin actions, award-points, sync-draws,
 * sync-results) fires revalidateTag('tournament-list'). The hour here is a
 * safety net for a writer nobody has written yet, not the freshness mechanism.
 *
 * It was 60 seconds, and that was expensive in a way that is easy to miss.
 * Next reduces a route's revalidate to the SHORTEST window of any cache entry
 * the render touched, so this value silently became the revalidate for every
 * page that reads these lists — including the four slam landing pages, which
 * declare `revalidate = 300` and were regenerating every 60s because
 * SlamLanding calls getOnNowTournaments() directly. Those pages are prerendered
 * marketing surfaces; regenerating them on a one-minute clock cost a full
 * server render per minute per page for content that only changes when an
 * admin publishes a draw.
 */
const LIST_BACKSTOP = 3600

const TOURNAMENT_FIELDS =
  'id, name, tour, surface, category, starts_at, ends_at, status, location, flag_emoji, external_id, is_manual, starts_year, tournament_series(slug)'

type SeriesEmbed = { slug: string } | { slug: string }[] | null | undefined

/**
 * Flatten the embedded series to the `slug` / `year` a TournamentCard expects.
 *
 * PostgREST types a to-one embed as either an object or an array depending on
 * how it infers the relationship, so both shapes have to be handled — the same
 * unwrap `getRecentCompleted()` does.
 */
function withEditionRef<T extends { starts_year?: number | null; tournament_series?: SeriesEmbed }>(
  rows: T[],
): Array<T & { slug: string | null; year: number | null }> {
  return rows.map(row => {
    const embedded = row.tournament_series
    return {
      ...row,
      slug: (Array.isArray(embedded) ? embedded[0]?.slug : embedded?.slug) ?? null,
      year: row.starts_year ?? null,
    }
  })
}

/**
 * Cached query for upcoming tournaments (shared across all users).
 * Invalidated by the tournament-list tag; see LIST_BACKSTOP for the window.
 *
 * No caller since PlayingNow merged its two lists into `getOnNowTournaments` —
 * kept because "what is coming up" is a different question from "what can I act
 * on now", and this is the only helper that answers it.
 */
export const getUpcomingTournaments = unstable_cache(
  async (limit: number = 3) => {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tournaments')
      .select(TOURNAMENT_FIELDS)
      .in('status', ['accepting_predictions', 'upcoming'])
      .order('starts_at', { ascending: true })
      .limit(limit)
    if (error) console.error('cached upcoming tournaments error:', error.message)
    return withEditionRef(data ?? [])
  },
  ['upcoming-tournaments'],
  { revalidate: LIST_BACKSTOP, tags: ['tournament-list'] },
)

/**
 * Cached query for live (in_progress) tournaments (shared across all users).
 * Invalidated by the tournament-list tag; see LIST_BACKSTOP for the window.
 */
export const getLiveTournaments = unstable_cache(
  async (limit: number = 4) => {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tournaments')
      .select(TOURNAMENT_FIELDS)
      .eq('status', 'in_progress')
      .order('starts_at', { ascending: true })
      .limit(limit)
    if (error) console.error('cached live tournaments error:', error.message)
    return withEditionRef(data ?? [])
  },
  ['live-tournaments'],
  { revalidate: LIST_BACKSTOP, tags: ['tournament-list'] },
)

/**
 * The statuses the "Live right now" strips show.
 *
 * Wider than `in_progress` on purpose: a published draw taking predictions is
 * the most actionable thing on the site — you can still enter it clean — and it
 * was invisible on every one of these surfaces while the strip meant "on court".
 *
 * `draw_published` is in the list but is not predictable: `sync-draws` sets it
 * for a qualifying or shell bracket with no players in it yet, and
 * `getPredictableStatuses()` excludes it. TournamentCard reads the status
 * itself, so such a card renders a "Draw published" badge and no predict CTA
 * rather than a link to a closed door.
 */
export const ON_NOW_STATUSES = ['in_progress', 'accepting_predictions', 'draw_published'] as const

/** In progress first, then draws that are open, then the rest. */
const ON_NOW_RANK: Record<string, number> = { in_progress: 0, accepting_predictions: 1, draw_published: 2 }

/**
 * Order the strip: what is being played leads, then earliest start.
 *
 * Sorted here rather than in the query because PostgREST cannot order by a
 * custom status precedence, and ordering by `starts_at` alone would put a
 * tournament that opens tomorrow above one that is on court today.
 */
export function compareOnNow<T extends { status: string; starts_at: string | null }>(a: T, b: T): number {
  const rank = (ON_NOW_RANK[a.status] ?? 9) - (ON_NOW_RANK[b.status] ?? 9)
  if (rank !== 0) return rank
  return (a.starts_at ?? '').localeCompare(b.starts_at ?? '')
}

/**
 * Cached "on now" list — in progress, plus draws that are open (shared).
 *
 * Kept separate from `getLiveTournaments` rather than replacing it. Two callers
 * genuinely mean "on court": `getPickGapPrompt`, whose whole premise is a
 * tournament already under way, and `getLiveStatuses`, which reports a standing
 * that does not exist before the first result. Widening the shared helper would
 * have changed both silently.
 *
 * The row cap is applied after sorting, so a tournament on court is never
 * pushed out of the strip by an earlier-starting one that has not begun. The
 * fetch is bounded at 20 because a busy week is six or eight concurrent events,
 * not hundreds.
 */
export const getOnNowTournaments = unstable_cache(
  async (limit: number = 4) => {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tournaments')
      .select(TOURNAMENT_FIELDS)
      .in('status', ON_NOW_STATUSES)
      .order('starts_at', { ascending: true })
      .limit(20)
    if (error) console.error('cached on-now tournaments error:', error.message)
    return withEditionRef((data ?? []).sort(compareOnNow).slice(0, limit))
  },
  ['on-now-tournaments'],
  { revalidate: LIST_BACKSTOP, tags: ['tournament-list'] },
)
