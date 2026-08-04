/**
 * Carrying a visitor's intent through the auth round trip.
 *
 * Every gate in the app used to be a bare `redirect('/login')`, so someone who
 * clicked "Predict" on a specific tournament signed in and landed on the
 * dashboard — the thing they actually asked for was discarded at the door.
 * That is a poor experience for a returning user and an outright leak for a
 * new one, who has just been asked to create an account and then denied the
 * page that motivated it.
 *
 * The target rides as a `?next=` query param the whole way: gate → /login or
 * /signup → OAuth or the email confirmation link → /auth/callback →
 * /setup-username for brand-new accounts → finally the page they wanted.
 */

/** Where people go when there is no pending intent. */
export const DEFAULT_LANDING = '/dashboard'

export const NEXT_PARAM = 'next'

/**
 * Validate a redirect target.
 *
 * Anything that isn't a plain same-site path falls back to the dashboard.
 * This is an open-redirect guard: `next` arrives from the query string, so
 * without it a crafted link could bounce someone from our sign-in page to an
 * attacker's, which is the classic phishing setup — the victim genuinely did
 * start at the real site.
 */
export function getSafeRedirectPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_LANDING
  // Must start with exactly one slash. `//evil.com` is protocol-relative and
  // browsers treat it as an absolute URL.
  if (!next.startsWith('/') || next.startsWith('//')) return DEFAULT_LANDING
  // `/\evil.com` is normalised to a protocol-relative URL by some browsers,
  // and `javascript:` / `data:` must never survive.
  if (/^\/\\/.test(next) || /^[a-z]+:/i.test(next)) return DEFAULT_LANDING
  return next
}

/** True when `next` points somewhere worth returning to. */
function isMeaningfulTarget(next: string | null | undefined): next is string {
  return Boolean(next) && getSafeRedirectPath(next) !== DEFAULT_LANDING
}

/**
 * Build a link to an auth page that remembers where the visitor was heading.
 *
 * Omits the param when the target is just the dashboard, so the common case
 * stays a clean `/login` rather than `/login?next=%2Fdashboard`.
 */
export function authUrl(page: '/login' | '/signup', next?: string | null): string {
  if (!isMeaningfulTarget(next)) return page
  return `${page}?${NEXT_PARAM}=${encodeURIComponent(next)}`
}

/**
 * Where an unauthenticated visitor should be sent from a gated page.
 *
 * Content surfaces send people to /signup, app surfaces to /login. Someone
 * who navigated from a public tournament page to its bracket is far more
 * likely to be new than someone who typed /dashboard, and showing a stranger
 * a "Welcome back" form is the wrong ask at the wrong moment. Both pages link
 * to each other, carrying `next` with them, so neither guess traps anyone.
 */
export function gateRedirect(
  target: string,
  audience: 'new' | 'returning' = 'returning',
): string {
  return authUrl(audience === 'new' ? '/signup' : '/login', target)
}

/**
 * Append `next` to a URL that already has a query string — the OAuth
 * `redirectTo` and the email `emailRedirectTo`, both of which already carry
 * `consent`.
 */
export function withNext(url: string, next?: string | null): string {
  if (!isMeaningfulTarget(next)) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${NEXT_PARAM}=${encodeURIComponent(next)}`
}
