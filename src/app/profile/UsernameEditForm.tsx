'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateUsername } from '@/app/profile/actions'

export default function UsernameEditForm({ username }: { username: string }) {
  const [value, setValue] = useState(username)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const clean = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
  const unchanged = clean === username
  const tooShort = clean.length < 3

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (unchanged || tooShort || isPending) return
    setError(null)

    startTransition(async () => {
      const formData = new FormData()
      formData.set('username', clean)
      formData.set('old_username', username)
      const result = await updateUsername(formData)
      if (result.error) {
        setError(result.error)
      } else {
        router.push(`/profile/${clean}?msg=Username+updated&type=success`)
        router.refresh()
      }
    })
  }

  return (
    <div className="mb-8 bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '1.25rem' }}>
        Change your username
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label
            htmlFor="username"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              color: 'var(--muted)',
              letterSpacing: '0.06em',
              display: 'block',
              marginBottom: '0.4rem',
            }}
          >
            USERNAME
          </label>
          <input
            id="username"
            type="text"
            value={value}
            onChange={e => {
              setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
              setError(null)
            }}
            maxLength={20}
            className="w-full px-3 py-2 rounded-sm border text-sm"
            style={{
              borderColor: error ? '#f5c0b8' : 'var(--chalk-dim)',
              fontFamily: 'var(--font-mono)',
              background: 'white',
              outline: 'none',
            }}
            autoComplete="off"
          />
          <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.35rem', fontFamily: 'var(--font-mono)' }}>
            3-20 characters. Letters, numbers, and underscores only.
          </p>
        </div>

        {error && (
          <div
            className="rounded-sm px-4 py-2.5 text-sm"
            style={{
              background: '#fdecea',
              color: '#c84b31',
              border: '1px solid #f5c0b8',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
            }}
          >
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={unchanged || tooShort || isPending}
            className="px-5 py-2 text-sm font-medium text-white rounded-sm disabled:opacity-40"
            style={{ background: 'var(--court)' }}
          >
            {isPending ? 'Saving...' : 'Save username'}
          </button>
          <Link
            href={`/profile/${username}`}
            style={{ fontSize: '0.85rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
