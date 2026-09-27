import { createAdminClient } from '@/lib/supabase/admin'
import { getOnNowTournaments } from '@/lib/tournaments/cached'
import { isUuid } from '@/lib/tournaments/slug'

/**
 * The lists behind `TournamentSwitcher` — the ‹ Hangzhou › control that moves
 * between tournaments without going back to a list page.
 *
 * Every item carries its own `href`, decided here on the server. "Same view"
 * means something different on each surface — the predict page falls back to
 * the edition page for a draw that is not taking picks, the results page falls
 * back to the draw builder for a tournament with no draw — and the client
 * component should not need to know any of that.
 */
export type SwitcherItem = {
  href: string
  /** Short and scannable: the city, as the ATP app does. */
  title: string
  /** The full tournament name, for the open list and the tooltip. */
  subtitle: string
  flag: string | null
  status: string
}

type Row = {
  id: string
  name: string
  tour: string | null
  status: string
  location: string | null
  flag_emoji: string | null
}

/** "Hangzhou, China" → "Hangzhou". Falls back to the name when there is no location. */
function cityOf(row: Row): string {
  const city = row.location?.split(',')[0]?.trim()
  return city || row.name
}

/**
 * Build items: one per distinct URL, with a title two of them can tell apart.
 *
 * Deduplicated by href because the public routes address a SERIES, not a
 * tournament row — a Grand Slam's ATP and WTA rows share one edition page and
 * one /predict slug, and stepping onto the same page twice would read as a
 * broken arrow. Whatever still shares a city after that gets its tour appended.
 */
function toItems<R extends Row>(rows: R[], hrefFor: (row: R) => string): SwitcherItem[] {
  const seen = new Set<string>()
  const unique: Array<{ row: R; href: string }> = []
  for (const row of rows) {
    const href = hrefFor(row)
    if (seen.has(href)) continue
    seen.add(href)
    unique.push({ row, href })
  }

  const titleCount = new Map<string, number>()
  for (const { row } of unique) titleCount.set(cityOf(row), (titleCount.get(cityOf(row)) ?? 0) + 1)

  return unique.map(({ row, href }) => {
    const city = cityOf(row)
    return {
      href,
      title: (titleCount.get(city) ?? 0) > 1 && row.tour ? `${city} · ${row.tour}` : city,
      subtitle: row.name,
      flag: row.flag_emoji,
      status: row.status,
    }
  })
}

/**
 * The public list: exactly what the "Live right now" strip shows — on court,
 * then open draws — so the switcher and the strip can never disagree.
 *
 * Costs no per-request query: `getOnNowTournaments` is cached globally and
 * cleared by the same `tournament-list` tag an admin status change fires.
 * Twelve is far above a real week's six or eight concurrent events.
 */
export async function getPublicSwitcherRows() {
  return getOnNowTournaments(12)
}

type OnNowRow = Awaited<ReturnType<typeof getPublicSwitcherRows>>[number]

/** The edition URL, or the legacy id URL (which redirects to it) when the series is unknown. */
export function editionHref(row: { id: string; slug: string | null; year: number | null }): string {
  return row.slug && row.year ? `/tournaments/${row.slug}/${row.year}` : `/tournaments/${row.id}`
}

/**
 * The predict URL, by slug when there is one.
 *
 * The id form works too, but middleware answers it with a 308 to exactly this
 * URL after a lookup of its own (`legacy-redirect.ts`) — a query and a round
 * trip on every arrow press and every prefetch, for the same page.
 */
export function predictHref(row: { id: string; slug: string | null }): string {
  return `/tournaments/${row.slug ?? row.id}/predict`
}

/** Items for the edition page. The page is per-edition, not per-tour, so no tour suffix. */
export function editionSwitcherItems(rows: OnNowRow[]): SwitcherItem[] {
  return toItems(rows.map(r => ({ ...r, tour: null })), editionHref)
}

/**
 * Items for the predict page. A tournament whose status cannot take picks
 * right now — a live one under `pre_tournament`, or a `draw_published` shell —
 * links to its edition page rather than to a predict URL that would bounce.
 */
export function predictSwitcherItems(rows: OnNowRow[], predictableStatuses: string[]): SwitcherItem[] {
  return toItems(rows, r => (predictableStatuses.includes(r.status) ? predictHref(r) : editionHref(r)))
}

/** Hard ceiling. A normal week is two to eight non-completed rows; this is a backstop, not a page size. */
const ADMIN_LIMIT = 40

/**
 * The admin list: every tournament not yet completed, by start date — so the
 * arrows reach a draw you are about to enter, not only the live ones.
 *
 * Always includes `currentId`. Marking the final completes the tournament, and
 * a switcher that vanished at the exact moment you finished one would strand
 * you on it.
 *
 * Not cached: admin-only, a single small query, and it must reflect a status
 * change made a second ago on the page it renders on.
 */
export async function getAdminSwitcherItems(
  currentId: string,
  view: 'results' | 'draw',
): Promise<SwitcherItem[]> {
  const admin = createAdminClient()

  // The id is interpolated into a PostgREST `or` filter, so it must be a real
  // UUID — a stray comma or paren would change the filter's meaning.
  const filter = isUuid(currentId) ? `status.neq.completed,id.eq.${currentId}` : 'status.neq.completed'

  const { data, error } = await admin
    .from('tournaments')
    .select('id, name, tour, status, location, flag_emoji, starts_at')
    .or(filter)
    .order('starts_at', { ascending: true })
    .order('name', { ascending: true })
    .limit(ADMIN_LIMIT)

  if (error) {
    console.error('[switcher] admin tournament list failed:', error.message)
    return []
  }

  return toItems(data ?? [], r => `/admin/tournaments/${r.id}/${view}`)
}
