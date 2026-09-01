import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentCard from '@/components/TournamentCard'
import ChallengeButton from './ChallengeButton'
import { availableScopes } from '@/lib/challenges/scope'
import type { Draw } from '@/lib/tennis/types'

const mono = { fontFamily: 'var(--font-mono)' } as const

function Shell({
  children,
  crumbs,
  profile,
  userId,
}: {
  children: React.ReactNode
  crumbs: React.ReactNode
  profile: any
  userId: string
}) {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" userId={userId} />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="flex items-center gap-2 mb-6 flex-wrap" style={{ fontSize: '0.8rem', color: 'var(--muted)', ...mono }}>
          {crumbs}
        </div>
        {children}
      </div>
    </main>
  )
}

export default async function NewChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ friend_id?: string; tournament_id?: string }>
}) {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const { friend_id: friendId, tournament_id: tournamentId } = await searchParams
  const admin = createAdminClient()

  // ── Step 1: pick a friend ──────────────────────────────────────────────────
  if (!friendId) {
    const { data: friendships, error: friendshipsErr } = await admin
      .from('friendships')
      .select('id, requester_id, addressee_id')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq('status', 'accepted')

    if (friendshipsErr) console.error('[challenges/new] friendships read failed', friendshipsErr)

    const friendIds = (friendships ?? []).map(f =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    )

    let friends: { id: string; username: string }[] = []
    if (friendIds.length > 0) {
      const { data: users, error: usersErr } = await admin
        .from('users')
        .select('id, username')
        .in('id', friendIds)
      if (usersErr) console.error('[challenges/new] users read failed', usersErr)
      friends = (users ?? []) as { id: string; username: string }[]
    }

    return (
      <Shell
        profile={profile}
        userId={user.id}
        crumbs={<><Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link><span>/</span><span>New</span></>}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
          New challenge
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Step 1 of 3 — pick a friend to challenge.
        </p>

        {friends.length === 0 ? (
          <div className="bg-white rounded-sm border py-16 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>No friends yet</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
              Add friends first before creating a challenge.
            </p>
            <Link
              href="/friends"
              className="px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
              style={{ background: 'var(--court)', textDecoration: 'none' }}
            >
              Add friends
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
            {friends.map(f => (
              <Link
                key={f.id}
                href={`/challenges/new?friend_id=${f.id}`}
                className="flex items-center justify-between gap-3 px-4 md:px-5 py-4 border-b last:border-0 tournament-card"
                style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
              >
                <span
                  style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {f.username}
                </span>
                <span style={{ ...mono, fontSize: '0.8rem', color: 'var(--court)', flexShrink: 0 }}>
                  Select →
                </span>
              </Link>
            ))}
          </div>
        )}
      </Shell>
    )
  }

  // Verify the friend_id is a real accepted friend
  const { data: friendship } = await admin
    .from('friendships')
    .select('id')
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${friendId}),` +
      `and(requester_id.eq.${friendId},addressee_id.eq.${user.id})`
    )
    .eq('status', 'accepted')
    .maybeSingle()

  if (!friendship) redirect('/challenges/new')

  const { data: friendProfile } = await admin
    .from('users')
    .select('username')
    .eq('id', friendId)
    .single()

  const friendUsername = friendProfile?.username ?? 'your friend'

  const baseCrumbs = (
    <>
      <Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link>
      <span>/</span>
      <Link href="/challenges/new" style={{ color: 'var(--muted)' }}>New</Link>
      <span>/</span>
      <Link href={`/challenges/new?friend_id=${friendId}`} style={{ color: 'var(--muted)' }}>{friendUsername}</Link>
    </>
  )

  // ── Step 2: pick a tournament ─────────────────────────────────────────────
  if (!tournamentId) {
    // Challenges always open for accepting_predictions + in_progress regardless of prediction mode toggle
    const challengeStatuses = ['upcoming', 'accepting_predictions', 'in_progress']
    const { data: tournaments, error: tournamentsErr } = await admin
      .from('tournaments')
      .select('id, name, tour, category, surface, starts_at, ends_at, status, location, flag_emoji')
      .in('status', challengeStatuses)
      .order('starts_at', { ascending: true })
      .limit(60)

    if (tournamentsErr) console.error('[challenges/new] tournaments read failed', tournamentsErr)

    return (
      <Shell profile={profile} userId={user.id} crumbs={baseCrumbs}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
          Challenge {friendUsername}
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Step 2 of 3 — pick a tournament.
        </p>

        {!tournaments || tournaments.length === 0 ? (
          <div className="bg-white rounded-sm border py-12 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No tournaments available right now.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tournaments.map((t: any) => (
              <TournamentCard
                key={t.id}
                t={t}
                disableLink
                action={
                  <Link
                    href={`/challenges/new?friend_id=${friendId}&tournament_id=${t.id}`}
                    className="inline-block px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90 whitespace-nowrap"
                    style={{ background: 'var(--court)', textDecoration: 'none' }}
                  >
                    Choose →
                  </Link>
                }
              />
            ))}
          </div>
        )}
      </Shell>
    )
  }

  // ── Step 3: how much of the draw ──────────────────────────────────────────
  const [{ data: tournament }, { data: drawRow }, { data: results }] = await Promise.all([
    admin.from('tournaments').select('id, name, tour, surface, status, location, flag_emoji').eq('id', tournamentId).single(),
    admin.from('draws').select('bracket_data').eq('tournament_id', tournamentId).maybeSingle(),
    admin.from('match_results').select('external_match_id, winner_external_id').eq('tournament_id', tournamentId),
  ])

  if (!tournament) redirect(`/challenges/new?friend_id=${friendId}`)

  const draw = (drawRow?.bracket_data as Draw | null) ?? null
  const resultMap: Record<string, string> = Object.fromEntries(
    (results ?? []).map(r => [r.external_match_id, r.winner_external_id]),
  )

  const scopes = draw?.matches?.length
    ? availableScopes(draw.matches, draw.rounds, resultMap)
    : []

  const crumbs = (
    <>
      {baseCrumbs}
      <span>/</span>
      <span>{tournament.location ?? tournament.name}</span>
    </>
  )

  return (
    <Shell profile={profile} userId={user.id} crumbs={crumbs}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
        Challenge {friendUsername}
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
        Step 3 of 3 — {tournament.flag_emoji && <span>{tournament.flag_emoji} </span>}
        {tournament.location ?? tournament.name}.
      </p>

      <div className="bg-white rounded-sm border p-4 md:p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
        {scopes.length === 0 ? (
          <>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', marginBottom: '0.4rem' }}>
              Nothing left to play for
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.6 }}>
              {draw?.matches?.length
                ? 'Every match in this draw has been played, so there is nothing to predict.'
                : 'The draw for this tournament has not been published yet. Challenges open when it is.'}
            </p>
          </>
        ) : (
          <ChallengeButton
            friendId={friendId}
            tournamentId={tournamentId}
            friendUsername={friendUsername}
            scopes={scopes}
          />
        )}
      </div>
    </Shell>
  )
}
