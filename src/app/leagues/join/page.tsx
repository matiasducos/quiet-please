'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function JoinLeaguePage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Find league by invite code
    const { data: league } = await supabase
      .from('leagues')
      .select('id, name')
      .eq('invite_code', code.toUpperCase().trim())
      .eq('is_active', true)
      .single()

    if (!league) {
      setError('Invalid invite code. Check the code and try again.')
      setLoading(false)
      return
    }

    // Check if already a member
    const { data: existing } = await supabase
      .from('league_members')
      .select('league_id')
      .eq('league_id', league.id)
      .eq('user_id', user.id)
      .single()

    if (existing) {
      router.push(`/leagues/${league.id}`)
      return
    }

    // Join the league
    const { error: joinError } = await supabase
      .from('league_members')
      .insert({ league_id: league.id, user_id: user.id })

    if (joinError) { setError(joinError.message); setLoading(false); return }

    router.push(`/leagues/${league.id}`)
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-8" style={{ background: 'var(--chalk)' }}>
      <div className="w-full max-w-md">
        <Link href="/leagues" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>← Back to leagues</Link>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', margin: '1.5rem 0 0.5rem' }}>
          Join a league
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Enter the invite code shared by the league owner.
        </p>

        <form onSubmit={handleJoin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>INVITE CODE</label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              required
              placeholder="e.g. A3F8B2C1"
              maxLength={8}
              className="w-full px-4 py-3 rounded-sm text-sm outline-none"
              style={{ background: 'white', border: '1.5px solid var(--chalk-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', fontSize: '1.1rem' }}
              onFocus={e => e.target.style.borderColor = 'var(--court)'}
              onBlur={e => e.target.style.borderColor = 'var(--chalk-dim)'}
            />
          </div>

          {error && <p className="text-sm px-3 py-2 rounded-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>}

          <button
            type="submit" disabled={loading || code.length < 6}
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
