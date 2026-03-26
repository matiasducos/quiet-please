import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // No performance tracing for now.
  tracesSampleRate: 0,

  // Only send errors in production.
  enabled: process.env.NODE_ENV === 'production',
})
