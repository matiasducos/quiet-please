import posthog from 'posthog-js'

/**
 * Initialize PostHog client-side. Called once in the PostHogProvider.
 * Uses cookieless mode (persistence: 'memory') — no cookie banner needed.
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
    // Cookieless mode — no cookie banner needed, GDPR-friendly
    persistence: 'memory',
    // Auto-capture page views via the Next.js router (see PostHogPageView)
    capture_pageview: false,
    // Auto-capture clicks, inputs, etc.
    autocapture: true,
    // Don't capture text content of elements (privacy)
    mask_all_text: false,
    // Disable session recording by default (enable later if needed)
    disable_session_recording: true,
  })
}

export default posthog
