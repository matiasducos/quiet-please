import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ResetPasswordForm from './ResetPasswordForm'

/**
 * Landing point for a redeemed recovery link.
 *
 * /auth/callback has already exchanged the `?code=` for a session by the time
 * anyone gets here, so "is there a user?" is the whole gate. No user means the
 * link was never redeemed — a direct navigation, an expired or already-used
 * link, or the link opened in a different browser from the one that requested
 * it (the PKCE verifier lives in a cookie; see /forgot-password). Saying that
 * plainly beats bouncing to /login, where the reason would be invisible.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen flex items-center justify-center py-12" style={{ background: 'var(--chalk)' }}>
      <div className="max-w-sm w-full mx-auto px-4 sm:px-8">
        <Link href="/" className="block text-center" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '2.5rem' }}>
          Quiet Please
        </Link>

        <div className="bg-white rounded-sm border p-6 sm:p-8" style={{ borderColor: 'var(--chalk-dim)' }}>
          {user?.email ? (
            <ResetPasswordForm email={user.email} />
          ) : (
            <div className="text-center">
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
                That link has expired
              </h1>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                Reset links last an hour, work once, and have to be opened in the browser that
                asked for them. Send yourself a fresh one.
              </p>
              <Link href="/forgot-password" className="inline-block w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
                Send a new link
              </Link>
            </div>
          )}
        </div>

        <p className="mt-6 text-center" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
          <Link href="/login" style={{ color: 'var(--court)' }}>Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
