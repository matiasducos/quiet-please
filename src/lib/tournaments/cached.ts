import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

// `starts_year` and the series slug ride along so cards can link to the
// canonical /tournaments/<slug>/<year> instead of the /tournaments/<uuid>
// redirect. Not an inner join: a tournament with no series still belongs on the
// homepage, it just falls back to the UUID link.
// `external_id` and `is_manual` ride along so callers can apply the same two
// exemptions the predict page does: the sandbox tournament, and hand-entered
// tournaments, which are not subject to the weekly slot limit.
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
 * Revalidates every 60s or when tournament-list tag is busted.
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
  { revalidate: 60, tags: ['tournament-list'] },
)

/**
 * Cached query for live (in_progress) tournaments (shared across all users).
 * Revalidates every 60s or when tournament-list tag is busted.
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
  { revalidate: 60, tags: ['tournament-list'] },
)
