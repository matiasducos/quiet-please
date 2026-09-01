import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import Link from 'next/link'
import Nav from '@/components/Nav'
import ChallengeRow, { type ChallengeRowData } from './ChallengeRow'
import {
  PAST_CHALLENGE_STATUSES,
  NON_EVENT_CHALLENGE_STATUSES,
} from '@/lib/challenges/status'

export const metadata: Metadata = { title: 'Challenges' }

const mono = { fontFamily: 'var(--font-mono)' } as const

const PAST_LIMIT = 15

/**
 * One titled group of challenge rows. Defined at module scope rather than
 * inside the page: a component created during render is a new type on every
 * pass, which remounts everything under it (react-hooks/static-components).
 */
function Section({ title, rows, withCancel = false, action }: {
  title: string
  rows: ChallengeRowData[]
  withCancel?: boolean
  action?: React.ReactNode
}) {
  if (rows.length === 0) return null
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
          {title}
        </h2>
        {action}
      </div>
      <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
        {rows.map(c => <ChallengeRow key={c.id} c={c} withCancel={withCancel} />)}
      </div>
    </div>
  )
}


export default async function ChallengesPage() {
  const { user, profile } = await getNavProfile()

  // Anonymous visitors see a landing page
  if (!user) {
    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav activePage="challenges" />
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
          <div className="mb-8">
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Challenges</h1>
            <p style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.65, marginTop: '0.4rem' }}>
              Fill in a bracket, send the link, and play a friend head-to-head. No account needed.
            </p>
          </div>
          <div className="bg-white rounded-sm border py-12 md:py-16 px-4 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>Challenge a friend</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem', maxWidth: '28rem', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
              Make your picks first, then send the link. Your friend makes theirs — each pick
              stays face-down until its match is played, and whoever scores more points wins.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/challenges/create"
                className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
                style={{ background: 'var(--court)', textDecoration: 'none' }}
              >
                Create a challenge
              </Link>
              <Link
                href="/login"
                className="px-6 py-2.5 text-sm rounded-sm border"
                style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', textDecoration: 'none' }}
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const admin = createAdminClient()

  const { data: rawChallenges, error: challengesErr } = await admin
    .from('challenges')
    .select('id, challenger_id, challenged_id, tournament_id, status, scope_round, challenger_points, challenged_points, winner_id, created_at')
    .or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`)
    .order('created_at', { ascending: false })

  if (challengesErr) console.error('[challenges] read failed', challengesErr)

  const tournamentIds = [...new Set((rawChallenges ?? []).map(c => c.tournament_id))]
  const userIds = [...new Set((rawChallenges ?? []).flatMap(c => [c.challenger_id, c.challenged_id]))]

  const [tournamentsRes, usersRes] = await Promise.all([
    tournamentIds.length > 0
      ? admin.from('tournaments').select('id, name, status, location, flag_emoji').in('id', tournamentIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    userIds.length > 0
      ? admin.from('users').select('id, username').in('id', userIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ])

  if (tournamentsRes.error) console.error('[challenges] tournaments read failed', tournamentsRes.error)
  if (usersRes.error) console.error('[challenges] users read failed', usersRes.error)

  const tournamentMap: Record<string, { name: string; status: string; location: string | null; flag_emoji: string | null }> =
    Object.fromEntries((tournamentsRes.data ?? []).map((t: any) => [t.id, { name: t.name, status: t.status, location: t.location, flag_emoji: t.flag_emoji }]))
  const usernameMap: Record<string, string> =
    Object.fromEntries((usersRes.data ?? []).map((u: any) => [u.id, u.username]))

  // Live points and pick counts for the challenges still in play. Bounded by
  // this one user's open challenges, not by anything that grows with the
  // user base — a handful of rows.
  const openChallengeIds = (rawChallenges ?? [])
    .filter(c => ['draft', 'pending', 'accepted'].includes(c.status))
    .map(c => c.id)

  const livePredMap: Record<string, { user_id: string; points_earned: number; pickCount: number }[]> = {}

  if (openChallengeIds.length > 0) {
    const { data: livePreds, error: predsErr } = await admin
      .from('predictions')
      .select('challenge_id, user_id, points_earned, picks')
      .in('challenge_id', openChallengeIds)

    if (predsErr) console.error('[challenges] predictions read failed', predsErr)

    for (const p of livePreds ?? []) {
      if (!livePredMap[p.challenge_id]) livePredMap[p.challenge_id] = []
      livePredMap[p.challenge_id].push({
        user_id: p.user_id,
        points_earned: p.points_earned ?? 0,
        pickCount: Object.keys((p.picks as Record<string, string> | null) ?? {}).length,
      })
    }
  }

  const challenges = (rawChallenges ?? []).map(c => {
    const preds = livePredMap[c.id] ?? []
    const myPred = preds.find(p => p.user_id === user.id)
    const theirPred = preds.find(p => p.user_id !== user.id)
    const isChallenger = c.challenger_id === user.id

    return {
      ...c,
      tournament:      tournamentMap[c.tournament_id] ?? { name: 'Unknown', status: 'unknown', location: null, flag_emoji: null },
      isChallenger,
      opponentName:    isChallenger ? usernameMap[c.challenged_id] : usernameMap[c.challenger_id],
      myPoints:        isChallenger ? c.challenger_points : c.challenged_points,
      theirPoints:     isChallenger ? c.challenged_points : c.challenger_points,
      isWinner:        c.winner_id === user.id,
      isDraw:          c.status === 'completed' && c.winner_id === null,
      myLivePoints:    myPred?.points_earned ?? 0,
      theirLivePoints: theirPred?.points_earned ?? 0,
      myPickCount:     myPred?.pickCount ?? 0,
    }
  })

  type Row = (typeof challenges)[number]

  /**
   * Grouped by who the row is waiting on rather than by database status.
   *
   * "Your move" covers three lifecycle states — a draft you have not sent, an
   * invite you have not answered, and an accepted challenge you have not picked
   * for. They are different rows in the table and the same thing to the person
   * reading the page, which is the only grouping that makes a list scannable.
   */
  const yourMove = challenges.filter(c =>
    (c.status === 'draft' && c.isChallenger) ||
    (c.status === 'pending' && !c.isChallenger) ||
    (c.status === 'accepted' && c.myPickCount === 0)
  )
  const inPlay      = challenges.filter(c => c.status === 'accepted' && c.myPickCount > 0)
  const waitingThem = challenges.filter(c => c.status === 'pending' && c.isChallenger)
  const closed      = challenges.filter(c => (PAST_CHALLENGE_STATUSES as readonly string[]).includes(c.status))

  const { count: friendCount } = await admin
    .from('friendships')
    .select('*', { count: 'exact', head: true })
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .eq('status', 'accepted')

  const hasFriends = (friendCount ?? 0) > 0
  const played = challenges.filter(c => !(NON_EVENT_CHALLENGE_STATUSES as readonly string[]).includes(c.status) && c.status !== 'draft')

  const toRow = (c: Row): ChallengeRowData => ({
    id: c.id,
    status: c.status,
    scope_round: c.scope_round,
    created_at: c.created_at,
    isChallenger: c.isChallenger,
    opponentName: c.opponentName ?? null,
    isWinner: c.isWinner,
    isDraw: c.isDraw,
    // A finished challenge reports the figures the cron settled on; a running
    // one reports what has been scored so far.
    myPoints:    c.status === 'completed' ? (c.myPoints ?? 0)    : c.myLivePoints,
    theirPoints: c.status === 'completed' ? (c.theirPoints ?? 0) : c.theirLivePoints,
    myPicksOutstanding: c.status === 'accepted' && c.myPickCount === 0,
    tournament: c.tournament,
  })

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" userId={user.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Challenges</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.65, marginTop: '0.4rem' }}>
            Go head-to-head with a friend on any open tournament. Each pick stays face-down
            until its match is played — whoever scores more points wins.
          </p>
          <div className="flex flex-wrap gap-3 mt-4">
            {hasFriends && (
              <Link
                href="/challenges/new"
                className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90 whitespace-nowrap"
                style={{ background: 'var(--court)', textDecoration: 'none' }}
              >
                New challenge
              </Link>
            )}
            <Link
              href="/friends"
              className="px-4 py-2 text-sm rounded-sm border transition-colors whitespace-nowrap"
              style={{ background: 'white', borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
            >
              Friends
            </Link>
          </div>

          {/* Held back until there is a record to report. Three zeroes at the
              top of an empty page is a worse greeting than no panel at all. */}
          {played.length > 0 && (
            <div className="grid grid-cols-3 gap-2 md:gap-4 mt-6">
              {[
                { label: 'In play', value: yourMove.length + inPlay.length + waitingThem.length },
                { label: 'Won',     value: challenges.filter(c => c.isWinner).length },
                { label: 'Played',  value: played.length },
              ].map(stat => (
                <div key={stat.label} className="bg-white rounded-sm border p-3 md:p-6 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
                  <div style={{ ...mono, fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                    {stat.label}
                  </div>
                  <div className="text-xl md:text-3xl" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!hasFriends && challenges.length === 0 && (
          <div className="bg-white rounded-sm border py-12 md:py-16 px-4 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>Challenge a friend</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Add friends first, then challenge them on any open tournament. Or send a
              link to someone without an account.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/friends"
                className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
                style={{ background: 'var(--court)', textDecoration: 'none' }}
              >
                Add friends
              </Link>
              <Link
                href="/challenges/create"
                className="px-6 py-2.5 text-sm rounded-sm border"
                style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)', textDecoration: 'none' }}
              >
                Send a link instead
              </Link>
            </div>
          </div>
        )}

        <Section title="Your move" rows={yourMove.map(toRow)} />
        <Section title="In play" rows={inPlay.map(toRow)} />
        <Section title="Waiting on them" rows={waitingThem.map(toRow)} withCancel />
        <Section
          title="Past challenges"
          rows={closed.slice(0, PAST_LIMIT).map(toRow)}
          action={closed.length > PAST_LIMIT ? (
            <Link
              href="/challenges/past"
              style={{ ...mono, fontSize: '0.75rem', color: 'var(--court)', textDecoration: 'none' }}
              className="transition-opacity hover:opacity-70 whitespace-nowrap"
            >
              See all →
            </Link>
          ) : undefined}
        />
      </div>
    </main>
  )
}
