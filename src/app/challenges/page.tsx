import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import CancelButton from './CancelButton'

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

function statusLabel(status: string, isChallenger: boolean): { text: string; color: string } {
  if (status === 'pending') {
    return isChallenger
      ? { text: 'Awaiting response', color: 'var(--muted)' }
      : { text: 'Needs your response', color: '#c17c00' }
  }
  if (status === 'accepted')  return { text: 'Active',    color: 'var(--court)' }
  if (status === 'completed') return { text: 'Completed', color: 'var(--muted)' }
  if (status === 'declined')  return { text: 'Declined',  color: '#c84b31' }
  if (status === 'expired')   return { text: 'Expired',   color: 'var(--muted)' }
  if (status === 'cancelled') return { text: 'Cancelled', color: 'var(--muted)' }
  return { text: status, color: 'var(--muted)' }
}

export default async function ChallengesPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const { data: rawChallenges } = await admin
    .from('challenges')
    .select('id, challenger_id, challenged_id, tournament_id, status, challenger_points, challenged_points, winner_id, created_at')
    .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
    .order('created_at', { ascending: false })

  // Fetch tournament details
  const tournamentIds = [...new Set((rawChallenges ?? []).map(c => c.tournament_id))]
  const userIds = [...new Set((rawChallenges ?? []).flatMap(c => [c.challenger_id, c.challenged_id]))]

  let tournamentMap: Record<string, { name: string; status: string; location: string | null; flag_emoji: string | null }> = {}
  let usernameMap: Record<string, string> = {}

  const [tournamentsRes, usersRes] = await Promise.all([
    tournamentIds.length > 0
      ? admin.from('tournaments').select('id, name, status, location, flag_emoji').in('id', tournamentIds)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length > 0
      ? admin.from('users').select('id, username').in('id', userIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  tournamentMap = Object.fromEntries((tournamentsRes.data ?? []).map((t: any) => [t.id, { name: t.name, status: t.status, location: t.location, flag_emoji: t.flag_emoji }]))
  usernameMap = Object.fromEntries((usersRes.data ?? []).map((u: any) => [u.id, u.username]))

  const challenges = (rawChallenges ?? []).map(c => ({
    ...c,
    tournament:     tournamentMap[c.tournament_id] ?? { name: 'Unknown', status: 'unknown', location: null, flag_emoji: null },
    isChallenger:   c.challenger_id === user.id,
    opponentId:     c.challenger_id === user.id ? c.challenged_id : c.challenger_id,
    opponentName:   c.challenger_id === user.id ? usernameMap[c.challenged_id] : usernameMap[c.challenger_id],
    myPoints:       c.challenger_id === user.id ? c.challenger_points : c.challenged_points,
    theirPoints:    c.challenger_id === user.id ? c.challenged_points : c.challenger_points,
    isWinner:       c.winner_id === user.id,
    isDraw:         c.status === 'completed' && c.winner_id === null,
  }))

  const needsAction = challenges.filter(c => c.status === 'pending' && !c.isChallenger)
  const active      = challenges.filter(c => c.status === 'accepted')
  const waiting     = challenges.filter(c => c.status === 'pending' && c.isChallenger)
  const closed      = challenges.filter(c => ['completed', 'declined', 'expired', 'cancelled'].includes(c.status))

  // Check if user has any accepted friends
  const { count: friendCount } = await admin
    .from('friendships')
    .select('*', { count: 'exact', head: true })
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .eq('status', 'accepted')

  const hasFriends = (friendCount ?? 0) > 0

  function ChallengeCard({ c }: { c: (typeof challenges)[0] }) {
    const { text, color } = statusLabel(c.status, c.isChallenger)
    return (
      <Link
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
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" userId={user.id} />

      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Challenges</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.65, marginTop: '0.4rem' }}>Pick a friend and go head-to-head on any open tournament. You each lock in your bracket — whoever scores more points when it&apos;s over wins the challenge.</p>
          <div className="flex gap-3 mt-4">
            <Link
              href="/friends"
              className="px-4 py-2 text-sm rounded-sm border transition-colors whitespace-nowrap"
              style={{ background: 'white', borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
            >
              Friends
            </Link>
            {hasFriends && (
              <Link
                href="/challenges/new"
                className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90 whitespace-nowrap"
                style={{ background: 'var(--court)', textDecoration: 'none' }}
              >
                New challenge
              </Link>
            )}
          </div>
        </div>

        {/* No friends yet */}
        {!hasFriends && challenges.length === 0 && (
          <div className="bg-white rounded-sm border py-16 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>Challenge a friend</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
              Add friends first, then challenge them for any upcoming tournament.
            </p>
            <Link
              href="/friends"
              className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
              style={{ background: 'var(--court)' }}
            >
              Add friends
            </Link>
          </div>
        )}

        {/* Needs your response */}
        {needsAction.length > 0 && (
          <div className="mb-8">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Needs your response
            </h2>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {needsAction.map(c => <ChallengeCard key={c.id} c={c} />)}
            </div>
          </div>
        )}

        {/* Active */}
        {active.length > 0 && (
          <div className="mb-8">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Active
            </h2>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {active.map(c => <ChallengeCard key={c.id} c={c} />)}
            </div>
          </div>
        )}

        {/* Waiting for response */}
        {waiting.length > 0 && (
          <div className="mb-8">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Waiting for response
            </h2>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {waiting.map(c => (
                <div key={c.id} className="flex items-center border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
                  <Link
                    href={`/challenges/${c.id}`}
                    className="flex items-center justify-between flex-1 min-w-0 px-5 py-4 tournament-card"
                    style={{ textDecoration: 'none' }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>
                          {c.opponentName}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: 'var(--chalk)', padding: '1px 5px', borderRadius: '2px' }}>
                          you challenged
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                        {c.tournament.name} · {timeAgo(c.created_at)}
                      </div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.03em', marginLeft: '1rem' }}>
                      Awaiting response
                    </span>
                  </Link>
                  <div className="flex-shrink-0 pr-4">
                    <CancelButton challengeId={c.id} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed / closed */}
        {closed.length > 0 && (
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Past challenges
            </h2>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {closed.map(c => <ChallengeCard key={c.id} c={c} />)}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
