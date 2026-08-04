/**
 * First-touch acquisition attribution.
 *
 * Why this is server-side rather than left to PostHog: the browser client runs
 * with `persistence: 'memory'` (cookieless, so no consent banner), which means
 * the anonymous distinct_id lives in a JS variable and is reminted on every
 * full page load. The signup path is full of them — the OAuth round trip
 * through /auth/callback, the email confirmation link, the middleware
 * redirect to /setup-username. The visitor PostHog saw arrive from a campaign
 * and the user who eventually fires `signup_completed` are therefore two
 * unrelated person records, with no client-side join that can recover the
 * link. Measured on real data: `/` showed 21 persons across 21 sessions.
 *
 * So the landing request stamps a first-touch cookie in middleware, and
 * setUsername() — the one screen every account passes through exactly once —
 * reads it onto the user row and onto the signup_completed event. That
 * survives every redirect in between because it never leaves the server.
 *
 * First-touch, not last: the cookie is only written when absent, so the
 * campaign that earned the visit keeps the credit even if the visitor wanders
 * off and returns directly a week later.
 */

export const ATTRIBUTION_COOKIE_NAME = 'qp_attr'
export const ATTRIBUTION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

/** Per-field cap. Keeps a crafted URL from bloating every subsequent request header. */
const MAX_FIELD_LENGTH = 100

export type Attribution = {
  source: string
  medium: string
  campaign: string | null
  referrer: string | null
  landingPath: string
}

/**
 * Paid-click identifiers, in precedence order. A visitor arriving on an ad
 * often has the click id but no utm_source (autotagging), and reading that as
 * "direct" would quietly credit paid traffic to nothing.
 */
const CLICK_IDS: Array<{ param: string; source: string; medium: string }> = [
  { param: 'gclid', source: 'google', medium: 'cpc' },
  { param: 'gbraid', source: 'google', medium: 'cpc' },
  { param: 'wbraid', source: 'google', medium: 'cpc' },
  { param: 'fbclid', source: 'facebook', medium: 'paid' },
  { param: 'ttclid', source: 'tiktok', medium: 'paid' },
  { param: 'msclkid', source: 'bing', medium: 'cpc' },
  { param: 'twclid', source: 'twitter', medium: 'paid' },
]

/** Trim, collapse whitespace, lowercase and cap. Attribution values are dimensions to group by, so normalising here keeps `Google` and `google` from splitting a campaign in two. */
function clean(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, MAX_FIELD_LENGTH)
  return trimmed ? trimmed.toLowerCase() : null
}

/**
 * Work out where this visit came from.
 *
 * Precedence: explicit utm_source, then a paid click id, then the referring
 * domain, then direct. Returns null only for internal referrers with no
 * campaign params — those are same-site navigation, not a new visit, and
 * recording them would overwrite nothing (the cookie is first-touch) but
 * would waste a Set-Cookie on every page.
 */
export function deriveAttribution(url: URL, referrer: string | null): Attribution | null {
  const params = url.searchParams
  const landingPath = url.pathname.slice(0, MAX_FIELD_LENGTH)

  let referrerHost: string | null = null
  if (referrer) {
    try {
      referrerHost = new URL(referrer).hostname.replace(/^www\./, '')
    } catch {
      // A malformed Referer header is not worth failing a page request over.
    }
  }

  const isInternalReferrer = referrerHost !== null && referrerHost === url.hostname.replace(/^www\./, '')

  const utmSource = clean(params.get('utm_source'))
  if (utmSource) {
    return {
      source: utmSource,
      medium: clean(params.get('utm_medium')) ?? 'unknown',
      campaign: clean(params.get('utm_campaign')),
      referrer: referrerHost,
      landingPath,
    }
  }

  for (const { param, source, medium } of CLICK_IDS) {
    if (params.has(param)) {
      return {
        source,
        medium,
        campaign: clean(params.get('utm_campaign')),
        referrer: referrerHost,
        landingPath,
      }
    }
  }

  if (referrerHost && !isInternalReferrer) {
    return { source: referrerHost, medium: 'referral', campaign: null, referrer: referrerHost, landingPath }
  }

  // Same-site navigation carries no acquisition information.
  if (isInternalReferrer) return null

  return { source: 'direct', medium: 'none', campaign: null, referrer: null, landingPath }
}

/**
 * Cookie payload. JSON rather than a delimiter so a value containing the
 * delimiter can't shift the fields. Short keys because this rides on every
 * request for 30 days.
 *
 * Deliberately not percent-encoded here — Next's cookie API encodes on write
 * and decodes on read, so doing it again just doubled the wire size.
 */
export function serializeAttribution(a: Attribution): string {
  return JSON.stringify({ s: a.source, m: a.medium, c: a.campaign, r: a.referrer, p: a.landingPath })
}

/** Parse a cookie written by serializeAttribution. Returns null on anything unexpected — a corrupt cookie must never break signup. */
export function parseAttribution(cookieValue: string | undefined): Attribution | null {
  if (!cookieValue) return null
  try {
    // Tolerates a still-encoded value. Whether the cookie arrives decoded
    // depends on which Next API read it, and attribution silently vanishing
    // because of that is precisely the failure this module exists to prevent.
    const decoded = cookieValue.startsWith('{') ? cookieValue : decodeURIComponent(cookieValue)
    const raw = JSON.parse(decoded)
    if (!raw || typeof raw !== 'object' || typeof raw.s !== 'string') return null
    return {
      source: raw.s,
      medium: typeof raw.m === 'string' ? raw.m : 'unknown',
      campaign: typeof raw.c === 'string' ? raw.c : null,
      referrer: typeof raw.r === 'string' ? raw.r : null,
      landingPath: typeof raw.p === 'string' ? raw.p : '/',
    }
  } catch {
    return null
  }
}

/**
 * Paths that never represent a landing. Machine endpoints and the auth round
 * trip in particular: /auth/callback carries Google as its referrer, so
 * stamping it would credit every OAuth signup to accounts.google.com.
 */
const NON_LANDING_PREFIXES = ['/api/', '/ingest/', '/auth/', '/_next/', '/monitoring']

export function isLandingCandidate(pathname: string): boolean {
  return !NON_LANDING_PREFIXES.some(prefix => pathname.startsWith(prefix))
}
