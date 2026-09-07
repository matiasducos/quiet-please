import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import Nav from '@/components/Nav'
import { isUuid } from '@/lib/tournaments/slug'
import { getSeriesHub, isSeriesIndexable, resolveLegacyTournamentId, resolveRenamedSeriesSlug } from '@/lib/tournaments/series'
import type { EditionSummary, SeriesHub } from '@/lib/tournaments/series'
import { buildHubMetadata, buildHubJsonLd, seriesVenue, categoryLabel } from '@/lib/tournaments/seo'
import { STATUS_STYLES, formatDateRange } from './tournament-ui'

/**
 * The evergreen series hub — /tournaments/wimbledon.
 *
 * This URL is never deleted and never redirected. It is the one that
 * accumulates backlinks and authority across seasons, which is why the slug
 * lives on the series rather than being derived from a tournament name that
 * changes with its title sponsor.
 *
 * It also absorbs the legacy /tournaments/<uuid> links: a UUID-shaped param is
 * a tournament id and gets a permanent redirect to that edition's canonical URL.
 *
 * ── This page owns the series' HISTORY intent ───────────────────────────────
 * Three URLs could answer "who won Wimbledon in 2023": this hub, the edition
 * page, and — for the four majors — the slam landing at /wimbledon-bracket-
 * challenge. Google only ranks one of them and files the rest away, so the
 * split is deliberate:
 *
 *   /wimbledon-bracket-challenge  → "play a bracket" (transactional; the route
 *                                   was chosen for search volume)
 *   /tournaments/wimbledon        → "who has won it" (this page)
 *   /tournaments/wimbledon/2026   → one edition's draw and results
 *
 * On 2026-09-07 this page had ZERO vocabulary of its own against the edition
 * page — 119 shared tokens, 0 unique — which is why it sat under "Crawled –
 * currently not indexed". Anything added here must be something neither of the
 * other two says. The champion record below is the first of those: it is a
 * fact about the series across time, which a single edition cannot express.
 */

export const revalidate = 300
export const dynamicParams = true

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('tournament_series').select('slug').limit(2000)

  if (error) {
    console.error('[hub] generateStaticParams failed:', error.message)
    return []
  }
  return ((data ?? []) as { slug: string }[]).map(s => ({ slug: s.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  // A UUID param only ever redirects; the target carries the real metadata.
  if (isUuid(slug)) return { robots: { index: false, follow: true } }

  const hub = await getSeriesHub(slug)
  if (!hub) return {}
  return buildHubMetadata(hub)
}

export default async function SeriesHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // Legacy /tournaments/<uuid> → /tournaments/<slug>/<year>.
  //
  // Redirects to the EDITION, not to this hub: the old URL addressed one
  // specific tournament, and sending it to the series instead would be a
  // redirect to a page that does not answer the original request — which
  // search engines treat as a soft 404, dropping the link equity entirely.
  if (isUuid(slug)) {
    const legacy = await resolveLegacyTournamentId(slug)
    if (!legacy) notFound()
    permanentRedirect(`/tournaments/${legacy.slug}/${legacy.year}`)
  }

  const [{ user, profile }, hub] = await Promise.all([getNavProfile(), getSeriesHub(slug)])

  // A retired slug redirects rather than 404s — this is the URL that
  // accumulates backlinks across seasons, so losing it to a rename is the most
  // expensive 404 the site can serve. See resolveRenamedSeriesSlug.
  if (!hub) {
    const renamedTo = await resolveRenamedSeriesSlug(slug)
    if (renamedTo) permanentRedirect(`/tournaments/${renamedTo}`)
    notFound()
  }

  const featured = hub.editions.find(e => e.year === hub.featuredYear) ?? null
  const past = hub.editions.filter(e => e.year !== hub.featuredYear)
  const venue = seriesVenue(hub.series)
  const titleHolders = countTitles(hub.editions)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav
        deletionRequestedAt={profile?.deletion_requested_at}
        username={profile?.username}
        points={profile?.ranking_points ?? 0}
        activePage="tournaments"
        userId={user?.id}
      />

      {isSeriesIndexable(hub) && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildHubJsonLd(hub)) }}
        />
      )}

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <nav
          className="flex items-center gap-2 mb-8"
          style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
        >
          <Link href="/tournaments" style={{ color: 'var(--muted)' }}>Tournaments</Link>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>{hub.series.name}</span>
        </nav>

        <header className="mb-10">
          <h1
            className="text-3xl md:text-4xl"
            style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '8px' }}
          >
            {hub.series.flag_emoji && <span style={{ marginRight: '8px' }}>{hub.series.flag_emoji}</span>}
            {hub.series.name}
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)', letterSpacing: '0.03em' }}>
            {[venue, hub.series.surface ? `${hub.series.surface} court` : null].filter(Boolean).join(' · ')}
          </p>
          <SeriesIntro hub={hub} />
        </header>

        {featured && <FeaturedEdition hub={hub} edition={featured} />}
        {titleHolders.length > 0 && <TitleRecord hub={hub} holders={titleHolders} />}
        {past.length > 0 && <PastEditions hub={hub} editions={past} />}

        {hub.editions.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No editions of this tournament have been added yet.</p>
        )}
      </div>
    </main>
  )
}

function FeaturedEdition({ hub, edition }: { hub: SeriesHub; edition: EditionSummary }) {
  const status = STATUS_STYLES[edition.status]
  const isDone = edition.status === 'completed'

  return (
    <section className="rounded-sm border bg-white p-5 md:p-6 mb-10" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', letterSpacing: '-0.01em' }}>
          {hub.series.name} {edition.year}
        </h2>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', background: status.bg, color: status.text, padding: '3px 9px', borderRadius: '2px' }}>
          {status.label}
        </span>
      </div>

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '14px' }}>
        {formatDateRange(edition.startsAt, edition.endsAt)}
        {edition.location ? ` · ${edition.location}` : ''}
      </p>

      {isDone && edition.champion?.name && (
        <p style={{ marginBottom: '14px' }}>
          Champion: <strong>{edition.champion.name}</strong>
          {edition.champion.country ? (
            <span style={{ color: 'var(--muted)' }}> ({edition.champion.country})</span>
          ) : null}
        </p>
      )}

      <Link
        href={`/tournaments/${hub.series.slug}/${edition.year}`}
        className="inline-block px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-80"
        style={{ background: 'var(--court)', color: 'white', textDecoration: 'none' }}
      >
        {isDone ? `See the ${edition.year} draw and results` : `${hub.series.name} ${edition.year} draw & results`}
      </Link>
    </section>
  )
}

/**
 * One line of coverage facts under the h1.
 *
 * Deliberately does NOT restate the venue or surface — the mono line directly
 * above already carries those, and this page's whole problem was saying things
 * that are said better somewhere else. What is new here is the span: how many
 * editions this URL actually accounts for, which is the one question a history
 * page should answer before anything else.
 */
function SeriesIntro({ hub }: { hub: SeriesHub }) {
  const years = [...new Set(hub.editions.map(e => e.year))]
  if (years.length === 0) return null

  const category = categoryLabel(hub.series.category)
  const from = Math.min(...years)
  const to = Math.max(...years)
  const span = from === to ? `${from}` : `${from}–${to}`
  const count = years.length

  return (
    <p style={{ color: 'var(--muted)', fontSize: '0.92rem', lineHeight: 1.7, marginTop: '12px', maxWidth: '55ch' }}>
      {category ? `${category}. ` : ''}
      {count === 1 ? 'One edition' : `${count} editions`} on record, {span}, with the champion of each.
    </p>
  )
}

type TitleHolder = {
  externalId: string
  name: string
  country: string | null
  titles: number
  /** Winning years, newest first. */
  years: number[]
}

/**
 * Multiple-time champions, most titles first.
 *
 * This is the one thing on the hub that neither the edition pages nor the slam
 * landing can say: it is a fact about the series ACROSS time, and it only
 * exists once you hold several editions. That makes it the right anchor for
 * the "who has won the most French Opens" family of queries.
 *
 * Returns empty when nobody has won twice — the list would then be the
 * champions table below re-sorted, which is the duplication this page is
 * supposed to be getting out of.
 *
 * Keyed on the feed's player id rather than the display name: `resolveMissing-
 * Players` can name the same person "C. Alcaraz" in one row and leave another
 * unresolved, and grouping on the rendered string would split their count.
 * ATP and WTA champions are ranked together, matching the editions table —
 * a player only ever appears on one tour, so no count is ever merged across.
 */
function countTitles(editions: EditionSummary[]): TitleHolder[] {
  const byPlayer = new Map<string, TitleHolder>()

  for (const edition of editions) {
    // An unfinished edition has no F-round result and so no champion yet.
    if (edition.status !== 'completed') continue
    const champion = edition.champion
    if (!champion?.name) continue

    const existing = byPlayer.get(champion.externalId)
    if (existing) {
      existing.titles += 1
      existing.years.push(edition.year)
    } else {
      byPlayer.set(champion.externalId, {
        externalId: champion.externalId,
        name: champion.name,
        country: champion.country,
        titles: 1,
        years: [edition.year],
      })
    }
  }

  return [...byPlayer.values()]
    .filter(holder => holder.titles > 1)
    .map(holder => ({ ...holder, years: [...holder.years].sort((a, b) => b - a) }))
    .sort((a, b) => b.titles - a.titles || b.years[0] - a.years[0])
}

function TitleRecord({ hub, holders }: { hub: SeriesHub; holders: TitleHolder[] }) {
  return (
    <section className="mb-10">
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', marginBottom: '0.75rem' }}>
        Most {hub.series.name} titles
      </h2>

      <ul
        className="rounded-sm border bg-white"
        style={{ borderColor: 'var(--chalk-dim)', listStyle: 'none', padding: 0, margin: 0 }}
      >
        {holders.map(holder => (
          <li
            key={holder.externalId}
            className="flex items-baseline gap-3 px-4 py-3 border-b last:border-0 flex-wrap"
            style={{ borderColor: 'var(--chalk-dim)', fontSize: '0.9rem' }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--court)', minWidth: '3.5rem' }}>
              {holder.titles} {holder.titles === 1 ? 'title' : 'titles'}
            </span>
            <span>
              {holder.name}
              {holder.country ? <span style={{ color: 'var(--muted)' }}> ({holder.country})</span> : null}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
              {holder.years.join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Past editions with winners.
 *
 * The grid is wrapped in overflow-x-auto with a min-width inner block, so on a
 * narrow screen the table scrolls inside its own container instead of pushing
 * the page body sideways.
 */
function PastEditions({ hub, editions }: { hub: SeriesHub; editions: EditionSummary[] }) {
  return (
    <section>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', marginBottom: '0.75rem' }}>
        Every {hub.series.name} champion
      </h2>

      <div className="overflow-x-auto rounded-sm border bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="min-w-[520px]">
          <div
            className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b"
            style={{ borderColor: 'var(--chalk-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}
          >
            <span className="col-span-2">Year</span>
            <span className="col-span-4">Champion</span>
            <span className="col-span-4">Dates</span>
            <span className="col-span-2">Tour</span>
          </div>

          {editions.map(edition => (
            <Link
              key={`${edition.year}-${edition.tour}`}
              href={`/tournaments/${hub.series.slug}/${edition.year}`}
              className="grid grid-cols-12 gap-2 px-4 py-3 border-b last:border-0 hover:bg-[#fafaf8]"
              style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none', color: 'var(--ink)', fontSize: '0.85rem' }}
            >
              <span className="col-span-2" style={{ fontFamily: 'var(--font-mono)' }}>{edition.year}</span>
              <span className="col-span-4">
                {edition.champion?.name ?? <span style={{ color: 'var(--muted)' }}>—</span>}
              </span>
              <span className="col-span-4" style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                {formatDateRange(edition.startsAt, edition.endsAt)}
              </span>
              <span className="col-span-2" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                {edition.tour}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
