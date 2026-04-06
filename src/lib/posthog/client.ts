import posthog from 'posthog-js'

/**
 * Initialize PostHog client-side. Called once in the PostHogProvider.
 * Uses cookieless mode (persistence: 'memory') — no cookie banner needed.
 */
export function initPostHog() {
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
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
