import Link from 'next/link'
import { getSeriesDirectory } from '@/lib/tournaments/series'
import { editionHref, hubHref } from '@/lib/tournaments/slug'

/**
 * The A–Z index of every tournament series.
 *
 * This exists for crawlers as much as for readers. The cards above it are
 * filtered by tour and status, which are query params — so before this section
 * existed, 66 of the 70 URLs in sitemap.xml had no inbound link anywhere on the
 * site, and Google filed all of them under "Discovered - currently not
 * indexed": queued from the sitemap, never crawled, because nothing on the site
 * suggested they mattered.
 *
 * Two rules keep it working:
 *
 *  1. No filter, no pagination, no client state. Every series is in the initial
 *     HTML of /tournaments. A link behind a "load more" button is not a link.
 *  2. Hub AND years. The hub pages already link their own editions, so linking
 *     hubs alone would be enough to reach everything in two hops — but the
 *     years cost one anchor each and put the edition pages one hop from a page
 *     Google already indexes.
 *
 * Rendered as a plain list rather than TournamentCard: those carry live status
 * and engagement counts, which is a per-tournament query this section
 * deliberately does not make.
 */
export default async function SeriesDirectory() {
  const series = await getSeriesDirectory()
  if (series.length === 0) return null

  return (
    <section className="mt-14">
      <h2
        style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', marginBottom: '0.35rem' }}
      >
        All tournaments A–Z
      </h2>
      <p className="mb-5" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
        Every event we cover, with results and past champions for each year.
      </p>

      {/* One column on a phone — these rows hold a name plus a row of year
          links, and two columns at 375px puts both on top of each other. */}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0 list-none p-0 m-0">
        {series.map(entry => (
          <li
            key={entry.slug}
            className="py-3 border-b"
            style={{ borderColor: 'var(--chalk-dim)' }}
          >
            <Link
              href={hubHref(entry.slug)!}
              className="font-medium hover:underline"
              style={{ color: 'var(--ink)', textDecoration: 'none', fontSize: '0.95rem' }}
            >
              {entry.flag_emoji ? `${entry.flag_emoji} ` : ''}
              {entry.name}
            </Link>

            {entry.city && (
              <span className="ml-2" style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                {entry.city}
              </span>
            )}

            {/* Year chips rather than bare text links: at 0.75rem the text
                alone is well under a thumb, so each one carries its own 32px
                hit area. */}
            <span className="flex flex-wrap gap-1.5 mt-2">
              {entry.years.map(year => {
                const href = editionHref(entry.slug, year)
                // Cannot be null here — the directory only holds entries whose
                // years came off real editions — but the helper is the single
                // place that owns the URL shape, so it stays the source.
                return href ? (
                  <Link
                    key={year}
                    href={href}
                    className="inline-flex items-center min-h-[32px] px-2.5 rounded-sm border hover:opacity-80"
                    style={{
                      borderColor: 'var(--chalk-dim)',
                      background: 'white',
                      color: 'var(--court)',
                      textDecoration: 'none',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                    }}
                  >
                    {year}
                  </Link>
                ) : null
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
