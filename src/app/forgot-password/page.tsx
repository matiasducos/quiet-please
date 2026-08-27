'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

/**
 * Step one of password recovery: ask Supabase to mail a one-time link.
 *
 * Runs in the browser rather than in a server action on purpose. The recovery
 * link comes back as a PKCE `?code=`, and the matching code verifier is written
 * by whichever Supabase client started the flow. `createBrowserClient` stores it
 * in a cookie, which is what lets /auth/callback — running on the server —
 * redeem the code later. Kicking this off server-side would mint a verifier no
 * browser ever holds, and every link would fail on arrival.
 *
 * Consequence worth knowing: the link must be opened in the same browser that
 * asked for it. Requesting on a laptop and tapping the mail on a phone lands on
 * /login with `reset_link_invalid`, which says so.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // useState rather than useFormStatus: this is not a server action, so there is
  // no pending form for that hook to read — same as /login and /signup.
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`,
    })
    setLoading(false)
    // What may and may not be reported.
    //
    // Only ONE class of failure has to stay hidden: "no account for that
    // address". Saying it turns the form into an account-enumeration oracle,
    // so a 400 is reported as success like a real send.
    //
    // Everything else is safe to surface, because it does not depend on
    // whether the account exists — and hiding it is actively harmful. This
    // page shipped reporting success on every non-429 outcome, and the very
    // first request it took in production was a 500 ("Error sending recovery
    // email" — Supabase Auth had no working SMTP). The user was told to check
    // an inbox nothing was ever sent to, and the failure was invisible from
    // both ends. A reset form that lies about sending is worse than no reset
    // form at all: it converts a fixable outage into a user who thinks they
    // are out of options.
    if (error?.status === 429) {
      setError('Too many requests. Wait a few minutes, then try again.')
      return
    }
    if (error && error.status !== 400) {
      setError(
        'Something went wrong on our side sending that email — this is not you. '
        + 'Write to support@quietplease.app and we will get you back in.',
      )
      // Sentry is already wired app-wide; this is the one signal that would
      // otherwise never reach it, since the page renders a success state.
      console.error('[forgot-password] recovery send failed:', error.status, error.message)
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12" style={{ background: 'var(--chalk)' }}>
      <div className="max-w-sm w-full mx-auto px-4 sm:px-8">
        <Link href="/" className="block text-center" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '2.5rem' }}>
          Quiet Please
        </Link>

        <div className="bg-white rounded-sm border p-6 sm:p-8" style={{ borderColor: 'var(--chalk-dim)' }}>
          {sent ? (
            <div className="text-center">
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📬</div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
                Check your email
              </h1>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                If there&apos;s an account for <strong style={{ color: 'var(--ink)' }}>{email}</strong>, a link to
                choose a new password is on its way. It expires in an hour, and works once.
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6, marginTop: '1.25rem' }}>
                Open it in this browser — the link is tied to the one that asked for it.
                Nothing arrived? Check spam, or{' '}
                <button onClick={() => { setSent(false); setError(null) }} style={{ color: 'var(--court)', textDecoration: 'underline' }}>
                  try another address
                </button>.
              </p>
            </div>
          ) : (
            <>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
                Forgot your password?
              </h1>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                Give us the email you signed up with and we&apos;ll send a link to set a new one.
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>EMAIL</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="you@example.com"
                    className="w-full px-4 py-3 rounded-sm text-sm outline-none"
                    style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
                    onFocus={e => e.target.style.borderColor = 'var(--court)'} onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'} />
                </div>
                {error && <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>}
                <button type="submit" disabled={loading} className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--court)' }}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
              {/* Someone who signed up with Google has no password to reset and
                  would otherwise sit waiting for mail that never comes. */}
              <p className="mt-5 text-xs" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
                Signed up with Google? You never set a password — go back and use{' '}
                <strong style={{ color: 'var(--ink)' }}>Continue with Google</strong> instead.
              </p>
            </>
          )}
        </div>

        <p className="mt-6 text-center" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
          <Link href="/login" style={{ color: 'var(--court)' }}>Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
