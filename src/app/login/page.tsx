'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/dashboard'); router.refresh()
  }

  async function handleGoogleLogin() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
  }

  async function handleFacebookLogin() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({ provider: 'facebook', options: { redirectTo: `${window.location.origin}/auth/callback` } })
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
            Don't have an account?{' '}<Link href="/signup" style={{ color: 'var(--court)' }}>Sign up</Link>
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
              <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>PASSWORD</label>
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
            <button onClick={handleFacebookLogin} className="w-full py-3 text-sm font-medium rounded-sm hover:opacity-90 flex items-center justify-center gap-2.5 transition-opacity" style={{ background: '#1877F2', color: 'white', border: 'none' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              Continue with Facebook
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
