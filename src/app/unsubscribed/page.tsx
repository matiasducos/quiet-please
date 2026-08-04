import Link from 'next/link'
import type { Metadata } from 'next'
import { EMAIL_PREF_KEYS, EMAIL_PREF_LABELS, type EmailPrefKey } from '@/lib/email-preferences'

export const metadata: Metadata = {
  title: 'Unsubscribed',
}

export default async function UnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const sp = await searchParams
  // Only trust a known key — the value lands in rendered copy, and an unknown
  // one would either read as nonsense or reflect arbitrary text back at the user.
  const type = EMAIL_PREF_KEYS.includes(sp.type as EmailPrefKey)
    ? (sp.type as EmailPrefKey)
    : null

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--chalk)' }}>
      <div className="max-w-sm text-center px-4">
        <p className="mb-4" style={{ fontSize: '2rem' }}>✓</p>
        <h1 className="mb-2" style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
          {type ? 'Unsubscribed from these emails' : 'You’ve been unsubscribed'}
        </h1>
        <p className="mb-6" style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
          {type ? (
            <>
              You won&apos;t receive <strong style={{ color: 'var(--ink)' }}>“{EMAIL_PREF_LABELS[type].label}”</strong>{' '}
              emails any more &mdash; {EMAIL_PREF_LABELS[type].description.toLowerCase()}.
              Your other Quiet Please emails are unchanged. You can turn each one on or
              off under <strong style={{ color: 'var(--ink)' }}>Email preferences</strong> on your profile.
            </>
          ) : (
            <>
              You won&apos;t receive any more email notifications from Quiet Please.
              You can re-enable them at any time under <strong style={{ color: 'var(--ink)' }}>Email preferences</strong> on your profile.
            </>
          )}
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
