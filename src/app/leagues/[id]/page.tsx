import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { id } = await params

  // ── Parallel fetch: league, membership, members, profile ────────────────
  const [{ data: league }, { data: myMembership }, { data: members }, { data: profile }] = await Promise.all([
    supabase.from('leagues').select('*').eq('id', id).single(),
    supabase.from('league_members').select('total_points').eq('league_id', id).eq('user_id', user.id).single(),
    supabase.from('league_members').select('user_id, total_points, joined_at, users(username)').eq('league_id', id).order('total_points', { ascending: false }),
    supabase.from('users').select('username, ranking_points').eq('id', user.id).single(),
  ])

  if (!league) notFound()
  if (!myMembership) redirect('/leagues')

  const isOwner = league.owner_id === user.id
  const myRank = (members ?? []).findIndex(m => m.user_id === user.id)

  // Activity feed — needs admin client to bypass RLS on other users' rows
  const memberIds = (members ?? []).map(m => m.user_id)
  const admin = createAdminClient()

  type ActivityItem = {
    type: 'join' | 'picks' | 'points'
    user_id: string
    username: string
    label: string
    date: string
  }

  let activityItems: ActivityItem[] = []

  if (memberIds.length > 0) {
    const [{ data: lockedPicks }, { data: pointsRows }] = await Promise.all([
      admin
        .from('predictions')
        .select('user_id, tournament_id, submitted_at, users(username), tournaments(name)')
        .in('user_id', memberIds)
        .eq('is_fully_locked', true)
        .is('challenge_id', null)
        .order('submitted_at', { ascending: false })
        .limit(50),
      admin
        .from('point_ledger')
        .select('user_id, tournament_id, points, awarded_at, users(username), tournaments(name)')
        .in('user_id', memberIds)
        .order('awarded_at', { ascending: false })
        .limit(100),
    ])

    // Join events from league_members (already fetched)
    const joinEvents: ActivityItem[] = (members ?? []).map(m => ({
      type: 'join',
      user_id: m.user_id,
      username: (m.users as any)?.username ?? 'Unknown',
      label: 'joined the league',
      date: m.joined_at,
    }))

    // Locked picks events
    const picksEvents: ActivityItem[] = (lockedPicks ?? []).map((p: any) => ({
      type: 'picks',
      user_id: p.user_id,
      username: p.users?.username ?? 'Unknown',
      label: `locked picks for ${p.tournaments?.name ?? 'a tournament'}`,
      date: p.submitted_at,
    }))

    // Points events — aggregate by user+tournament to avoid one row per match
    const pointsMap = new Map<string, { user_id: string; username: string; points: number; tournament_name: string; awarded_at: string }>()
    for (const row of (pointsRows ?? []) as any[]) {
      const key = `${row.user_id}:${row.tournament_id}`
      const existing = pointsMap.get(key)
      if (existing) {
        existing.points += row.points
        if (row.awarded_at > existing.awarded_at) existing.awarded_at = row.awarded_at
      } else {
        pointsMap.set(key, {
          user_id: row.user_id,
          username: row.users?.username ?? 'Unknown',
          points: row.points,
          tournament_name: row.tournaments?.name ?? 'a tournament',
          awarded_at: row.awarded_at,
        })
      }
    }
    const pointsEvents: ActivityItem[] = Array.from(pointsMap.values()).map(p => ({
      type: 'points',
      user_id: p.user_id,
      username: p.username,
      label: `earned ${p.points} pts at ${p.tournament_name}`,
      date: p.awarded_at,
    }))

    activityItems = [...joinEvents, ...picksEvents, ...pointsEvents]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 20)
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leagues" />

      <div className="max-w-5xl mx-auto px-8 py-10">
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

        {/* Activity feed */}
        <div className="mt-10">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
            Recent activity
          </h2>

          {activityItems.length === 0 ? (
            <div className="bg-white rounded-sm border py-10 px-6 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>No activity yet. Invite friends and start predicting!</p>
            </div>
          ) : (
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {activityItems.map((item, i) => {
                const isMe = item.user_id === user.id
                const icon = item.type === 'join' ? '👋' : item.type === 'picks' ? '🔒' : '⭐'
                return (
                  <div
                    key={`${item.type}-${item.user_id}-${item.date}-${i}`}
                    className="flex items-center gap-3 px-5 py-3 border-b last:border-0"
                    style={{ borderColor: 'var(--chalk-dim)' }}
                  >
                    <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon}</span>
                    <div className="flex-1 min-w-0">
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: isMe ? 'var(--court)' : 'var(--ink)' }}>
                        <Link href={`/profile/${item.username}`} style={{ color: 'inherit', textDecoration: 'none' }}>{item.username}</Link>
                      </span>
                      <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}> {item.label}</span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>
                      {timeAgo(item.date)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
