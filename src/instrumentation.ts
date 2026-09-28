/**
 * Sentry is NOT loaded here at boot — see src/lib/sentry-lazy.ts for why and
 * what that trades. `register` is still exported because Next expects the
 * hook; there is nothing left for it to do.
 */
export async function register() {}

/**
 * Next awaits this (base-server.js), so loading Sentry inside it on the first
 * error completes before the request ends; `captureRequestError` itself then
 * registers its flush with Vercel's waitUntil.
 */
export async function onRequestError(...args: Parameters<typeof import('@sentry/nextjs')['captureRequestError']>) {
  try {
    const { loadSentry } = await import('./lib/sentry-lazy')
    const sentry = await loadSentry()
    sentry.captureRequestError(...args)
  } catch (err) {
    console.error('[sentry] onRequestError failed:', err)
  }
}
