import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { createChallenge } from './actions'

const SURFACE_LABELS: Record<string, string> = {
  hard: 'Hard', clay: 'Clay', grass: 'Grass', carpet: 'Carpet',
}

export default async function NewChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ friend_id?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('username, total_points')
    .eq('id', user.id)
    .single()

  const { friend_id: friendId } = await searchParams
  const admin = createAdminClient()

  // ── Step 1: pick a friend ──────────────────────────────────────────────────
  if (!friendId) {
    const { data: friendships } = await admin
      .from('friendships')
      .select('id, requester_id, addressee_id')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq('status', 'accepted')

    const friendIds = (friendships ?? []).map(f =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    )

    let friends: { id: string; username: string }[] = []
    if (friendIds.length > 0) {
      const { data: users } = await admin
        .from('users')
        .select('id, username')
        .in('id', friendIds)
      friends = (users ?? []) as { id: string; username: string }[]
    }

    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav username={profile?.username} points={profile?.total_points ?? 0} activePage="challenges" userId={user.id} />

        <div className="max-w-3xl mx-auto px-8 py-10">
          <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            <Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link>
            <span>/</span>
            <span>New</span>
          </div>

          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
            New challenge
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
            Step 1 of 2 — pick a friend to challenge.
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
                style={{ background: 'var(--court)' }}
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
                  className="flex items-center justify-between px-5 py-4 border-b last:border-0 tournament-card"
                  style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                >
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>
                    {f.username}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--court)' }}>
                    Select →
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    )
  }

  // ── Step 2: pick a tournament ─────────────────────────────────────────────
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

  // Upcoming and accepting_predictions tournaments only
  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id, name, tour, category, surface, starts_at, ends_at, status')
    .in('status', ['upcoming', 'accepting_predictions'])
    .order('starts_at', { ascending: true })
    .limit(60)

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.total_points ?? 0} activePage="challenges" userId={user.id} />

      <div className="max-w-3xl mx-auto px-8 py-10">
        <div className="flex items-center gap-2 mb-6" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          <Link href="/challenges" style={{ color: 'var(--muted)' }}>Challenges</Link>
          <span>/</span>
          <Link href="/challenges/new" style={{ color: 'var(--muted)' }}>New</Link>
          <span>/</span>
          <span>{friendProfile?.username}</span>
        </div>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem' }}>
          Challenge {friendProfile?.username}
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Step 2 of 2 — pick a tournament.
        </p>

        {!tournaments || tournaments.length === 0 ? (
          <div className="bg-white rounded-sm border py-12 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No upcoming tournaments available right now.</p>
          </div>
        ) : (
          <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
            {tournaments.map((t: any) => (
              <form key={t.id} action={createChallenge}>
                <input type="hidden" name="friend_id" value={friendId} />
                <input type="hidden" name="tournament_id" value={t.id} />
                <button
                  type="submit"
                  className="w-full flex items-center justify-between px-5 py-4 border-b last:border-0 tournament-card text-left"
                  style={{ borderColor: 'var(--chalk-dim)', background: 'transparent', cursor: 'pointer' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>
                        {t.name}
                      </span>
                      {t.status === 'accepting_predictions' && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--court)', background: '#eaf3de', padding: '1px 5px', borderRadius: '2px', letterSpacing: '0.04em' }}>
                          OPEN
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                      {t.tour} · {SURFACE_LABELS[t.surface] ?? t.surface} · {formatDate(t.starts_at)}–{formatDate(t.ends_at)}
                    </div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--court)', flexShrink: 0, marginLeft: '1rem' }}>
                    Challenge →
                  </span>
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
