import type { MetadataRoute } from 'next'
import { SITE_URL, IS_PRODUCTION_DEPLOY } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  // Preview and local builds must never be crawled — otherwise a preview
  // deployment competes with production for the same terms.
  if (!IS_PRODUCTION_DEPLOY) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Signed-in surfaces carry no value for search and often hold personal
        // data. /api and /ingest (the PostHog proxy) are machine endpoints.
        disallow: [
          '/api/',
          '/ingest/',
          '/admin',
          '/dashboard',
          '/notifications',
          '/messages',
          '/friends',
          '/setup-username',
          '/onboarding',
          '/welcome',
          '/check-email',
          '/unsubscribed',
          '/auth/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
