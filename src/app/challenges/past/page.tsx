import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
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

export default async function PastChallengesPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const { data: rawChallenges } = await admin
    .from('challenges')
    .select('id, challenger_id, challenged_id, tournament_id, status, challenger_points, challenged_points, winner_id, created_at')
    .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
    .in('status', ['completed', 'declined', 'expired', 'cancelled'])
    .order('created_at', { ascending: false })

  const tournamentIds = [...new Set((rawChallenges ?? []).map(c => c.tournament_id))]
  const userIds = [...new Set((rawChallenges ?? []).flatMap(c => [c.challenger_id, c.challenged_id]))]

  const [tournamentsRes, usersRes] = await Promise.all([
    tournamentIds.length > 0
      ? admin.from('tournaments').select('id, name, status, location, flag_emoji').in('id', tournamentIds)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length > 0
      ? admin.from('users').select('id, username').in('id', userIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const tournamentMap = Object.fromEntries((tournamentsRes.data ?? []).map((t: any) => [t.id, { name: t.name, status: t.status, location: t.location, flag_emoji: t.flag_emoji }]))
  const usernameMap = Object.fromEntries((usersRes.data ?? []).map((u: any) => [u.id, u.username]))

  const challenges = (rawChallenges ?? []).map(c => ({
    ...c,
    tournament: tournamentMap[c.tournament_id] ?? { name: 'Unknown', status: 'unknown', location: null, flag_emoji: null },
    isChallenger: c.challenger_id === user.id,
    opponentName: c.challenger_id === user.id ? usernameMap[c.challenged_id] : usernameMap[c.challenger_id],
    myPoints: c.challenger_id === user.id ? c.challenger_points : c.challenged_points,
    theirPoints: c.challenger_id === user.id ? c.challenged_points : c.challenger_points,
    isWinner: c.winner_id === user.id,
    isDraw: c.status === 'completed' && c.winner_id === null,
  }))

  function statusLabel(status: string, isChallenger: boolean): { text: string; color: string } {
    if (status === 'completed') return { text: 'Completed', color: 'var(--muted)' }
    if (status === 'declined')  return { text: 'Declined',  color: '#c84b31' }
    if (status === 'expired')   return { text: 'Expired',   color: 'var(--muted)' }
    if (status === 'cancelled') return { text: 'Cancelled', color: 'var(--muted)' }
    return { text: status, color: 'var(--muted)' }
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" userId={user.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link>
          <span>/</span>
          <span>Past challenges</span>
        </div>

        <h1 className="mb-6" style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em' }}>
          Past challenges
        </h1>

        {challenges.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No past challenges yet.</p>
        ) : (
          <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
            {challenges.map(c => {
              const { text, color } = statusLabel(c.status, c.isChallenger)
              return (
                <Link
                  key={c.id}
                  href={`/challenges/${c.id}`}
                  className="flex items-center justify-between px-5 py-4 border-b last:border-0 tournament-card"
                  style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>
                        {c.opponentName}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: 'var(--chalk)', padding: '1px 5px', borderRadius: '2px' }}>
                        {c.isChallenger ? 'you challenged' : 'challenged you'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {c.tournament.flag_emoji && <span style={{ marginRight: '3px' }}>{c.tournament.flag_emoji}</span>}
                      {c.tournament.location ?? c.tournament.name} · {timeAgo(c.created_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 ml-4 flex-shrink-0">
                    {c.status === 'completed' && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', textAlign: 'right' }}>
                        <span style={{ color: 'var(--ink)' }}>{c.myPoints ?? 0}</span>
                        <span style={{ color: 'var(--muted)' }}> vs </span>
                        <span style={{ color: 'var(--ink)' }}>{c.theirPoints ?? 0}</span>
                        <div style={{ fontSize: '0.65rem', color: c.isDraw ? 'var(--muted)' : c.isWinner ? 'var(--court)' : '#c84b31', letterSpacing: '0.06em' }}>
                          {c.isDraw ? 'DRAW' : c.isWinner ? 'YOU WIN' : 'YOU LOSE'}
                        </div>
                      </div>
                    )}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color, letterSpacing: '0.03em' }}>
                      {text}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
