'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function RouteError({
  error,
  reset,
  title = 'Something went wrong',
}: {
  error: Error & { digest?: string }
  reset: () => void
  title?: string
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>
          {title}
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
          An error occurred while loading this page. Please try again.
        </p>
        <button
          onClick={reset}
          className="px-5 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
          style={{ background: 'var(--court)' }}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
