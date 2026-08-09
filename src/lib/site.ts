/**
 * Canonical public origin, used for metadataBase, canonical URLs, the sitemap
 * and robots.txt.
 *
 * Deliberately NOT derived from VERCEL_URL, unlike `getBaseUrl()` in
 * src/app/admin/actions.ts. That helper wants "whatever host is serving this
 * request" so links in emails work from preview deploys. Canonical tags want
 * the opposite: every deploy must point at the one real domain. Building these
 * from VERCEL_URL would make each preview deployment self-canonicalise to its
 * own throwaway hostname, which is how preview URLs end up indexed and
 * competing with production for the same terms.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://quietplease.app'

/**
 * True only on the production deployment. Preview and development builds serve
 * a `Disallow: /` robots.txt so unfinished copy never gets crawled.
 */
export const IS_PRODUCTION_DEPLOY = process.env.VERCEL_ENV === 'production'

export const SITE_NAME = 'Quiet Please'

/**
 * Site-default Open Graph copy.
 *
 * Lives here rather than inline in the root layout because two places need the
 * exact same strings: the layout, which supplies them as the fallback card for
 * pages that define no openGraph of their own, and the homepage, which has to
 * restate the whole block just to add `url`. Next shallow-merges metadata — a
 * page that sets `openGraph` replaces the parent's object outright instead of
 * merging field by field — so the homepage cannot simply add `url` on top.
 *
 * Deliberately carries no `url`: as a cascading default it would be wrong on
 * every page but the homepage. See the note in src/app/layout.tsx.
 */
export const DEFAULT_OG = {
  type: 'website',
  siteName: SITE_NAME,
  title: 'Free Tennis Bracket Challenge — ATP & WTA',
  description:
    'Fill out the bracket for any ATP or WTA tournament, earn points for every correct pick, and compete with friends across the full season.',
} as const
