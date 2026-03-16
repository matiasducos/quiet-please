import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

export default async function LeaderboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: users } = await supabase
    .from('users')
    .select('id, username, total_points, created_at')
    .order('total_points', { ascending: false })
    .limit(50)

  const { data: profile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  const myRank = users?.findIndex(u => u.id === user.id) ?? -1

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.total_points ?? 0} activePage="leaderboard" userId={user.id} />

      <div className="max-w-3xl mx-auto px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Leaderboard
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Global rankings — 2026 season
          </p>
        </div>

        {/* My rank highlight */}
        {myRank >= 0 && (
          <div className="mb-6 px-5 py-4 rounded-sm border" style={{ background: '#eaf3de', borderColor: '#97C459' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#27500A', minWidth: '32px' }}>
                  #{myRank + 1}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: '#27500A' }}>
                  {profile?.username} (you)
                </span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#27500A', fontWeight: 500 }}>
                {profile?.total_points ?? 0} pts
              </span>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
          {/* Header */}
          <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
            <div className="col-span-1" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>RANK</div>
            <div className="col-span-8" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>PLAYER</div>
            <div className="col-span-3 text-right" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>POINTS</div>
          </div>

          {!users || users.length === 0 ? (
            <div className="px-5 py-12 text-center" style={{ color: 'var(--muted)' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>No players yet</p>
              <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Be the first to make predictions!</p>
            </div>
          ) : (
            users.map((u, i) => {
              const isMe = u.id === user.id
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
              return (
                <div
                  key={u.id}
                  className="grid grid-cols-12 px-5 py-4 border-b last:border-0 transition-colors"
                  style={{
                    borderColor: 'var(--chalk-dim)',
                    background: isMe ? '#f5faf0' : 'white',
                  }}
                >
                  <div className="col-span-1 flex items-center">
                    {medal ? (
                      <span style={{ fontSize: '1rem' }}>{medal}</span>
                    ) : (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                        {i + 1}
                      </span>
                    )}
                  </div>
                  <div className="col-span-8 flex items-center gap-2">
                    <Link href={`/profile/${u.username}`} style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '1rem',
                      color: isMe ? 'var(--court)' : 'var(--ink)',
                      fontWeight: isMe ? 500 : 400,
                      textDecoration: 'none',
                    }}>
                      {u.username}
                    </Link>
                    {isMe && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--court)', background: '#eaf3de', padding: '1px 6px', borderRadius: '2px' }}>
                        you
                      </span>
                    )}
                  </div>
                  <div className="col-span-3 flex items-center justify-end">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: u.total_points > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                      {u.total_points}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <p className="mt-4 text-center" style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Showing top 50 players · Points update after each match result
        </p>
      </div>
    </main>
  )
}
