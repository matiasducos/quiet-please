#!/bin/bash
set -e

mkdir -p "src/app/leagues"
mkdir -p "src/app/leagues/new"
mkdir -p "src/app/leagues/[id]"
mkdir -p "src/app/leagues/join/[code]"

# ── Leagues list page ─────────────────────────────────────────
cat > "src/app/leagues/page.tsx" << 'EOF'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function LeaguesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  // Get leagues the user is a member of
  const { data: memberships } = await supabase
    .from('league_members')
    .select('league_id, total_points, joined_at, leagues(id, name, description, invite_code, owner_id, is_active)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false })

  const leagues = (memberships ?? []).map(m => ({
    ...(m.leagues as any),
    my_points: m.total_points,
  }))

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>
        <div className="flex items-center gap-6">
          <Link href="/tournaments" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Tournaments</Link>
          <Link href="/leaderboard" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Leaderboard</Link>
          <Link href="/leagues" style={{ fontSize: '0.875rem', color: 'var(--ink)', fontWeight: 500 }}>Leagues</Link>
          <div className="flex items-center gap-3 ml-4 pl-4 border-l" style={{ borderColor: 'var(--chalk-dim)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{profile?.username}</span>
            <span className="score-pill">{profile?.total_points ?? 0} pts</span>
            <form action="/auth/logout" method="post">
              <button type="submit" style={{ fontSize: '0.8rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Sign out</button>
            </form>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Leagues</h1>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>Compete with friends across the full season.</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/leagues/join"
              className="px-4 py-2 text-sm rounded-sm border transition-colors"
              style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
            >
              Join with code
            </Link>
            <Link
              href="/leagues/new"
              className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90"
              style={{ background: 'var(--court)' }}
            >
              Create league
            </Link>
          </div>
        </div>

        {leagues.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-sm border" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>No leagues yet</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>Create one or join with an invite code.</p>
            <Link href="/leagues/new" className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
              Create your first league
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {leagues.map((league: any) => (
              <Link
                key={league.id}
                href={`/leagues/${league.id}`}
                className="flex items-center justify-between bg-white rounded-sm border px-6 py-5 tournament-card"
                style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>{league.name}</span>
                    {league.owner_id === user.id && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--court)', background: '#eaf3de', padding: '1px 6px', borderRadius: '2px' }}>owner</span>
                    )}
                  </div>
                  {league.description && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{league.description}</p>
                  )}
                </div>
                <div className="text-right">
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--ink)' }}>{league.my_points} pts</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px' }}>your score</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
EOF

# ── Create league page ────────────────────────────────────────
cat > "src/app/leagues/new/page.tsx" << 'EOF'
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
EOF

# ── League detail page ────────────────────────────────────────
cat > "src/app/leagues/[id]/page.tsx" << 'EOF'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params

  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (!league) notFound()

  // Check user is a member
  const { data: myMembership } = await supabase
    .from('league_members')
    .select('total_points')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .single()

  if (!myMembership) redirect('/leagues')

  // Get all members with their points
  const { data: members } = await supabase
    .from('league_members')
    .select('user_id, total_points, joined_at, users(username)')
    .eq('league_id', id)
    .order('total_points', { ascending: false })

  const { data: profile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  const isOwner = league.owner_id === user.id
  const myRank = (members ?? []).findIndex(m => m.user_id === user.id)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>
        <div className="flex items-center gap-6">
          <Link href="/tournaments" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Tournaments</Link>
          <Link href="/leaderboard" style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Leaderboard</Link>
          <Link href="/leagues" style={{ fontSize: '0.875rem', color: 'var(--ink)', fontWeight: 500 }}>Leagues</Link>
          <div className="flex items-center gap-3 ml-4 pl-4 border-l" style={{ borderColor: 'var(--chalk-dim)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{profile?.username}</span>
            <span className="score-pill">{profile?.total_points ?? 0} pts</span>
            <form action="/auth/logout" method="post">
              <button type="submit" style={{ fontSize: '0.8rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Sign out</button>
            </form>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-8 py-10">
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/leagues" style={{ color: 'var(--muted)' }}>Leagues</Link>
          <span>/</span>
          <span>{league.name}</span>
        </div>

        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{league.name}</h1>
            {league.description && <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>{league.description}</p>}
          </div>
          {isOwner && (
            <div className="flex flex-col items-end gap-2">
              <div className="px-4 py-3 bg-white rounded-sm border text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: '4px' }}>INVITE CODE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', color: 'var(--court)', letterSpacing: '0.1em' }}>{league.invite_code}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '4px' }}>Share with friends</div>
              </div>
            </div>
          )}
        </div>

        {/* My rank highlight */}
        {myRank >= 0 && (
          <div className="mb-6 px-5 py-4 rounded-sm border" style={{ background: '#eaf3de', borderColor: '#97C459' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#27500A', minWidth: '32px' }}>#{myRank + 1}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: '#27500A' }}>{profile?.username} (you)</span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#27500A' }}>{myMembership.total_points} pts</span>
            </div>
          </div>
        )}

        {/* Members leaderboard */}
        <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
            <div className="col-span-1" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>RANK</div>
            <div className="col-span-8" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>PLAYER</div>
            <div className="col-span-3 text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>POINTS</div>
          </div>

          {(members ?? []).map((m, i) => {
            const isMe = m.user_id === user.id
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
            const username = (m.users as any)?.username ?? 'Unknown'
            return (
              <div key={m.user_id} className="grid grid-cols-12 px-5 py-4 border-b last:border-0"
                style={{ borderColor: 'var(--chalk-dim)', background: isMe ? '#f5faf0' : 'white' }}>
                <div className="col-span-1 flex items-center">
                  {medal ? <span style={{ fontSize: '1rem' }}>{medal}</span>
                    : <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>{i + 1}</span>}
                </div>
                <div className="col-span-8 flex items-center gap-2">
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: isMe ? 'var(--court)' : 'var(--ink)' }}>{username}</span>
                  {isMe && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--court)', background: '#eaf3de', padding: '1px 6px', borderRadius: '2px' }}>you</span>}
                  {m.user_id === league.owner_id && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: 'var(--chalk-dim)', padding: '1px 6px', borderRadius: '2px' }}>owner</span>}
                </div>
                <div className="col-span-3 flex items-center justify-end">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: m.total_points > 0 ? 'var(--ink)' : 'var(--muted)' }}>{m.total_points}</span>
                </div>
              </div>
            )
          })}
        </div>

        {!isOwner && (
          <div className="mt-4 text-center">
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              Invite code: <span style={{ color: 'var(--court)' }}>{league.invite_code}</span>
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
EOF

# ── Join league page ──────────────────────────────────────────
mkdir -p "src/app/leagues/join"
cat > "src/app/leagues/join/page.tsx" << 'EOF'
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
EOF

echo "✅ All league pages written"
