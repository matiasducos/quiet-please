import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // No tracing: Sentry now loads on the first error (src/lib/sentry-lazy.ts),
  // too late to trace the request that caused it.

  // Only send errors in production.
  enabled: process.env.NODE_ENV === 'production',
})
