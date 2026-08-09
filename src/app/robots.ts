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
          // Profiles 307 to /login for signed-out visitors, and Googlebot is
          // always signed out. They are linked from the public leaderboard and
          // the public results tables, so every one Google discovered was
          // crawled, redirected, and filed under "Page with redirect". If
          // profiles are ever made publicly viewable, drop this line — a page
          // per active user is the best long-tail inventory the app has.
          '/profile',
          '/activity',
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
