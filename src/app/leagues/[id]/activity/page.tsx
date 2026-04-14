import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
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

export default async function LeagueActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { id } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const [{ data: league }, { data: myMembership }, { data: members }] = await Promise.all([
    supabase.from('leagues').select('id, name, allowed_tournament_types, allowed_surfaces').eq('id', id).single(),
    supabase.from('league_members').select('league_id').eq('league_id', id).eq('user_id', user.id).single(),
    supabase.from('league_members').select('user_id, joined_at, users(username)').eq('league_id', id),
  ])

  if (!league) notFound()
  if (!myMembership) redirect('/leagues')

  const memberIds = (members ?? []).map(m => m.user_id)

  type ActivityItem = { type: 'join' | 'picks' | 'points'; user_id: string; username: string; label: string; date: string }
  let activityItems: ActivityItem[] = []

  if (memberIds.length > 0) {
    const [{ data: lockedPicks }, { data: pointsRows }] = await Promise.all([
      admin.from('predictions')
        .select('user_id, tournament_id, submitted_at, users(username), tournaments(name, location, flag_emoji, category, surface)')
        .in('user_id', memberIds).eq('is_fully_locked', true).is('challenge_id', null)
        .order('submitted_at', { ascending: false }).limit(200),
      admin.from('point_ledger')
        .select('user_id, tournament_id, points, awarded_at, users(username), tournaments(name, location, flag_emoji, category, surface)')
        .in('user_id', memberIds).order('awarded_at', { ascending: false }).limit(500),
    ])

    const allowedTypes = league.allowed_tournament_types as string[] | null
    const allowedSurfaces = league.allowed_surfaces as string[] | null
    const typeFilter = (t: any) => {
      if (allowedTypes && !allowedTypes.includes(t?.tournaments?.category)) return false
      if (allowedSurfaces && (!t?.tournaments?.surface || !allowedSurfaces.includes(t?.tournaments?.surface))) return false
      return true
    }

    const joinEvents: ActivityItem[] = (members ?? []).map(m => ({
      type: 'join', user_id: m.user_id, username: (m.users as any)?.username ?? 'Unknown', label: 'joined the league', date: m.joined_at,
    }))

    const picksEvents: ActivityItem[] = (lockedPicks ?? []).filter(typeFilter).map((p: any) => {
      const flag = p.tournaments?.flag_emoji ? `${p.tournaments.flag_emoji} ` : ''
      return {
        type: 'picks', user_id: p.user_id, username: p.users?.username ?? 'Unknown',
        label: `locked picks for ${flag}${p.tournaments?.location ?? p.tournaments?.name ?? 'a tournament'}`, date: p.submitted_at,
      }
    })

    const pointsMap = new Map<string, { user_id: string; username: string; points: number; tournament_name: string; awarded_at: string }>()
    for (const row of (pointsRows ?? []).filter(typeFilter) as any[]) {
      const key = `${row.user_id}:${row.tournament_id}`
      const existing = pointsMap.get(key)
      const flag = row.tournaments?.flag_emoji ? `${row.tournaments.flag_emoji} ` : ''
      if (existing) { existing.points += row.points; if (row.awarded_at > existing.awarded_at) existing.awarded_at = row.awarded_at }
      else { pointsMap.set(key, { user_id: row.user_id, username: row.users?.username ?? 'Unknown', points: row.points, tournament_name: `${flag}${row.tournaments?.location ?? row.tournaments?.name ?? 'a tournament'}`, awarded_at: row.awarded_at }) }
    }
    const pointsEvents: ActivityItem[] = Array.from(pointsMap.values()).map(p => ({
      type: 'points', user_id: p.user_id, username: p.username, label: `earned ${p.points} pts at ${p.tournament_name}`, date: p.awarded_at,
    }))

    activityItems = [...joinEvents, ...picksEvents, ...pointsEvents]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="leagues" />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/leagues" style={{ color: 'var(--muted)' }}>Leagues</Link>
          <span>/</span>
          <Link href={`/leagues/${id}`} style={{ color: 'var(--muted)' }}>{league.name}</Link>
          <span>/</span>
          <span>Activity</span>
        </div>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>
          All activity
        </h1>

        {activityItems.length === 0 ? (
          <div className="bg-white rounded-sm border py-10 px-6 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>No activity yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
            {activityItems.map((item, i) => {
              const isMe = item.user_id === user.id
              const icon = item.type === 'join' ? '👋' : item.type === 'picks' ? '🔒' : '⭐'
              return (
                <div key={`${item.type}-${item.user_id}-${item.date}-${i}`} className="flex items-center gap-3 px-5 py-3 border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
                  <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon}</span>
                  <div className="flex-1 min-w-0 truncate">
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: isMe ? 'var(--court)' : 'var(--ink)' }}>
                      <Link href={`/profile/${item.username}`} style={{ color: 'inherit', textDecoration: 'none' }}>{item.username}</Link>
                    </span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}> {item.label}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>{timeAgo(item.date)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
