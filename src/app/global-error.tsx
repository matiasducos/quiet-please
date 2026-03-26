'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#fafaf8', color: '#1a1a18', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', margin: 0, padding: '1rem' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Something went wrong</h2>
          <p style={{ fontSize: '0.875rem', color: '#8a8a7a', marginBottom: '1.5rem' }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          <button
            onClick={reset}
            style={{ background: '#4a7c59', color: 'white', border: 'none', padding: '0.625rem 1.5rem', borderRadius: '4px', fontSize: '0.875rem', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
