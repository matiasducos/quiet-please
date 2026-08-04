import { SITE_URL, SITE_NAME } from '@/lib/site'
import type { SlamConfig } from './config'
import type { SlamEditions } from './data'

/**
 * Structured data for a slam landing page.
 *
 * FAQPage is the workhorse: it targets the questions people actually type
 * ("is the wimbledon bracket free", "when does the draw open") and is how a
 * small site earns SERP real estate against larger domains. SportsEvent is
 * added only when a real edition with a start date exists — emitting an event
 * with invented dates would be worse than emitting none.
 */
export function buildSlamJsonLd(
  config: SlamConfig,
  editions: SlamEditions,
  performers: string[] = [],
) {
  const pageUrl = `${SITE_URL}${config.route}`
  // Next serves the route's `opengraph-image` file convention at this path; the
  // `?<hash>` it appends in the meta tag is a cache-buster, not part of the URL.
  const image = `${pageUrl}/opengraph-image`

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'WebPage',
      '@id': `${pageUrl}#page`,
      url: pageUrl,
      name: config.title,
      description: config.description,
      image,
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
    },
    {
      '@type': 'FAQPage',
      '@id': `${pageUrl}#faq`,
      mainEntity: config.faq.map(item => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  ]

  const edition = editions.atp ?? editions.wta
  if (edition?.starts_at) {
    const people = performers.map(name => ({ '@type': 'Person', name }))
    graph.push({
      '@type': 'SportsEvent',
      '@id': `${pageUrl}#event`,
      name: `${config.name}${editions.year ? ` ${editions.year}` : ''}`,
      url: pageUrl,
      description: config.description,
      image: [image],
      startDate: edition.starts_at,
      ...(edition.ends_at ? { endDate: edition.ends_at } : {}),
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      sport: 'Tennis',
      location: {
        '@type': 'Place',
        name: `${config.city}, ${config.country}`,
        address: { '@type': 'PostalAddress', addressLocality: config.city, addressCountry: config.country },
      },
      // Same set under both names: `competitor` is the precise SportsEvent
      // property, `performer` is the one Google's Event parser reads. Empty
      // before the draw is published, and the properties are then omitted
      // rather than filled with guesses at who will enter.
      ...(people.length > 0 ? { competitor: people, performer: people } : {}),
      organizer: { '@type': 'Organization', ...config.organizer },
    })
  }

  return { '@context': 'https://schema.org', '@graph': graph }
}
