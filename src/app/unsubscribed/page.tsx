import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Unsubscribed — Quiet Please',
}

export default function UnsubscribedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--chalk)' }}>
      <div className="max-w-sm text-center px-4">
        <p className="mb-4" style={{ fontSize: '2rem' }}>✓</p>
        <h1 className="mb-2" style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
          You&apos;ve been unsubscribed
        </h1>
        <p className="mb-6" style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
          You won&apos;t receive any more email notifications from Quiet Please.
          You can re-enable notifications at any time in your account settings.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 text-sm font-medium text-white rounded-sm"
          style={{ background: 'var(--court)' }}
        >
          Go to homepage
        </Link>
      </div>
    </div>
  )
}
