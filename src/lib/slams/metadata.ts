import type { Metadata } from 'next'
import type { SlamConfig } from './config'

/**
 * Metadata for a slam landing page.
 *
 * Sets `alternates.canonical` and per-page `openGraph`/`twitter`, which none of
 * the existing dynamic pages do — without a canonical these would be the only
 * indexable pages on the site relying on Google to guess the preferred URL.
 *
 * `title` is given as `absolute` so the root layout's "%s | Quiet Please"
 * template doesn't append a second brand suffix; each slam title is already
 * tuned to length.
 */
export function buildSlamMetadata(config: SlamConfig): Metadata {
  return {
    title: { absolute: `${config.title} | Quiet Please` },
    description: config.description,
    keywords: config.keywords,
    alternates: { canonical: config.route },
    openGraph: {
      type: 'website',
      url: config.route,
      title: config.title,
      description: config.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: config.title,
      description: config.description,
    },
  }
}
