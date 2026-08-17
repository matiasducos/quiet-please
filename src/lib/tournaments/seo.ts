import type { Metadata } from 'next'
import { SITE_URL, SITE_NAME } from '@/lib/site'
import type {
  EditionDetail,
  EditionPage,
  SeriesHub,
  SeriesRow,
  Tour,
  TournamentStatus,
} from './series'
import { isEditionIndexable, isSeriesIndexable } from './series'
// Pure title formatting lives in a leaf module so the admin naming editor — a
// client component — can preview the exact strings this file ships.
import { editionTitle, hubTitle } from './titles'

/**
 * Metadata and structured data for the public tournament pages.
 *
 * Kept separate from the route files so the title/description/JSON-LD for a
 * page is built from the same resolved data the page renders — a title that
 * says "Results" for an event with no results is the fastest way to look
 * auto-generated, which is what the thin-content filters are looking for.
 */

const CATEGORY_LABEL: Record<string, string> = {
  grand_slam: 'Grand Slam',
  masters_1000: 'Masters 1000',
  '500': 'ATP 500',
  '250': 'ATP 250',
}

const SURFACE_LABEL: Record<string, string> = {
  hard: 'hard court',
  clay: 'clay',
  grass: 'grass',
}

export function seriesVenue(series: SeriesRow, edition?: EditionDetail): string | null {
  // The edition's own location wins: the Canadian Open alternates Montreal and
  // Toronto, so the series-level city is wrong for half the editions.
  if (edition?.tournament.location) return edition.tournament.location
  if (series.city && series.country) return `${series.city}, ${series.country}`
  return series.city ?? series.country ?? null
}

// UTC throughout: tournament dates are stored as dates, not moments, so
// rendering them in the server's local zone can shift an event a day either way.
const DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}

function formatRange(startsAt: string | null, endsAt: string | null): string | null {
  if (!startsAt) return null
  const start = new Date(startsAt)
  if (!endsAt) return start.toLocaleDateString('en-GB', DATE_OPTS)
  const end = new Date(endsAt)
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`
  }
  // Both sides use the same month format — mixing 'short' and 'long' produced
  // "29 Jun – 13 July 2026".
  return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })} – ${end.toLocaleDateString('en-GB', DATE_OPTS)}`
}

// ── Titles & descriptions ────────────────────────────────────────────────────

/**
 * Prose summary of an edition, shared by the meta description and the
 * SportsEvent `description`.
 *
 * One function rather than two so the two can't drift: Google compares the
 * structured data against what the page actually says, and a description that
 * contradicts the meta tag is worse than none at all.
 */
export function editionDescription(page: EditionPage): string {
  const { series, year } = page
  const detail = page.tours[0]

  const isDone = page.tours.every(t => t.tournament.status === 'completed')
  const champion = page.tours.find(t => t.champion?.name)?.champion?.name ?? null

  const venue = seriesVenue(series, detail)
  const dates = formatRange(detail?.tournament.starts_at ?? null, detail?.tournament.ends_at ?? null)
  const surface = detail?.tournament.surface ? SURFACE_LABEL[detail.tournament.surface] : null
  const players = page.tours.reduce((n, t) => n + t.participants.length, 0)

  const sentences: string[] = []
  sentences.push(
    [
      `${series.name} ${year}`,
      venue ? `in ${venue}` : null,
      dates ? `· ${dates}` : null,
    ].filter(Boolean).join(' ') + '.',
  )
  if (isDone && champion) {
    sentences.push(`${champion} took the title.`)
  }
  if (players > 0) {
    sentences.push(
      `Full ${surface ? `${surface} ` : ''}draw with all ${players} players, round-by-round results and the complete bracket.`,
    )
  } else if (dates) {
    sentences.push('Draw, schedule and results as they happen, plus a free bracket you can fill in.')
  }

  return sentences.join(' ')
}

export function buildEditionMetadata(page: EditionPage): Metadata {
  const { series, year } = page
  const path = `/tournaments/${series.slug}/${year}`
  const url = `${SITE_URL}${path}`

  const isDone = page.tours.every(t => t.tournament.status === 'completed')
  const hasDraw = page.tours.some(t => (t.bracket?.matches?.length ?? 0) > 0)

  const title = editionTitle(series, year, isDone, hasDraw)

  const description = editionDescription(page)
  const indexable = isEditionIndexable(page)

  // Pointed at explicitly because the `opengraph-image` file convention does
  // not cascade: it applies to the segment it sits in and not to that segment's
  // children, unlike a layout. The file is on [slug], so without this the year
  // pages — the ones actually built to be indexed and shared — ship no card at
  // all, and the SportsEvent `image` below would contradict the page's tags.
  const image = seriesImage(series)

  return {
    title: { absolute: `${title} | ${SITE_NAME}` },
    description: description.slice(0, 300),
    alternates: { canonical: path },
    // Unreviewed slugs are auto-created by the sync cron; publishing one would
    // mint a permanent URL from a machine guess.
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title,
      description: description.slice(0, 200),
      images: [{ url: image, width: 1200, height: 630, type: 'image/png' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: description.slice(0, 200),
      images: [image],
    },
  }
}

export function buildHubMetadata(hub: SeriesHub): Metadata {
  const { series } = hub
  const path = `/tournaments/${series.slug}`
  const name = series.name

  const years = hub.editions.map(e => e.year)
  const span = years.length > 1 ? `${Math.min(...years)}–${Math.max(...years)}` : years[0]
  const venue = seriesVenue(series)
  const category = series.category ? CATEGORY_LABEL[series.category] : null

  const title = hubTitle(series)

  const description = [
    [name, category ? `is an ${category} event` : null, venue ? `in ${venue}` : null]
      .filter(Boolean).join(' ') + '.',
    hub.featuredYear ? `Follow the ${hub.featuredYear} draw and results` : null,
    years.length > 0 ? `browse every edition${span ? ` (${span})` : ''} with past champions` : null,
  ].filter(Boolean).join(', ').replace(/,([^,]*)$/, ' and$1') + '.'

  return {
    title: { absolute: `${title} | ${SITE_NAME}` },
    description: description.slice(0, 300),
    alternates: { canonical: path },
    robots: isSeriesIndexable(hub) ? undefined : { index: false, follow: true },
    openGraph: {
      type: 'website',
      url: `${SITE_URL}${path}`,
      siteName: SITE_NAME,
      title,
      description: description.slice(0, 200),
    },
    twitter: { card: 'summary_large_image', title, description: description.slice(0, 200) },
  }
}

// ── JSON-LD ──────────────────────────────────────────────────────────────────

/**
 * schema.org eventStatus.
 *
 * Every one of the five `tournaments.status` values maps here. EventPostponed
 * and EventCancelled are deliberately never emitted: the schema has no
 * cancellation or postponement concept, so choosing either would mean
 * asserting a state the data cannot express. A finished event also stays
 * EventScheduled — schema.org has no "completed" member, and the end date is
 * what tells consumers it is over.
 *
 * If a `cancelled` status is ever added to the tournaments table, this constant
 * becomes a lookup and the compiler will point at the call sites.
 */
const EVENT_STATUS: Record<TournamentStatus, string> = {
  upcoming: 'https://schema.org/EventScheduled',
  draw_published: 'https://schema.org/EventScheduled',
  accepting_predictions: 'https://schema.org/EventScheduled',
  in_progress: 'https://schema.org/EventScheduled',
  completed: 'https://schema.org/EventScheduled',
}

/**
 * Sanctioning body per tour, with the website URL Google's Event parser wants
 * on `organizer`.
 *
 * The tour, not the local organising committee: the committee differs per event
 * and we don't store it, whereas the tour that sanctions the draw is exactly
 * what `tournaments.tour` records.
 */
const TOUR_ORGANIZER: Record<Tour, { name: string; url: string }> = {
  ATP: { name: 'ATP Tour', url: 'https://www.atptour.com' },
  WTA: { name: 'WTA', url: 'https://www.wtatennis.com' },
}

/**
 * The page's own social card, reused as the Event `image`.
 *
 * Next serves the `opengraph-image` file convention at this path — the `?<hash>`
 * it appends in the meta tag is a cache-buster, not part of the route. The file
 * lives on the [slug] segment, so every edition under a series shares this URL.
 */
function seriesImage(series: SeriesRow): string {
  return `${SITE_URL}/tournaments/${series.slug}/opengraph-image`
}

function placeNode(location: string | null, series: SeriesRow) {
  const label = location ?? seriesVenue(series)
  if (!label) return undefined
  const [city, country] = label.split(', ')
  return {
    '@type': 'Place',
    name: label,
    address: {
      '@type': 'PostalAddress',
      ...(city ? { addressLocality: city } : {}),
      ...(country ? { addressCountry: country } : {}),
    },
  }
}

/**
 * SportsEvent for one edition, plus breadcrumbs.
 *
 * The player list is capped: a 128-draw would otherwise add ~128 nodes of JSON
 * to every page's HTML for no additional rich-result eligibility — and it is
 * emitted twice, so the cap counts double.
 */
const MAX_COMPETITORS = 30

export function buildEditionJsonLd(page: EditionPage): Record<string, unknown> {
  const { series, year } = page
  const pageUrl = `${SITE_URL}/tournaments/${series.slug}/${year}`
  // Same image the page advertises as its own social card, so the structured
  // data and the meta tags agree.
  const description = editionDescription(page)
  const image = seriesImage(series)
  const graph: Record<string, unknown>[] = []

  for (const detail of page.tours) {
    const t = detail.tournament
    // No start date means no event worth describing — omitting the node is
    // better than emitting one with an invented date.
    if (!t.starts_at) continue

    const players = detail.participants
      .slice(0, MAX_COMPETITORS)
      .map(p => ({
        '@type': 'Person',
        name: p.name,
        ...(p.country ? { nationality: p.country } : {}),
      }))

    graph.push({
      '@type': 'SportsEvent',
      '@id': `${pageUrl}#event-${t.tour.toLowerCase()}`,
      name: `${series.name} ${year}${page.tours.length > 1 ? ` — ${t.tour}` : ''}`,
      url: pageUrl,
      description,
      image: [image],
      startDate: t.starts_at,
      ...(t.ends_at ? { endDate: t.ends_at } : {}),
      eventStatus: EVENT_STATUS[t.status],
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      sport: 'Tennis',
      ...(placeNode(t.location, series) ? { location: placeNode(t.location, series) } : {}),
      // The same people under both names on purpose. `competitor` is the
      // precise SportsEvent property; `performer` is the one Google's Event
      // parser reads, and it reports a missing field when only the former is
      // present. For a tennis draw the two are the same set.
      ...(players.length > 0 ? { competitor: players, performer: players } : {}),
      organizer: { '@type': 'Organization', ...TOUR_ORGANIZER[t.tour] },
    })
  }

  graph.push({
    '@type': 'BreadcrumbList',
    '@id': `${pageUrl}#breadcrumbs`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Tournaments', item: `${SITE_URL}/tournaments` },
      { '@type': 'ListItem', position: 2, name: series.name, item: `${SITE_URL}/tournaments/${series.slug}` },
      { '@type': 'ListItem', position: 3, name: String(year), item: pageUrl },
    ],
  })

  return { '@context': 'https://schema.org', '@graph': graph }
}

export function buildHubJsonLd(hub: SeriesHub): Record<string, unknown> {
  const { series } = hub
  const pageUrl = `${SITE_URL}/tournaments/${series.slug}`

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SportsOrganization',
        '@id': `${pageUrl}#series`,
        name: series.name,
        url: pageUrl,
        sport: 'Tennis',
        ...(placeNode(null, series) ? { location: placeNode(null, series) } : {}),
      },
      {
        '@type': 'ItemList',
        '@id': `${pageUrl}#editions`,
        name: `${series.name} editions`,
        itemListElement: hub.editions.map((edition, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${series.name} ${edition.year}`,
          url: `${pageUrl}/${edition.year}`,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${pageUrl}#breadcrumbs`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Tournaments', item: `${SITE_URL}/tournaments` },
          { '@type': 'ListItem', position: 2, name: series.name, item: pageUrl },
        ],
      },
    ],
  }
}
