/**
 * Cookie consent.
 *
 * Scope of the problem: ePrivacy requires consent before *storing or reading*
 * anything on a device, with an exemption only for what is strictly necessary
 * to deliver the service the visitor asked for. That covers the Supabase auth
 * cookies and `username_is_set` (routing after signup). It does not cover
 * `qp_attr` or `qp_ref`, which exist to measure acquisition.
 *
 * Recording the decision itself is strictly necessary — otherwise we would
 * have to ask on every page — so `qp_consent` needs no consent of its own.
 *
 * Deliberately not httpOnly: the banner and the PostHog client both have to
 * read the decision, and there is nothing here worth protecting from script.
 */

export const CONSENT_COOKIE_NAME = 'qp_consent'
/** Set by middleware from the edge geo header so the client can decide whether to ask, without making every page dynamic. */
export const CONSENT_REQUIRED_COOKIE_NAME = 'qp_consent_required'
export const CONSENT_COOKIE_MAX_AGE = 180 * 24 * 60 * 60 // 6 months — re-ask twice a year

/**
 * Bump when the purposes change (a new processor, a new category of storage).
 * A stored decision against an older version is treated as absent, so the
 * banner asks again rather than silently reusing consent for something the
 * visitor never saw.
 */
export const CONSENT_VERSION = 1

export type ConsentDecision = 'granted' | 'denied'

/** `<decision>:<version>` — flat rather than JSON because it is read on every request. */
export function serializeConsent(decision: ConsentDecision): string {
  return `${decision}:${CONSENT_VERSION}`
}

export function parseConsent(cookieValue: string | undefined): ConsentDecision | null {
  if (!cookieValue) return null
  const [decision, version] = cookieValue.split(':')
  if (Number(version) !== CONSENT_VERSION) return null
  return decision === 'granted' || decision === 'denied' ? decision : null
}

/**
 * EEA + UK. Switzerland is deliberately absent: its FADP has no equivalent
 * prior-consent rule for cookies, so asking there would cost signups for
 * nothing.
 */
const CONSENT_REQUIRED_COUNTRIES = new Set([
  // EU 27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EEA non-EU
  'IS', 'LI', 'NO',
  // UK
  'GB',
])

/**
 * Fails closed. An absent or unrecognised country — local development, a
 * proxy that strips the header, an edge case at Vercel — asks for consent
 * rather than assuming it isn't needed. Getting this backwards would set
 * non-essential cookies on EU visitors silently, which is the failure that
 * actually matters.
 */
export function isConsentRequired(countryCode: string | null | undefined): boolean {
  if (!countryCode) return true
  return CONSENT_REQUIRED_COUNTRIES.has(countryCode.toUpperCase())
}

/**
 * May non-essential storage be written on this request?
 *
 * Note the asymmetry: outside the EEA/UK there is no prior-consent rule, so
 * storage is allowed unless the visitor explicitly declined — a decision we
 * still honour everywhere, because someone who said no meant it regardless of
 * where they were standing.
 */
export function mayStoreNonEssential(
  decision: ConsentDecision | null,
  consentRequired: boolean,
): boolean {
  if (decision === 'denied') return false
  if (decision === 'granted') return true
  return !consentRequired
}
