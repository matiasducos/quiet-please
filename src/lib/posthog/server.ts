import { PostHog } from 'posthog-node'

/**
 * Server-side PostHog client for tracking events in server actions and API routes.
 * Uses the Node SDK — events are batched and flushed automatically.
 */
let posthogServer: PostHog | null = null

export function getPostHogServer(): PostHog | null {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return null

  if (!posthogServer) {
    posthogServer = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
      // Flush events immediately in serverless (no persistent process)
      flushAt: 1,
      flushInterval: 0,
    })
  }

  return posthogServer
}

/**
 * Track a server-side event. Safe to call without await — errors are swallowed.
 * No-ops if PostHog is not configured.
 */
export function trackServerEvent(
  userId: string,
  event: string,
  properties?: Record<string, unknown>,
) {
  try {
    const ph = getPostHogServer()
    if (!ph) return
    ph.capture({ distinctId: userId, event, properties })
  } catch {
    // Never fail the request for analytics
  }
}
