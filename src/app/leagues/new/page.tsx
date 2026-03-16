'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function NewLeaguePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Create the league
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .insert({ name, description, owner_id: user.id })
      .select()
      .single()

    if (leagueError) { setError(leagueError.message); setLoading(false); return }

    // Auto-join as member
    await supabase.from('league_members').insert({ league_id: league.id, user_id: user.id })

    router.push(`/leagues/${league.id}`)
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

        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>LEAGUE NAME</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)} required maxLength={50}
              placeholder="e.g. The Federer Fan Club"
              className="w-full px-4 py-3 rounded-sm text-sm outline-none"
              style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
              onFocus={e => e.target.style.borderColor = 'var(--court)'}
              onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>DESCRIPTION <span style={{ opacity: 0.5 }}>(optional)</span></label>
            <input
              type="text" value={description} onChange={e => setDescription(e.target.value)} maxLength={120}
              placeholder="What's this league about?"
              className="w-full px-4 py-3 rounded-sm text-sm outline-none"
              style={{ background: 'white', border: '1.5px solid var(--chalk-dim)' }}
              onFocus={e => e.target.style.borderColor = 'var(--court)'}
              onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
            />
          </div>

          {error && <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>}

          <button
            type="submit" disabled={loading || !name.trim()}
            className="w-full py-3 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50 mt-1"
            style={{ background: 'var(--court)' }}
          >
            {loading ? 'Creating…' : 'Create league'}
          </button>
        </form>
      </div>
    </main>
  )
}
