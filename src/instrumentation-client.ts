import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // No performance tracing for now — keeps bundle small and avoids quota burn.
  tracesSampleRate: 0,

  // No session replays — heavy and not needed yet.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Only send errors in production.
  enabled: process.env.NODE_ENV === 'production',
})
