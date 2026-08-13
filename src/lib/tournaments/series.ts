import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuid as isUuidParam } from './slug'

/**
 * Data layer for the public, indexable tournament pages.
 *
 * Rows are typed by hand here rather than inferred. `src/types/database.ts` is
 * a `Record<string, any>` placeholder (the project is not linked locally, so
 * `supabase gen types` can't run), which means every Supabase call in the repo
 * returns `any`. Declaring the shapes at this boundary is what keeps the pages
 * themselves free of `any` — the same approach `src/lib/slams/data.ts` takes.
 */

export type Tour = 'ATP' | 'WTA'
export type Surface = 'hard' | 'clay' | 'grass'
export type Category = 'grand_slam' | 'masters_1000' | '500' | '250'
export type TournamentStatus =
  | 'upcoming'
  | 'draw_published'
  | 'accepting_predictions'
  | 'in_progress'
  | 'completed'

export type SeriesRow = {
  id: string
  slug: string
  name: string
  short_name: string | null
  city: string | null
  country: string | null
  flag_emoji: string | null
  surface: Surface | null
  category: Category | null
  slug_reviewed: boolean
  updated_at: string
}

export type EditionRow = {
  id: string
  series_id: string | null
  name: string
  tour: Tour
  category: Category
  surface: Surface | null
  status: TournamentStatus
  starts_at: string | null
  ends_at: string | null
  draw_close_at: string | null
  location: string | null
  flag_emoji: string | null
  starts_year: number | null
  draw_size: number | null
  updated_at: string
}

const SERIES_FIELDS =
  'id, slug, name, short_name, city, country, flag_emoji, surface, category, slug_reviewed, updated_at'

// Deliberately one unbroken literal: the Supabase client parses the select
// string at the type level, and a `+` concatenation widens it to `string`,
// which collapses the result type to GenericStringError[].
const EDITION_FIELDS =
  'id, series_id, name, tour, category, surface, status, starts_at, ends_at, draw_close_at, location, flag_emoji, starts_year, draw_size, updated_at'

/** A player as it appears inside `draws.bracket_data`. */
export type DrawPlayer = {
  name: string | null
  country: string | null
  externalId: string
}

export type DrawMatchNode = {
  round: string
  matchId: string
  player1: DrawPlayer | null
  player2: DrawPlayer | null
}

export type BracketData = {
  rounds?: string[]
  matches?: DrawMatchNode[]
  tournamentExternalId?: string
}

export type MatchResultRow = {
  external_match_id: string
  round: string
  winner_external_id: string
  loser_external_id: string
  score: string | null
  played_at: string | null
}

/** One tour's worth of an edition: the tournament row plus everything on it. */
export type EditionDetail = {
  tournament: EditionRow
  bracket: BracketData | null
  drawSyncedAt: string | null
  results: MatchResultRow[]
  /** Distinct named players in the draw, deduplicated and alphabetised. */
  participants: DrawPlayer[]
  champion: DrawPlayer | null
  runnerUp: DrawPlayer | null
}

export type EditionPage = {
  series: SeriesRow
  year: number
  /** One entry per tour that has a row for this series+year. Usually one. */
  tours: EditionDetail[]
}

export type EditionSummary = {
  year: number
  tour: Tour
  tournamentId: string
  status: TournamentStatus
  startsAt: string | null
  endsAt: string | null
  location: string | null
  champion: DrawPlayer | null
}

export type SeriesHub = {
  series: SeriesRow
  /** Every edition, newest year first. */
  editions: EditionSummary[]
  /** The edition to feature: the live/upcoming one, else the most recent. */
  featuredYear: number | null
}

/**
 * `status` values where the event has not finished. Kept as a set rather than
 * `!== 'completed'` so a future status is a compile-time decision rather than
 * silently landing in one bucket.
 */
const UNFINISHED: ReadonlySet<TournamentStatus> = new Set<TournamentStatus>([
  'upcoming',
  'draw_published',
  'accepting_predictions',
  'in_progress',
])

// ── Player name resolution ───────────────────────────────────────────────────
//
// match_results stores only external ids, and there is no foreign key to
// players — the link is an application-level join on a text column. The draw
// snapshot carries names inline, so it is the cheaper source; the players
// registry is the fallback for ids the snapshot never named (qualifiers were
// placeholders when the bracket was built).

function indexDrawPlayers(bracket: BracketData | null): Map<string, DrawPlayer> {
  const byId = new Map<string, DrawPlayer>()
  for (const match of bracket?.matches ?? []) {
    for (const player of [match?.player1, match?.player2]) {
      if (!player?.externalId) continue
      const existing = byId.get(player.externalId)
      byId.set(player.externalId, {
        externalId: player.externalId,
        name: existing?.name ?? player.name ?? null,
        country: existing?.country ?? player.country ?? null,
      })
    }
  }
  return byId
}

async function resolveMissingPlayers(
  ids: string[],
): Promise<Map<string, DrawPlayer>> {
  const out = new Map<string, DrawPlayer>()
  if (ids.length === 0) return out

  const supabase = createAdminClient()
  // Chunked because a long `.in()` list overflows the request URL and fails as
  // a query error rather than returning partial data.
  const CHUNK = 100
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('players')
      .select('external_id, name, country')
      .in('external_id', ids.slice(i, i + CHUNK))
    if (error) {
      console.error('[series] player lookup failed:', error.message)
      continue
    }
    for (const row of (data ?? []) as { external_id: string; name: string; country: string }[]) {
      out.set(row.external_id, {
        externalId: row.external_id,
        name: row.name,
        country: row.country || null,
      })
    }
  }
  return out
}

// ── Queries ──────────────────────────────────────────────────────────────────
//
// Tagged `tournament-detail` / `tournament-list`, the tags the admin actions
// already bust, so publishing a draw or changing a status refreshes these
// pages immediately instead of waiting out the revalidate window.

/** Series by slug, with every edition and each edition's champion. */
export const getSeriesHub = (slug: string): Promise<SeriesHub | null> =>
  unstable_cache(
    async (): Promise<SeriesHub | null> => {
      const supabase = createAdminClient()

      const { data: seriesData, error: seriesError } = await supabase
        .from('tournament_series')
        .select(SERIES_FIELDS)
        .eq('slug', slug)
        .maybeSingle()

      // Throw rather than return null on a query ERROR.
      //
      // Returning null here would be indistinguishable from "this series does
      // not exist", and unstable_cache would store that for the full revalidate
      // window — so one transient Supabase failure 404s a live page for five
      // minutes, and the same failure during a build bakes a 404 into a static
      // page. Throwing leaves the cache empty and surfaces the error boundary.
      if (seriesError) throw new Error(`[series] hub lookup failed: ${seriesError.message}`)
      if (!seriesData) return null
      const series = seriesData as SeriesRow

      const { data: editionData, error: editionError } = await supabase
        .from('tournaments')
        .select(EDITION_FIELDS)
        .eq('series_id', series.id)
        .order('starts_year', { ascending: false })
      if (editionError) throw new Error(`[series] editions lookup failed: ${editionError.message}`)
      const editions = (editionData ?? []) as EditionRow[]
      if (editions.length === 0) {
        return { series, editions: [], featuredYear: null }
      }

      // Champions come from the F-round result, not from any "winner" column —
      // there isn't one. One query covers every edition of the series.
      const { data: finalsData, error: finalsError } = await supabase
        .from('match_results')
        .select('tournament_id, winner_external_id')
        .in('tournament_id', editions.map(e => e.id))
        .eq('round', 'F')
      if (finalsError) {
        console.error('[series] finals lookup failed:', finalsError.message)
      }
      const finals = (finalsData ?? []) as { tournament_id: string; winner_external_id: string }[]
      const championIdByTournament = new Map(finals.map(f => [f.tournament_id, f.winner_external_id]))

      const names = await resolveMissingPlayers([...new Set(championIdByTournament.values())])

      const summaries: EditionSummary[] = editions
        .map(edition => ({
          year: edition.starts_year ?? new Date(edition.starts_at ?? 0).getUTCFullYear(),
          tour: edition.tour,
          tournamentId: edition.id,
          status: edition.status,
          startsAt: edition.starts_at,
          endsAt: edition.ends_at,
          location: edition.location,
          champion: (() => {
            const id = championIdByTournament.get(edition.id)
            return id ? names.get(id) ?? { externalId: id, name: null, country: null } : null
          })(),
        }))
        .sort((a, b) => b.year - a.year)

      // Feature the edition someone searching today actually wants: the one in
      // progress or next up, falling back to the most recent completed year.
      const unfinished = summaries.filter(s => UNFINISHED.has(s.status))
      const featuredYear = unfinished.length > 0
        ? Math.min(...unfinished.map(s => s.year))
        : summaries[0]?.year ?? null

      return { series, editions: summaries, featuredYear }
    },
    ['tournament-series-hub', slug],
    { revalidate: 300, tags: ['tournament-detail', 'tournament-list'] },
  )()

/** One edition: the series, plus full detail for each tour that has a row. */
export const getEdition = (slug: string, year: number): Promise<EditionPage | null> =>
  unstable_cache(
    async (): Promise<EditionPage | null> => {
      const supabase = createAdminClient()

      const { data: seriesData, error: seriesError } = await supabase
        .from('tournament_series')
        .select(SERIES_FIELDS)
        .eq('slug', slug)
        .maybeSingle()
      // Same reasoning as getSeriesHub: an error must not be cached as absence.
      if (seriesError) throw new Error(`[series] edition series lookup failed: ${seriesError.message}`)
      if (!seriesData) return null
      const series = seriesData as SeriesRow

      const { data: editionData, error: editionError } = await supabase
        .from('tournaments')
        .select(EDITION_FIELDS)
        .eq('series_id', series.id)
        .eq('starts_year', year)
        .order('tour', { ascending: true })
      if (editionError) throw new Error(`[series] edition lookup failed: ${editionError.message}`)
      const editions = (editionData ?? []) as EditionRow[]
      if (editions.length === 0) return null

      const ids = editions.map(e => e.id)

      const [drawsResult, resultsResult] = await Promise.all([
        supabase.from('draws').select('tournament_id, bracket_data, synced_at').in('tournament_id', ids),
        supabase
          .from('match_results')
          .select('tournament_id, external_match_id, round, winner_external_id, loser_external_id, score, played_at')
          .in('tournament_id', ids),
      ])

      if (drawsResult.error) console.error('[series] draws lookup failed:', drawsResult.error.message)
      if (resultsResult.error) console.error('[series] results lookup failed:', resultsResult.error.message)

      const draws = (drawsResult.data ?? []) as {
        tournament_id: string
        bracket_data: BracketData | null
        synced_at: string | null
      }[]
      const results = (resultsResult.data ?? []) as (MatchResultRow & { tournament_id: string })[]

      // Collect every id the draw snapshot could not name, across all tours, so
      // the registry fallback is one round trip rather than one per tour.
      const unnamed = new Set<string>()
      const perTour = editions.map(tournament => {
        const draw = draws.find(d => d.tournament_id === tournament.id)
        const bracket = draw?.bracket_data ?? null
        const byId = indexDrawPlayers(bracket)
        const own = results.filter(r => r.tournament_id === tournament.id)

        for (const [id, player] of byId) if (!player.name) unnamed.add(id)
        const final = own.find(r => r.round === 'F')
        for (const id of [final?.winner_external_id, final?.loser_external_id]) {
          if (id && !byId.get(id)?.name) unnamed.add(id)
        }
        return { tournament, bracket, drawSyncedAt: draw?.synced_at ?? null, byId, results: own, final }
      })

      const fallback = await resolveMissingPlayers([...unnamed])
      const resolve = (byId: Map<string, DrawPlayer>, id: string | undefined): DrawPlayer | null => {
        if (!id) return null
        const fromDraw = byId.get(id)
        if (fromDraw?.name) return fromDraw
        return fallback.get(id) ?? fromDraw ?? null
      }

      const tours: EditionDetail[] = perTour.map(entry => ({
        tournament: entry.tournament,
        bracket: entry.bracket,
        drawSyncedAt: entry.drawSyncedAt,
        results: entry.results.map(r => ({
          external_match_id: r.external_match_id,
          round: r.round,
          winner_external_id: r.winner_external_id,
          loser_external_id: r.loser_external_id,
          score: r.score,
          played_at: r.played_at,
        })),
        participants: [...entry.byId.values()]
          .map(p => (p.name ? p : fallback.get(p.externalId) ?? p))
          .filter(p => Boolean(p.name))
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
        champion: resolve(entry.byId, entry.final?.winner_external_id),
        runnerUp: resolve(entry.byId, entry.final?.loser_external_id),
      }))

      return { series, year, tours }
    },
    ['tournament-edition', slug, String(year)],
    { revalidate: 300, tags: ['tournament-detail', 'tournament-list'] },
  )()

/**
 * Maps a legacy /tournaments/<uuid> link to its canonical slug URL.
 *
 * Returns null when the tournament has no series yet (sync-created rows await
 * an admin assigning one), which the route turns into a 404 rather than a
 * redirect to nowhere.
 */
export const resolveLegacyTournamentId = (
  id: string,
): Promise<{ slug: string; year: number } | null> =>
  unstable_cache(
    async () => {
      const supabase = createAdminClient()
      const { data, error } = await supabase
        .from('tournaments')
        .select('starts_year, tournament_series(slug)')
        .eq('id', id)
        .maybeSingle()

      // An error here would cache as "no such tournament" and turn a working
      // legacy link into a permanent-looking 404.
      if (error) throw new Error(`[series] legacy id lookup failed: ${error.message}`)
      if (!data) return null

      // PostgREST returns the embedded parent as an object for a many-to-one,
      // but the untyped client widens it to a possible array. Accept both.
      const row = data as { starts_year: number | null; tournament_series?: { slug: string } | { slug: string }[] | null }
      const embedded = row.tournament_series
      const slug = Array.isArray(embedded) ? embedded[0]?.slug : embedded?.slug
      if (!slug || row.starts_year == null) return null
      return { slug, year: row.starts_year }
    },
    ['tournament-legacy-id', id],
    { revalidate: 3600, tags: ['tournament-detail', 'tournament-list'] },
  )()

/**
 * Resolves the `[slug]` route param for the app surfaces that still address a
 * single tournament — /predict and /picks.
 *
 * Accepts both forms on purpose. A UUID resolves straight through, so every
 * existing internal link (`/tournaments/${t.id}/predict`, of which there are
 * dozens across the dashboard, leagues and challenges) keeps working untouched
 * rather than needing a coordinated rewrite. A slug resolves to the series'
 * featured edition — the live or next one — which is what someone typing
 * /tournaments/wimbledon/predict means.
 */
export async function resolveTournamentParam(
  routeParam: string,
): Promise<{ tournamentId: string; slug: string | null; year: number | null } | null> {
  if (isUuidParam(routeParam)) {
    const legacy = await resolveLegacyTournamentId(routeParam)
    return { tournamentId: routeParam, slug: legacy?.slug ?? null, year: legacy?.year ?? null }
  }

  const hub = await getSeriesHub(routeParam)
  if (!hub || hub.featuredYear == null) return null
  const featured = hub.editions.find(e => e.year === hub.featuredYear)
  if (!featured) return null
  return { tournamentId: featured.tournamentId, slug: hub.series.slug, year: featured.year }
}

/**
 * Indexability gate.
 *
 * An unreviewed slug means the series was auto-created by the sync cron and
 * nobody has confirmed its URL. Publishing that would mint a permanent URL
 * from a machine guess — so it stays noindex and out of the sitemap until an
 * admin signs it off.
 *
 * A missing start date is the other floor: with no date there is no event, no
 * JSON-LD and nothing that answers a dated query. Draw-less upcoming editions
 * ARE indexed on purpose — a dated future event is exactly what Google's event
 * results want, and they carry the previous edition's champion as real content.
 */
export function isEditionIndexable(page: EditionPage): boolean {
  if (!page.series.slug_reviewed) return false
  return page.tours.some(t => Boolean(t.tournament.starts_at))
}

export function isSeriesIndexable(hub: SeriesHub): boolean {
  return hub.series.slug_reviewed && hub.editions.length > 0
}

// ── Directory ────────────────────────────────────────────────────────────────

export type SeriesDirectoryEntry = {
  slug: string
  name: string
  city: string | null
  country: string | null
  flag_emoji: string | null
  surface: Surface | null
  category: Category | null
  /** Every edition year, newest first. */
  years: number[]
}

/**
 * Row cap, matching sitemap.ts for the same reason: PostgREST silently
 * truncates at 1000 rows rather than erroring, and a directory that quietly
 * drops half the tour is worse than one that fails loudly.
 */
const MAX_DIRECTORY_ROWS = 900

/**
 * Every indexable series, A–Z, with its edition years.
 *
 * Deliberately the SAME shape and filter as sitemap.ts — one query over
 * tournaments with an inner join to reviewed series, grouped by slug. That is
 * the point: the sitemap lists 70 URLs, and this is what links them. Building
 * the directory from a different source is how the two drift into a sitemap
 * advertising pages the site itself never links.
 *
 * Cost is one indexed query for the whole tour calendar, cached for an hour and
 * shared by every visitor, so it does not scale with users.
 */
export const getSeriesDirectory = (): Promise<SeriesDirectoryEntry[]> =>
  unstable_cache(
    async (): Promise<SeriesDirectoryEntry[]> => {
      const supabase = createAdminClient()

      const { data, error } = await supabase
        .from('tournaments')
        .select(
          'starts_year, tournament_series!inner(slug, name, city, country, flag_emoji, surface, category, slug_reviewed)',
        )
        .not('series_id', 'is', null)
        .order('starts_year', { ascending: false })
        .limit(MAX_DIRECTORY_ROWS)

      if (error) {
        // The directory is an enhancement to a page that already works. A failed
        // query drops the section rather than taking /tournaments down with it.
        console.error('[series] directory lookup failed:', error.message)
        return []
      }

      type Row = {
        starts_year: number | null
        tournament_series: {
          slug: string
          name: string
          city: string | null
          country: string | null
          flag_emoji: string | null
          surface: Surface | null
          category: Category | null
          slug_reviewed: boolean
        } | null
      }

      const bySlug = new Map<string, SeriesDirectoryEntry>()

      for (const row of (data ?? []) as unknown as Row[]) {
        const series = row.tournament_series
        // Unreviewed slugs are auto-created by the sync cron and render noindex
        // until an admin confirms the URL — the same guard sitemap.ts applies.
        // Linking one would push crawl budget at a page asking not to be indexed.
        if (!series?.slug_reviewed || row.starts_year == null) continue

        const existing = bySlug.get(series.slug)
        if (existing) {
          // The two tours of one edition share a year and a URL.
          if (!existing.years.includes(row.starts_year)) existing.years.push(row.starts_year)
          continue
        }
        bySlug.set(series.slug, {
          slug: series.slug,
          name: series.name,
          city: series.city,
          country: series.country,
          flag_emoji: series.flag_emoji,
          surface: series.surface,
          category: series.category,
          years: [row.starts_year],
        })
      }

      const entries = [...bySlug.values()]
      for (const entry of entries) entry.years.sort((a, b) => b - a)
      // A–Z, so the order is stable between renders and predictable to a reader
      // scanning for one tournament.
      return entries.sort((a, b) => a.name.localeCompare(b.name))
    },
    ['tournament-series-directory'],
    { revalidate: 3600, tags: ['tournament-list'] },
  )()
