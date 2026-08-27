'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Step two: the recovery link has already been redeemed by /auth/callback, so
 * this page is reached with a real session. All that's left is to set the new
 * password on it.
 */
export default function ResetPasswordForm({ email }: { email: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Checked here as well as by the browser: `required`/`minLength` are a
    // convenience, not a guarantee. Supabase enforces its own minimum too, but
    // its error arrives after a round trip and in its own wording.
    if (password !== confirm) { setError('Those two passwords don’t match.'); return }
    setLoading(true); setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setLoading(false); return }
    // The session that redeemed the link is already a signed-in session, so
    // there is nothing to log into — go straight where a sign-in would land.
    // refresh() so the server components pick up the cookie.
    router.push('/dashboard'); router.refresh()
  }

  const field = {
    background: 'white',
    border: '1.5px solid var(--chalk-dim)',
  }

  return (
    <>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
        Choose a new password
      </h1>
      <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
        For <strong style={{ color: 'var(--ink)' }}>{email}</strong>. You&apos;ll stay signed in on this device.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>NEW PASSWORD</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoFocus
            autoComplete="new-password" placeholder="Min. 8 characters"
            className="w-full px-4 py-3 rounded-sm text-sm outline-none" style={field}
            onFocus={e => e.target.style.borderColor = 'var(--court)'} onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>CONFIRM</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8}
            autoComplete="new-password" placeholder="••••••••"
            className="w-full px-4 py-3 rounded-sm text-sm outline-none" style={field}
            onFocus={e => e.target.style.borderColor = 'var(--court)'} onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'} />
        </div>
        {error && <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>}
        <button type="submit" disabled={loading} className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--court)' }}>
          {loading ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </>
  )
}
