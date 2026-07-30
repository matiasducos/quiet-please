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
