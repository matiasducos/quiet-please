'use client'
import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { authUrl, getSafeRedirectPath, withNext } from '@/lib/auth-redirect'
import { TERMS_VERSION } from '@/lib/legal/terms'
import posthog from 'posthog-js'

/**
 * Fires the top of the signup funnel. Guarded on __loaded because PostHog
 * no-ops entirely when NEXT_PUBLIC_POSTHOG_KEY is unset — without the guard
 * this would throw on every signup attempt in an unconfigured environment.
 */
function trackSignupStarted(method: 'email' | 'google') {
  try {
    if (!posthog.__loaded) return
    posthog.capture('signup_started', { method })
  } catch {
    // Analytics must never block someone creating an account.
  }
}

const CONSENT_REQUIRED = 'Please accept the Terms of Service and Privacy Policy to continue.'

/**
 * The reasons to create an account. Shared by the desktop side panel and the
 * mobile strip above the form — the panel is `hidden lg:flex`, so before this
 * existed the mobile page was a bare form with no stated value at all, on the
 * device most acquisition traffic arrives on.
 */
const VALUE_PROPS = ['Free to play', 'ATP & WTA tournaments', 'Private leagues & challenges']

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawNext = searchParams.get('next')
  const next = getSafeRedirectPath(rawNext)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consented, setConsented] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  /**
   * Every route out of this page has to pass through here. The disabled buttons
   * are the visible gate, but keeping the check in one function means adding a
   * provider later (the Facebook handler below is already waiting on an app)
   * can't quietly create a path that skips consent.
   */
  function blockedByConsent() {
    if (consented) return false
    setError(CONSENT_REQUIRED)
    return true
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (blockedByConsent()) return
    setLoading(true); setError(null)
    trackSignupStarted('email')
    const supabase = createClient()
    // No username at signup — all users pick username at /setup-username after confirming email
    // The accepted version rides along on the confirmation link so /auth/callback can
    // record it. It can't be written here: with email confirmation on, signUp returns
    // a null session, so there is no authenticated context yet.
    // `next` rides on the confirmation link because the visitor may open it
    // hours later, in a different tab or on a different device — nothing
    // client-side survives that gap.
    const { data: signUpData, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}&consent=${TERMS_VERSION}` } })
    if (error) { setError(error.message); setLoading(false); return }
    // If email confirmation is required, session will be null — show check-email page
    if (!signUpData.session) {
      router.push(`/check-email?email=${encodeURIComponent(email)}`)
      return
    }
    // No confirmation needed → middleware redirects to /setup-username (username_is_set = false)
    router.push(next); router.refresh()
  }

  async function handleGoogleSignup() {
    if (blockedByConsent()) return
    trackSignupStarted('google')
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: withNext(`${window.location.origin}/auth/callback?consent=${TERMS_VERSION}`, rawNext) } })
  }

  async function handleFacebookSignup() {
    if (blockedByConsent()) return
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({ provider: 'facebook', options: { redirectTo: withNext(`${window.location.origin}/auth/callback?consent=${TERMS_VERSION}`, rawNext) } })
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--chalk)' }}>
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12" style={{ background: 'var(--court-dark)' }}>
        <Link href="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'white' }}>Quiet Please</Link>
        <div>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem,3vw,3rem)', color: 'white', lineHeight: 1.15, letterSpacing: '-0.02em', marginBottom: '2rem' }}>
            Your bracket.<br/>Your season.<br/><em style={{ color: 'var(--clay-light)' }}>Your glory.</em>
          </p>
          {VALUE_PROPS.map(f => (
            <div key={f} className="flex items-center gap-3 mb-2" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--clay-light)' }}>✓</span>{f}
            </div>
          ))}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>ATP · WTA · 2026 SEASON</div>
      </div>
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-16">
        <div className="max-w-sm w-full mx-auto">
          <Link href="/" className="lg:hidden mb-8 block" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>Create account</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
            Already have an account?{' '}<Link href={authUrl('/login', rawNext)} style={{ color: 'var(--court)' }}>Sign in</Link>
          </p>

          {/* Mobile-only echo of the desktop side panel. */}
          <ul className="lg:hidden flex flex-wrap gap-x-4 gap-y-1.5 mb-7 list-none p-0">
            {VALUE_PROPS.map(f => (
              <li key={f} className="flex items-center gap-1.5" style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--court)' }}>✓</span>{f}
              </li>
            ))}
          </ul>

          {/* The consent gate sits above both routes because it gates both.
              Keeping it down beside the email submit button would mean a
              Google click surfaced its refusal several hundred pixels below
              the button that was pressed — off-screen on a phone. */}
          <label className="flex items-start gap-2.5 cursor-pointer mb-4">
            <input type="checkbox" checked={consented} onChange={e => { setConsented(e.target.checked); if (e.target.checked && error === CONSENT_REQUIRED) setError(null) }}
              className="mt-0.5 shrink-0" style={{ width: '1rem', height: '1rem', accentColor: 'var(--court)' }} />
            <span className="text-xs" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
              I agree to the{' '}
              <Link href="/terms" target="_blank" onClick={e => e.stopPropagation()} style={{ color: 'var(--court)', textDecoration: 'underline' }}>Terms of Service</Link>{' '}and{' '}
              <Link href="/privacy" target="_blank" onClick={e => e.stopPropagation()} style={{ color: 'var(--court)', textDecoration: 'underline' }}>Privacy Policy</Link>.
            </span>
          </label>
          {error && <p className="text-sm px-3 py-2 rounded-sm mb-4" role="alert" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>}

          {/* Google first, and above the email form. It is the shorter path —
              no password to invent and no confirmation email to come back
              from — so it should not be the fallback under an "OR". */}
          <button onClick={handleGoogleSignup} className="w-full py-3 text-sm font-medium rounded-sm border hover:opacity-90 flex items-center justify-center gap-2.5 transition-opacity" style={{ borderColor: '#dadce0', color: '#3c4043', background: 'white' }}>
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px" style={{ background: 'var(--chalk-dim)' }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>OR</span>
            <div className="flex-1 h-px" style={{ background: 'var(--chalk-dim)' }} />
          </div>

          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>EMAIL</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-sm text-sm outline-none" style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
                onFocus={e => e.target.style.borderColor='var(--court)'} onBlur={e => e.target.style.borderColor='var(--chalk-dim)'} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>PASSWORD</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="Min. 8 characters"
                className="w-full px-4 py-3 rounded-sm text-sm outline-none" style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
                onFocus={e => e.target.style.borderColor='var(--court)'} onBlur={e => e.target.style.borderColor='var(--chalk-dim)'} />
            </div>
            {/* The submit button is disabled only while the request is in
                flight. It used to be disabled until consent too, which meant
                the primary CTA rendered greyed out on first paint and a click
                produced nothing at all — blockedByConsent() already refuses
                the submit and says why, in words, above. */}
            <button type="submit" disabled={loading} className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--court)' }}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          {/* Facebook signup hidden until FB app is set up — see todo.md */}
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
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}
