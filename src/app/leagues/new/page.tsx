'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createLeague } from './actions'

const TOURNAMENT_TYPES = [
  { value: 'grand_slam', label: 'Grand Slams' },
  { value: 'masters_1000', label: 'Masters 1000' },
  { value: '500', label: '500s' },
  { value: '250', label: '250s' },
] as const

export default function NewLeaguePage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isPublic, setIsPublic] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])

  function toggleType(val: string) {
    setSelectedTypes(prev => prev.includes(val) ? prev.filter(t => t !== val) : [...prev, val])
  }

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    formData.set('is_public', isPublic ? 'true' : 'false')
    formData.set('tournament_types', selectedTypes.join(','))
    const result = await createLeague(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-8" style={{ background: 'var(--chalk)' }}>
      <div className="w-full max-w-md">
        <Link href="/leagues" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>← Back to leagues</Link>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', margin: '1.5rem 0 0.5rem' }}>
          Create a league
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Invite friends with a shareable code after creating.
        </p>

        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>LEAGUE NAME</label>
            <input
              name="name"
              type="text"
              required
              maxLength={50}
              placeholder="e.g. The Federer Fan Club"
              className="w-full px-4 py-3 rounded-sm text-sm outline-none"
              style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
              onFocus={e => e.target.style.borderColor = 'var(--court)'}
              onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
              DESCRIPTION <span style={{ opacity: 0.5 }}>(optional)</span>
            </label>
            <input
              name="description"
              type="text"
              maxLength={120}
              placeholder="What's this league about?"
              className="w-full px-4 py-3 rounded-sm text-sm outline-none"
              style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
              onFocus={e => e.target.style.borderColor = 'var(--court)'}
              onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
            />
          </div>

          {/* Public / Private toggle */}
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>VISIBILITY</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className="flex-1 px-4 py-2.5 rounded-sm text-sm transition-colors"
                style={{
                  background: !isPublic ? 'var(--court)' : 'white',
                  color: !isPublic ? 'white' : 'var(--ink)',
                  border: `1.5px solid ${!isPublic ? 'var(--court)' : 'var(--chalk-dim)'}`,
                }}
              >
                🔒 Private
              </button>
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className="flex-1 px-4 py-2.5 rounded-sm text-sm transition-colors"
                style={{
                  background: isPublic ? 'var(--court)' : 'white',
                  color: isPublic ? 'white' : 'var(--ink)',
                  border: `1.5px solid ${isPublic ? 'var(--court)' : 'var(--chalk-dim)'}`,
                }}
              >
                🌐 Public
              </button>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '2px' }}>
              {isPublic ? 'Anyone can find and join this league.' : 'Only people with the invite code can join.'}
            </p>
          </div>

          {/* Tournament type filter */}
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
              TOURNAMENTS <span style={{ opacity: 0.5 }}>(optional filter)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {TOURNAMENT_TYPES.map(t => {
                const active = selectedTypes.includes(t.value)
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => toggleType(t.value)}
                    className="px-3 py-1.5 rounded-sm text-sm transition-colors"
                    style={{
                      background: active ? '#1e4e8c' : 'white',
                      color: active ? 'white' : 'var(--ink)',
                      border: `1.5px solid ${active ? '#1e4e8c' : 'var(--chalk-dim)'}`,
                    }}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '2px' }}>
              {selectedTypes.length === 0
                ? 'All tournament types count toward standings.'
                : `Only ${selectedTypes.length} selected type${selectedTypes.length > 1 ? 's' : ''} will count.`}
            </p>
          </div>

          {error && (
            <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed mt-1"
            style={{ background: 'var(--court)' }}
          >
            {loading ? 'Creating…' : 'Create league'}
          </button>
        </form>
      </div>
    </main>
  )
}
