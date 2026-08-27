'use client'
import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { authUrl, getSafeRedirectPath, withNext } from '@/lib/auth-redirect'
import { SHOW_FACEBOOK_LOGIN } from '@/lib/auth-providers'
import posthog from 'posthog-js'

/**
 * Fires on every successful password sign-in (not just first-ever). OAuth
 * logins are tracked server-side in /auth/callback instead, since
 * signInWithOAuth only kicks off a redirect here with no success callback.
 * Guarded on __loaded for the same reason as trackSignupStarted in /signup —
 * PostHog no-ops when unconfigured and would otherwise throw mid-login.
 */
function trackLoggedIn() {
  try {
    if (!posthog.__loaded) return
    posthog.capture('user_logged_in', { method: 'password' })
  } catch {
    // Analytics must never block someone signing in.
  }
}

/**
 * /auth/callback runs on the server and can only answer with a redirect, so the
 * one channel it has for explaining a failure is the query string. Every code
 * it can send is spelled out here.
 *
 * An allow-list rather than rendering the param: an unrecognised code shows
 * nothing at all, so a crafted ?error= cannot put attacker-chosen text on the
 * sign-in page — a link that reads "your account is locked, call this number"
 * is more convincing on the real domain than anywhere else.
 */
const AUTH_ERRORS: Record<string, string> = {
  auth_callback_failed:
    'We could not complete that sign-in. If you used Facebook, check that you allowed '
    + 'access to your email address — an account cannot be created without one.',
  reset_link_invalid:
    'That password reset link did not work. It may have expired, been used already, or '
    + 'been opened in a different browser from the one that asked for it — links are tied '
    + 'to the browser that requested them. Use “Forgot?” above to send a fresh one.',
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Where this visitor was heading before the gate stopped them. Validated on
  // read as well as on use — it comes from the query string, so it is
  // attacker-supplied until proven otherwise.
  const rawNext = searchParams.get('next')
  const next = getSafeRedirectPath(rawNext)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Seeded from the callback's ?error= via a lazy initialiser rather than an
  // effect. The redirect has already happened by first paint, so there is
  // nothing to synchronise — and setting state from an effect is what
  // react-hooks/set-state-in-effect exists to stop.
  const [error, setError] = useState<string | null>(
    () => AUTH_ERRORS[searchParams.get('error') ?? ''] ?? null,
  )
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    trackLoggedIn()
    router.push(next); router.refresh()
  }

  async function handleGoogleLogin() {
    const supabase = createClient()
    // The OAuth round trip leaves our origin entirely, so the target has to
    // travel on the callback URL — there is no client state to come back to.
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: withNext(`${window.location.origin}/auth/callback`, rawNext) } })
  }

  async function handleFacebookLogin() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({ provider: 'facebook', options: { redirectTo: withNext(`${window.location.origin}/auth/callback`, rawNext) } })
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--chalk)' }}>
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12" style={{ background: 'var(--ink)' }}>
        <Link href="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'white' }}>Quiet Please</Link>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem,3vw,3rem)', color: 'white', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
          "Every great<br/>champion was<br/>once a<br/><em style={{ color: 'var(--court-light)' }}>contender."</em>
        </p>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>ATP · WTA · 2026 SEASON</div>
      </div>
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-16">
        <div className="max-w-sm w-full mx-auto">
          <Link href="/" className="lg:hidden mb-8 block" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>Welcome back</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
            {/* Carries `next` across, so guessing wrong about whether someone
                already has an account never costs them their destination. */}
            Don't have an account?{' '}<Link href={authUrl('/signup', rawNext)} style={{ color: 'var(--court)' }}>Sign up</Link>
          </p>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>EMAIL</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-sm text-sm outline-none"
                style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
                onFocus={e => e.target.style.borderColor='var(--court)'} onBlur={e => e.target.style.borderColor='var(--chalk-dim)'} />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>PASSWORD</label>
                {/* Beside the field, not buried under the button: someone who
                    cannot remember their password finds out here, not after a
                    failed attempt. */}
                <Link href="/forgot-password" style={{ fontSize: '0.75rem', color: 'var(--court)' }}>Forgot?</Link>
              </div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••"
                className="w-full px-4 py-3 rounded-sm text-sm outline-none"
                style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
                onFocus={e => e.target.style.borderColor='var(--court)'} onBlur={e => e.target.style.borderColor='var(--chalk-dim)'} />
            </div>
            {error && <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>}
            <button type="submit" disabled={loading} className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--court)' }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="mt-4 text-xs text-center" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
            By signing in, you agree to our{' '}
            <Link href="/terms" style={{ color: 'var(--court)', textDecoration: 'underline' }}>Terms</Link>{' '}and{' '}
            <Link href="/privacy" style={{ color: 'var(--court)', textDecoration: 'underline' }}>Privacy Policy</Link>.
          </p>
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px" style={{ background: 'var(--chalk-dim)' }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>OR</span>
            <div className="flex-1 h-px" style={{ background: 'var(--chalk-dim)' }} />
          </div>
          <div className="flex flex-col gap-3">
            <button onClick={handleGoogleLogin} className="w-full py-3 text-sm font-medium rounded-sm border hover:opacity-90 flex items-center justify-center gap-2.5 transition-opacity" style={{ borderColor: '#dadce0', color: '#3c4043', background: 'white' }}>
              <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </button>
            {SHOW_FACEBOOK_LOGIN && (
              <button onClick={handleFacebookLogin} className="w-full py-3 text-sm font-medium rounded-sm hover:opacity-90 flex items-center justify-center gap-2.5 transition-opacity" style={{ color: 'white', background: '#1877F2' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.88v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07z"/></svg>
                Continue with Facebook
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// useSearchParams() requires a Suspense boundary. That boundary used to come
// from the root layout, which wrapped the entire app — and an app-wide boundary
// is what turned every notFound() in the product into a 200 (see the note in
// src/app/layout.tsx). It belongs here instead, around the one component that
// actually needs it.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
