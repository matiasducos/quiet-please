import posthog from 'posthog-js'
import {
  CONSENT_COOKIE_NAME,
  CONSENT_REQUIRED_COOKIE_NAME,
  isConsentRequired,
  mayStoreNonEssential,
  parseConsent,
  type ConsentDecision,
} from '@/lib/consent'

/** Full persistence — a stable distinct_id across page loads and visits. */
const PERSISTENT = 'localStorage+cookie' as const
/** Cookieless fallback: no device storage, so it needs no consent. */
const EPHEMERAL = 'memory' as const

/** document.cookie returns raw percent-encoded values; the server-side APIs decode, this does not. */
function readCookie(name: string): string | undefined {
  const raw = document.cookie
    .split('; ')
    .find(row => row.startsWith(`${name}=`))
    ?.split('=')[1]
  if (raw === undefined) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Which persistence this visitor's consent state allows.
 *
 * The distinction matters more than it looks. Under 'memory' the distinct_id
 * lives in a JS variable and dies on every full page load, so one visitor
 * becomes many person records and sessions, funnels, bounce rate and
 * retention are all meaningless — measured on real data, `/` reported 21
 * persons across 21 sessions. Consent is what buys those metrics back.
 */
function allowedPersistence(): typeof PERSISTENT | typeof EPHEMERAL {
  const requiredFlag = readCookie(CONSENT_REQUIRED_COOKIE_NAME)
  // Middleware has not run yet on a very first paint; assume consent is
  // needed rather than writing storage we might not be allowed to.
  const consentRequired = requiredFlag === undefined ? true : requiredFlag === '1'
  const decision = parseConsent(readCookie(CONSENT_COOKIE_NAME))
  return mayStoreNonEssential(decision, consentRequired) ? PERSISTENT : EPHEMERAL
}

/**
 * Apply a fresh consent decision without a reload.
 *
 * Granting upgrades persistence in place, so the events already captured this
 * page load stay attached to the id that carries forward. Declining drops
 * back to memory and clears anything PostHog had already stored — withdrawal
 * has to remove what was kept, not merely stop adding to it.
 */
export function applyConsentToPostHog(decision: ConsentDecision) {
  if (!posthog.__loaded) return
  try {
    if (decision === 'granted') {
      posthog.set_config({ persistence: PERSISTENT })
    } else {
      posthog.set_config({ persistence: EPHEMERAL })
      posthog.reset()
    }
  } catch {
    // Analytics configuration must never break the page.
  }
}

/** Exported for the rare caller that needs the same rule outside PostHog. */
export { isConsentRequired }

/**
 * Initialize PostHog client-side. Called once in the PostHogProvider.
 *
 * Persistence follows consent: cookieless for anyone in a consent region who
 * has not agreed, full persistence otherwise. Capture itself is not gated —
 * cookieless capture stores nothing on the device, so ePrivacy does not
 * engage; the GDPR basis for processing it is disclosed in the privacy policy.
 */
export function initPostHog() {
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    console.warn('[PostHog] NEXT_PUBLIC_POSTHOG_KEY is not set — skipping init')
    return
  }

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    // Same-origin by design — /ingest/* is rewritten to PostHog EU in
    // next.config.ts. Deliberately not env-overridable: pointing this at
    // eu.i.posthog.com directly would be blocked by our own connect-src 'self'
    // CSP and fail silently, which is exactly the trap this avoids.
    api_host: '/ingest',
    // Needed so "view in PostHog" links in the toolbar resolve to the real app
    // rather than to /ingest on our own domain.
    ui_host: 'https://eu.posthog.com',
    // Consent-driven — see allowedPersistence(). Was unconditionally 'memory',
    // which avoided a banner at the cost of every logged-out visitor becoming
    // a fresh person record on every full page load.
    persistence: allowedPersistence(),
    // Auto-capture page views via the Next.js router (see PostHogPageView)
    capture_pageview: false,
    // Pairs with the manual $pageview capture to emit $pageleave on unload/
    // route change, which is what lets PostHog compute time-on-page and
    // session duration — there's no other duration tracking in this app.
    capture_pageleave: true,
    // Auto-capture clicks, inputs, etc.
    autocapture: true,
    // Don't capture text content of elements (privacy)
    mask_all_text: false,
    // Disable session recording by default (enable later if needed)
    disable_session_recording: true,
  })
}

export default posthog
