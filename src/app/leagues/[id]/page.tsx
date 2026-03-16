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
            <Link href={`/profile/${profile?.username}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none' }}>{profile?.username}</Link>
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
                  <Link href={`/profile/${username}`} style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: isMe ? 'var(--court)' : 'var(--ink)', textDecoration: 'none' }}>{username}</Link>
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
