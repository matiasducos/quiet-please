import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { sendFriendRequest, acceptFriendRequest, declineFriendRequest } from '@/app/friends/actions'
import LocationEditForm from '@/app/profile/LocationEditForm'
import { COUNTRIES, codeToFlag } from '@/app/admin/countries'

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>
  searchParams: Promise<{ msg?: string; type?: string; edit?: string }>
}) {
  const { username } = await params
  const { msg, type, edit } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentProfile } = await supabase
    .from('users')
    .select('username, ranking_points')
    .eq('id', user.id)
    .single()

  const { data: profile } = await supabase
    .from('users')
    .select('id, username, total_points, ranking_points, atp_ranking_points, wta_ranking_points, country, city, created_at')
    .eq('username', username)
    .single()

  if (!profile) {
    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav username={currentProfile?.username} points={currentProfile?.ranking_points ?? 0} />
        <div className="max-w-5xl mx-auto px-8 py-20 text-center">
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '1rem' }}>404</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>Player not found</h1>
          <Link href="/leaderboard" style={{ color: 'var(--court)', fontSize: '0.9rem' }}>← Back to leaderboard</Link>
        </div>
      </main>
    )
  }

  // Global rank by ranking_points
  const { count: usersAhead } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gt('ranking_points', profile.ranking_points ?? 0)

  const globalRank = (usersAhead ?? 0) + 1

  // All global predictions with tournament info
  const { data: predictions } = await supabase
    .from('predictions')
    .select('id, points_earned, created_at, is_fully_locked, tournaments(id, name, tour, category, starts_at, status)')
    .eq('user_id', profile.id)
    .is('challenge_id', null)
    .order('created_at', { ascending: false })

  const tournamentsCount = predictions?.length ?? 0
  const hitRate = tournamentsCount > 0
    ? Math.round(((predictions?.filter(p => (p.points_earned ?? 0) > 0).length ?? 0) / tournamentsCount) * 100)
    : 0

  const isOwnProfile = user.id === profile.id
  const memberSince  = new Date(profile.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  // Admin detection — only relevant on own profile
  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const isDev    = process.env.NODE_ENV === 'development'
  const isAdmin  = isOwnProfile && (isDev || adminIds.includes(user.id))

  // Friendship status
  type FriendStatus = 'none' | 'friends' | 'sent' | 'received'
  let friendStatus: FriendStatus = 'none'
  let friendshipId: string | null = null

  if (!isOwnProfile) {
    const admin2 = createAdminClient()
    const { data: fs } = await admin2
      .from('friendships')
      .select('id, status, requester_id')
      .or(
        `and(requester_id.eq.${user.id},addressee_id.eq.${profile.id}),` +
        `and(requester_id.eq.${profile.id},addressee_id.eq.${user.id})`
      )
      .maybeSingle()

    if (fs) {
      friendshipId = fs.id
      if (fs.status === 'accepted') friendStatus = 'friends'
      else if (fs.status === 'pending') friendStatus = fs.requester_id === user.id ? 'sent' : 'received'
    }
  }

  // Challenges
  const admin = createAdminClient()
  const { data: rawChallenges } = await admin
    .from('challenges')
    .select('id, challenger_id, challenged_id, tournament_id, status, challenger_points, challenged_points, winner_id, created_at')
    .or(`challenger_id.eq.${profile.id},challenged_id.eq.${profile.id}`)
    .in('status', ['completed', 'accepted', 'pending'])
    .order('created_at', { ascending: false })
    .limit(10)

  const challengeOpponentIds = [...new Set(
    (rawChallenges ?? []).map(c => c.challenger_id === profile.id ? c.challenged_id : c.challenger_id)
  )]
  const challengeTournamentIds = [...new Set((rawChallenges ?? []).map(c => c.tournament_id))]

  let challengeOpponentNames: Record<string, string> = {}
  let challengeTournamentNames: Record<string, string> = {}

  const [oppRes, tRes] = await Promise.all([
    challengeOpponentIds.length > 0
      ? admin.from('users').select('id, username').in('id', challengeOpponentIds)
      : Promise.resolve({ data: [] as any[] }),
    challengeTournamentIds.length > 0
      ? admin.from('tournaments').select('id, name').in('id', challengeTournamentIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  challengeOpponentNames  = Object.fromEntries((oppRes.data ?? []).map((u: any) => [u.id, u.username]))
  challengeTournamentNames = Object.fromEntries((tRes.data ?? []).map((t: any) => [t.id, t.name]))

  const challenges = (rawChallenges ?? []).map(c => {
    const isProfileChallenger = c.challenger_id === profile.id
    const opponentId = isProfileChallenger ? c.challenged_id : c.challenger_id
    const myPts    = isProfileChallenger ? c.challenger_points : c.challenged_points
    const theirPts = isProfileChallenger ? c.challenged_points : c.challenger_points
    const won  = c.winner_id === profile.id
    const lost = c.status === 'completed' && c.winner_id !== null && !won
    const draw = c.status === 'completed' && c.winner_id === null
    return {
      id: c.id,
      opponentName: challengeOpponentNames[opponentId] ?? 'Unknown',
      tournamentName: challengeTournamentNames[c.tournament_id] ?? 'Unknown',
      status: c.status,
      myPts, theirPts, won, lost, draw,
    }
  })

  const showEditLocation = edit === 'location' && isOwnProfile

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={currentProfile?.username} points={currentProfile?.ranking_points ?? 0} userId={user.id} />

      <div className="max-w-5xl mx-auto px-8 py-10">

        {/* Message banner */}
        {msg && (
          <div
            className="rounded-sm px-4 py-3 mb-6 text-sm"
            style={{
              background: type === 'success' ? '#eaf3de' : '#fdecea',
              color: type === 'success' ? 'var(--court-dark)' : '#c84b31',
              fontFamily: 'var(--font-mono)',
              border: `1px solid ${type === 'success' ? '#c3dda8' : '#f5c0b8'}`,
            }}
          >
            {decodeURIComponent(msg)}
          </div>
        )}

        {/* Header */}
        <div className="mb-8">
          <Link href="/leaderboard" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.05em', textDecoration: 'none' }}>
            ← Leaderboard
          </Link>
          <div className="flex items-end justify-between mt-4">
            <div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                {profile.username}
                {isOwnProfile && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--court)', background: '#eaf3de', padding: '2px 8px', borderRadius: '2px', marginLeft: '0.75rem', verticalAlign: 'middle' }}>
                    you
                  </span>
                )}
                {isAdmin && (
                  <Link
                    href="/admin"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: '#fafaf8', padding: '2px 7px', border: '1px solid var(--chalk-dim)', borderRadius: '2px', marginLeft: '0.5rem', verticalAlign: 'middle', textDecoration: 'none', display: 'inline-block' }}
                  >
                    admin
                  </Link>
                )}
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.4rem', fontFamily: 'var(--font-mono)' }}>
                Member since {memberSince}
              </p>

              {/* Location display */}
              {(profile.country || profile.city) ? (
                <div className="flex items-center gap-2 mt-1.5">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                    {(() => {
                      const match = COUNTRIES.find(c => c.name === profile.country)
                      return match ? codeToFlag(match.code) : '📍'
                    })()} {[profile.city, profile.country].filter(Boolean).join(', ')}
                  </span>
                  {isOwnProfile && (
                    <Link
                      href={`/profile/${profile.username}?edit=location`}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', textDecoration: 'none' }}
                    >
                      edit
                    </Link>
                  )}
                </div>
              ) : isOwnProfile ? (
                <Link
                  href={`/profile/${profile.username}?edit=location`}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', textDecoration: 'none', display: 'inline-block', marginTop: '0.35rem' }}
                >
                  + Set your location
                </Link>
              ) : null}
            </div>

            {/* Friends link / Add friend / Status buttons */}
            {isOwnProfile && (
              <Link
                href="/friends"
                className="px-4 py-2 text-sm rounded-sm border hover:opacity-80"
                style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
              >
                Friends →
              </Link>
            )}

            {!isOwnProfile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {friendStatus === 'none' && (
                  <form action={sendFriendRequest}>
                    <input type="hidden" name="username" value={profile.username} />
                    <input type="hidden" name="return_to" value={`/profile/${profile.username}`} />
                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
                      + Add friend
                    </button>
                  </form>
                )}
                {friendStatus === 'sent' && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', padding: '8px 12px', border: '1px solid var(--chalk-dim)', borderRadius: '2px', background: 'white' }}>
                    Request sent
                  </span>
                )}
                {friendStatus === 'received' && (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <form action={acceptFriendRequest}>
                      <input type="hidden" name="friendship_id" value={friendshipId!} />
                      <input type="hidden" name="return_to" value={`/profile/${profile.username}`} />
                      <button type="submit" className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90" style={{ background: 'var(--court)' }}>
                        Accept request
                      </button>
                    </form>
                    <form action={declineFriendRequest}>
                      <input type="hidden" name="friendship_id" value={friendshipId!} />
                      <input type="hidden" name="return_to" value={`/profile/${profile.username}`} />
                      <button type="submit" className="px-4 py-2 text-sm rounded-sm border" style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}>
                        Decline
                      </button>
                    </form>
                  </div>
                )}
                {friendStatus === 'friends' && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--court)', padding: '8px 12px', border: '1px solid #c3dda8', borderRadius: '2px', background: '#eaf3de' }}>
                    Friends ✓
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Location edit form ────────────────────────────────────────────── */}
        {showEditLocation && (
          <LocationEditForm
            username={profile.username}
            defaultCountry={profile.country ?? null}
            defaultCity={profile.city ?? null}
          />
        )}

        {/* ── Stats grid ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {[
            { label: 'Ranking pts',  value: profile.ranking_points ?? 0,                         sub: '52-week rolling' },
            { label: 'Rank',         value: `#${globalRank}`,                                     sub: null },
            { label: 'Tournaments',  value: tournamentsCount,                                      sub: null },
            { label: 'Hit rate',     value: tournamentsCount > 0 ? `${hitRate}%` : '—',           sub: null },
          ].map((stat, i) => (
            <div key={i} className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                {stat.label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', letterSpacing: '-0.02em' }}>
                {stat.value}
              </div>
              {stat.sub && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                  {stat.sub}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Circuit breakdown — only shown when user has circuit-specific points */}
        {((profile.atp_ranking_points ?? 0) > 0 || (profile.wta_ranking_points ?? 0) > 0) && (
          <div className="flex gap-3 mb-8">
            {(profile.atp_ranking_points ?? 0) > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm border" style={{ borderColor: '#bee3f8', background: '#ebf8ff' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#185FA5' }}>ATP</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#185FA5', fontWeight: 600 }}>
                  {profile.atp_ranking_points}
                </span>
              </div>
            )}
            {(profile.wta_ranking_points ?? 0) > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm border" style={{ borderColor: '#fbb6ce', background: '#fff5f7' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#993556' }}>WTA</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#993556', fontWeight: 600 }}>
                  {profile.wta_ranking_points}
                </span>
              </div>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', alignSelf: 'center' }}>
              all-time: {profile.total_points ?? 0} pts
            </span>
          </div>
        )}

        {/* ── Predictions list ──────────────────────────────────────────────── */}
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
            Predictions
          </h2>

          {!predictions || predictions.length === 0 ? (
            <div className="bg-white rounded-sm border px-6 py-12 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--muted)' }}>No predictions yet</p>
              {isOwnProfile && (
                <Link href="/tournaments" style={{ fontSize: '0.85rem', color: 'var(--court)', marginTop: '0.5rem', display: 'inline-block' }}>
                  Browse tournaments →
                </Link>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
                <div className="col-span-5"  style={hStyle}>TOURNAMENT</div>
                <div className="col-span-2 text-center" style={hStyle}>TOUR</div>
                <div className="col-span-2 text-center" style={hStyle}>STATUS</div>
                <div className="col-span-3 text-right"  style={hStyle}>POINTS</div>
              </div>
              {predictions.map(p => {
                const t   = p.tournaments as any
                const pts = p.points_earned ?? 0
                const tStatus = t?.status as string | undefined
                const isInProgress = tStatus === 'in_progress'
                return (
                  <Link
                    key={p.id}
                    href={`/tournaments/${t?.id}`}
                    className="grid grid-cols-12 px-5 py-4 border-b last:border-0 tournament-card"
                    style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                  >
                    <div className="col-span-5 flex items-center gap-2">
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>
                        {t?.name ?? '—'}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-center">
                      <span className="px-2 py-0.5 text-xs rounded-sm" style={{
                        background: t?.tour === 'WTA' ? '#fbeaf0' : '#e6f1fb',
                        color:      t?.tour === 'WTA' ? '#993556' : '#185FA5',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {t?.tour ?? '—'}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-center">
                      {isInProgress ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: '#92400e', background: '#fef3c7', padding: '1px 6px', borderRadius: '2px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          Live
                        </span>
                      ) : tStatus === 'completed' ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: '#166534', background: '#dcfce7', padding: '1px 6px', borderRadius: '2px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          Done
                        </span>
                      ) : (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', background: 'var(--chalk)', padding: '1px 6px', borderRadius: '2px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          Pending
                        </span>
                      )}
                    </div>
                    <div className="col-span-3 flex items-center justify-end">
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.9rem',
                        color: pts > 0 ? 'var(--court)' : 'var(--muted)',
                        fontWeight: pts > 0 ? 500 : 400,
                      }}>
                        {pts > 0 ? `+${pts}` : '0'}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Challenges ────────────────────────────────────────────────────── */}
        {challenges.length > 0 && (
          <div className="mt-10">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
              Challenges
            </h2>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
                <div className="col-span-4" style={hStyle}>TOURNAMENT</div>
                <div className="col-span-3" style={hStyle}>OPPONENT</div>
                <div className="col-span-2 text-center" style={hStyle}>RESULT</div>
                <div className="col-span-3 text-right" style={hStyle}>SCORE</div>
              </div>
              {challenges.map(c => (
                <Link
                  key={c.id}
                  href={`/challenges/${c.id}`}
                  className="grid grid-cols-12 px-5 py-4 border-b last:border-0 tournament-card"
                  style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                >
                  <div className="col-span-4 flex items-center">
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--ink)' }}>
                      {c.tournamentName}
                    </span>
                  </div>
                  <div className="col-span-3 flex items-center">
                    <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{c.opponentName}</span>
                  </div>
                  <div className="col-span-2 flex items-center justify-center">
                    {c.status === 'completed' ? (
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em',
                        color: c.draw ? 'var(--muted)' : c.won ? 'var(--court)' : '#c84b31',
                      }}>
                        {c.draw ? 'DRAW' : c.won ? 'WIN' : 'LOSS'}
                      </span>
                    ) : (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>
                        {c.status === 'accepted' ? 'ACTIVE' : 'PENDING'}
                      </span>
                    )}
                  </div>
                  <div className="col-span-3 flex items-center justify-end">
                    {c.status === 'completed' ? (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--ink)' }}>
                        {c.myPts ?? 0} <span style={{ color: 'var(--muted)' }}>vs</span> {c.theirPts ?? 0}
                      </span>
                    ) : (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>—</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

const hStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  color: 'var(--muted)',
  letterSpacing: '0.05em',
}
