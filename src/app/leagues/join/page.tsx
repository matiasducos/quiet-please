'use client'
import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { joinLeague } from './actions'

function JoinLeagueForm() {
  const searchParams = useSearchParams()
  const prefillCode = searchParams.get('code')?.toUpperCase().trim() ?? ''
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await joinLeague(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 md:px-8" style={{ background: 'var(--chalk)' }}>
      <div className="w-full max-w-md">
        <Link href="/leagues" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>← Back to leagues</Link>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', margin: '1.5rem 0 0.5rem' }}>
          Join a league
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Enter the invite code shared by the league owner.
        </p>

        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>INVITE CODE</label>
            <input
              name="code"
              type="text"
              required
              maxLength={8}
              defaultValue={prefillCode}
              placeholder="e.g. A3F8B2C1"
              className="w-full px-4 py-3 rounded-sm text-sm outline-none"
              style={{ background: 'white', border: '1.5px solid var(--chalk-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', fontSize: '1.1rem' }}
              onFocus={e => e.target.style.borderColor = 'var(--court)'}
              onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
            />
          </div>

          {error && (
            <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50 mt-1"
            style={{ background: 'var(--court)' }}
          >
            {loading ? 'Joining…' : 'Join league'}
          </button>
        </form>
      </div>
    </main>
  )
}

// useSearchParams() requires a Suspense boundary. That boundary used to come
// from the root layout, which wrapped the entire app — and an app-wide boundary
// is what turned every notFound() in the product into a 200 (see the note in
// src/app/layout.tsx). It belongs here instead, around the one component that
// actually needs it.
export default function JoinLeaguePage() {
  return (
    <Suspense fallback={null}>
      <JoinLeagueForm />
    </Suspense>
  )
}
