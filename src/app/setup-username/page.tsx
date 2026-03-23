'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { setUsername } from './actions'

export default function SetupUsernamePage() {
  const [username, setUsernameValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await setUsername(username)
      if (result.error) {
        setError(result.error)
      } else {
        router.push('/onboarding')
        router.refresh()
      }
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--chalk)' }}>
      <div className="max-w-sm w-full mx-auto px-8">
        <Link href="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', display: 'block', marginBottom: '3rem' }}>
          Quiet Please
        </Link>

        <div className="bg-white rounded-sm border p-8" style={{ borderColor: 'var(--chalk-dim)' }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.75rem',
              letterSpacing: '-0.02em',
              marginBottom: '0.5rem',
            }}
          >
            Pick your username
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '2rem' }}>
            This is how you'll appear on leaderboards and to other players. You can't change it later.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--muted)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.05em',
                }}
              >
                USERNAME
              </label>
              <input
                type="text"
                value={username}
                onChange={e =>
                  setUsernameValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                }
                required
                minLength={3}
                maxLength={20}
                placeholder="federer_fan"
                className="w-full px-4 py-3 rounded-sm text-sm outline-none"
                style={{
                  background: 'white',
                  border: '1.5px solid var(--chalk-dim)',
                  fontFamily: 'var(--font-mono)',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--court)')}
                onBlur={e => (e.target.style.borderColor = 'var(--chalk-dim)')}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                3–20 characters · letters, numbers, underscores only
              </p>
            </div>

            {error && (
              <p
                className="text-sm px-3 py-2 rounded-sm"
                style={{ background: '#fef2f2', color: '#b91c1c' }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isPending || username.length < 3}
              className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--court)' }}
            >
              {isPending ? 'Saving…' : 'Set username'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
