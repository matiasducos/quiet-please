import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Low sample rate for production visibility (5% of page loads)
  tracesSampleRate: 0.05,

  // No session replays — heavy and not needed yet.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Only send errors in production.
  enabled: process.env.NODE_ENV === 'production',
})
