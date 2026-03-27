import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { sendFriendRequest, acceptFriendRequest, declineFriendRequest } from '@/app/friends/actions'
import LocationEditForm from '@/app/profile/LocationEditForm'
import UsernameEditForm from '@/app/profile/UsernameEditForm'
import { COUNTRIES } from '@/app/admin/countries'
import CountryFlag from '@/components/CountryFlag'
import TournamentCard from '@/components/TournamentCard'
import { getFriendActivity, timeAgo } from '@/lib/friends/activity'

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>
  searchParams: Promise<{ msg?: string; type?: string; edit?: string }>
}) {
  const { username } = await params
  const { msg, type, edit } = await searchParams
  const { user, profile: currentProfile } = await getNavProfile()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('id, username, total_points, ranking_points, atp_ranking_points, wta_ranking_points, country, city, created_at')
    .eq('username', username)
    .single()

  if (!profile) {
    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav username={currentProfile?.username} points={currentProfile?.ranking_points ?? 0} />
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-20 text-center">
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '1rem' }}>404</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>Player not found</h1>
          <Link href="/leaderboard" style={{ color: 'var(--court)', fontSize: '0.9rem' }}>← Back to leaderboard</Link>
        </div>
      </main>
    )
  }

  const isOwnProfile = user.id === profile.id
  const admin = createAdminClient()

  // ── Parallel fetch: rank, predictions (global + all for stats), friendship, challenges
  // RLS policy "Locked global predictions are publicly readable" (migration 030)
  // allows reading any user's locked predictions; own predictions readable via auth.uid()
  let predQuery = supabase
    .from('predictions')
    .select('id, points_earned, submitted_at, is_fully_locked, tournaments(id, name, tour, category, surface, starts_at, ends_at, status, location, flag_emoji)')
    .eq('user_id', profile.id)
    .is('challenge_id', null)

  if (!isOwnProfile) {
    predQuery = predQuery.eq('is_fully_locked', true)
  }

  const [{ count: usersAhead }, { data: predictions }, friendshipRes, { data: rawChallenges }, { data: rivalChallenges }] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).gt('ranking_points', profile.ranking_points ?? 0),
    predQuery.order('submitted_at', { ascending: false }),
    !isOwnProfile
      ? admin.from('friendships').select('id, status, requester_id')
          .or(`and(requester_id.eq.${user.id},addressee_id.eq.${profile.id}),and(requester_id.eq.${profile.id},addressee_id.eq.${user.id})`)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
    admin.from('challenges')
      .select('id, challenger_id, challenged_id, tournament_id, status, challenger_points, challenged_points, winner_id, created_at')
      .or(`challenger_id.eq.${profile.id},challenged_id.eq.${profile.id}`)
      .in('status', ['completed', 'accepted', 'pending'])
      .order('created_at', { ascending: false })
      .limit(10),
    // All completed non-anonymous challenges — used for head-to-head rivalry stats (no limit)
    admin.from('challenges')
      .select('challenger_id, challenged_id, winner_id')
      .or(`challenger_id.eq.${profile.id},challenged_id.eq.${profile.id}`)
      .eq('status', 'completed')
      .eq('is_anonymous', false),
  ])

  const globalRank = (usersAhead ?? 0) + 1

  const completedPredCount = predictions?.filter(p => (p.tournaments as any)?.status === 'completed').length ?? 0
  const memberSince  = new Date(profile.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const isDev    = process.env.NODE_ENV === 'development'
  const isAdmin  = isOwnProfile && (isDev || adminIds.includes(user.id))

  // Friend activity — only fetched when viewing your own profile
  const friendActivityItems = isOwnProfile ? await getFriendActivity(user.id, 5) : []

  type FriendStatus = 'none' | 'friends' | 'sent' | 'received'
  let friendStatus: FriendStatus = 'none'
  let friendshipId: string | null = null

  const fs = friendshipRes.data
  if (fs) {
    friendshipId = fs.id
    if (fs.status === 'accepted') friendStatus = 'friends'
    else if (fs.status === 'pending') friendStatus = fs.requester_id === user.id ? 'sent' : 'received'
  }

  const challengeOpponentIds = [...new Set([
    ...(rawChallenges ?? []).map(c => c.challenger_id === profile.id ? c.challenged_id : c.challenger_id),
    // Include rivals so one username fetch covers both sections
    ...(rivalChallenges ?? []).map((c: any) => c.challenger_id === profile.id ? c.challenged_id : c.challenger_id),
  ])]
  const challengeTournamentIds = [...new Set((rawChallenges ?? []).map(c => c.tournament_id))]

  let challengeOpponentNames: Record<string, string> = {}

  const [oppRes, tRes] = await Promise.all([
    challengeOpponentIds.length > 0
      ? admin.from('users').select('id, username').in('id', challengeOpponentIds)
      : Promise.resolve({ data: [] as any[] }),
    challengeTournamentIds.length > 0
      ? admin.from('tournaments').select('id, name, location, flag_emoji').in('id', challengeTournamentIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  challengeOpponentNames  = Object.fromEntries((oppRes.data ?? []).map((u: any) => [u.id, u.username]))
  const challengeTournamentData: Record<string, { name: string; flag: string | null }> = {}
  for (const t of (tRes.data ?? []) as any[]) {
    challengeTournamentData[t.id] = { name: t.location ?? t.name, flag: t.flag_emoji ?? null }
  }

  const challenges = (rawChallenges ?? []).map(c => {
    const isProfileChallenger = c.challenger_id === profile.id
    const opponentId = isProfileChallenger ? c.challenged_id : c.challenger_id
    const myPts    = isProfileChallenger ? c.challenger_points : c.challenged_points
    const theirPts = isProfileChallenger ? c.challenged_points : c.challenger_points
    const won  = c.winner_id === profile.id
    const lost = c.status === 'completed' && c.winner_id !== null && !won
    const draw = c.status === 'completed' && c.winner_id === null
    const td = challengeTournamentData[c.tournament_id]
    return {
      id: c.id,
      opponentName: challengeOpponentNames[opponentId] ?? 'Unknown',
      tournamentName: td?.name ?? 'Unknown',
      tournamentFlag: td?.flag ?? null,
      status: c.status,
      myPts, theirPts, won, lost, draw,
    }
  })

  const ongoingChallengeCount = challenges.filter(c => c.status === 'accepted').length

  // ── Head-to-head rivalry stats ──────────────────────────────────────────
  // Group completed non-anonymous challenges by opponent, count W/L/D
  type RivalryStat = { opponentId: string; username: string; wins: number; losses: number; draws: number; total: number }
  const rivalryMap = new Map<string, RivalryStat>()
  for (const c of (rivalChallenges ?? []) as any[]) {
    const opponentId = c.challenger_id === profile.id ? c.challenged_id : c.challenger_id
    const username = challengeOpponentNames[opponentId] ?? 'Unknown'
    const won  = c.winner_id === profile.id
    const lost = c.winner_id !== null && c.winner_id !== profile.id
    const draw = c.winner_id === null
    const existing = rivalryMap.get(opponentId)
    if (existing) {
      if (won) existing.wins++
      else if (lost) existing.losses++
      else if (draw) existing.draws++
      existing.total++
    } else {
      rivalryMap.set(opponentId, { opponentId, username, wins: won ? 1 : 0, losses: lost ? 1 : 0, draws: draw ? 1 : 0, total: 1 })
    }
  }
  // Sort by most games played, then by wins as tiebreaker. Cap display at 10 rivals.
  const rivalryStats = Array.from(rivalryMap.values())
    .sort((a, b) => b.total - a.total || b.wins - a.wins)
    .slice(0, 10)

  const showEditLocation = edit === 'location' && isOwnProfile
  const showEditUsername = edit === 'username' && isOwnProfile

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={currentProfile?.username} points={currentProfile?.ranking_points ?? 0} userId={user.id} />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">

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
                  <>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#1e4e8c', background: '#dbeafe', padding: '2px 8px', borderRadius: '2px', marginLeft: '0.75rem', verticalAlign: 'middle' }}>
                      you
                    </span>
                    <Link
                      href={`/profile/${profile.username}?edit=username`}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', marginLeft: '0.5rem', verticalAlign: 'middle', textDecoration: 'none' }}
                    >
                      edit
                    </Link>
                  </>
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
                  <span className="flex items-center gap-1.5" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                    {profile.country ? <CountryFlag country={profile.country} size={14} /> : <span>📍</span>}
                    {[profile.city, profile.country].filter(Boolean).join(', ')}
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
              ) : null}
            </div>

            {/* Friends + Auto-Predictions links */}
            {isOwnProfile && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Link
                  href="/friends"
                  className="px-4 py-2 text-sm rounded-sm border hover:opacity-80"
                  style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                >
                  Friends →
                </Link>
                <Link
                  href="/profile/auto-predictions"
                  className="px-4 py-2 text-sm rounded-sm border hover:opacity-80"
                  style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                >
                  Auto-Predictions →
                </Link>
              </div>
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

        {/* ── Username edit form ───────────────────────────────────────────── */}
        {showEditUsername && (
          <UsernameEditForm username={profile.username} />
        )}

        {/* ── Location edit form ────────────────────────────────────────────── */}
        {showEditLocation && (
          <LocationEditForm
            username={profile.username}
            defaultCountry={profile.country ?? null}
            defaultCity={profile.city ?? null}
          />
        )}

        {/* ── Location nudge ─────────────────────────────────────────────── */}
        {isOwnProfile && !profile.country && !showEditLocation && (
          <Link
            href={`/profile/${profile.username}?edit=location`}
            className="flex items-center gap-3 mb-8 px-5 py-4 rounded-sm border"
            style={{ background: '#fefcf3', borderColor: '#e8dfc0', textDecoration: 'none' }}
          >
            <span style={{ fontSize: '1.25rem' }}>📍</span>
            <div>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', color: 'var(--ink)', marginBottom: '2px' }}>
                Set up your location
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.03em' }}>
                Unlock Country &amp; City leaderboards and compete locally
              </p>
            </div>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--court)', fontWeight: 500, flexShrink: 0 }}>
              Set up →
            </span>
          </Link>
        )}

        {/* ── Stats grid ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {[
            { label: 'Ranking pts',          value: profile.ranking_points ?? 0,   sub: '52-week rolling' },
            { label: 'Rank',                 value: `#${globalRank}`,              sub: null },
            { label: 'Completed',            value: completedPredCount,            sub: 'tournaments' },
            { label: 'Ongoing challenges',   value: ongoingChallengeCount,         sub: ongoingChallengeCount > 0 ? 'active' : null },
          ].map((stat, i) => (
            <div key={i} className="bg-white rounded-sm border p-5 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
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

        {/* Circuit breakdown — always shown */}
        <div className="flex flex-wrap gap-3 mb-8">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm border" style={{ borderColor: '#bee3f8', background: '#ebf8ff' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#185FA5' }}>ATP</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#185FA5', fontWeight: 600 }}>
              {profile.atp_ranking_points ?? 0}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: '#185FA5', opacity: 0.6 }}>52w</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm border" style={{ borderColor: '#fbb6ce', background: '#fff5f7' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#993556' }}>WTA</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#993556', fontWeight: 600 }}>
              {profile.wta_ranking_points ?? 0}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: '#993556', opacity: 0.6 }}>52w</span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', alignSelf: 'center' }}>
            lifetime: {profile.total_points ?? 0} pts
          </span>
        </div>

        {/* ── Active predictions (in-progress tournaments) ────────────────── */}
        {(() => {
          const activePreds = (predictions ?? []).filter(p => {
            const t = p.tournaments as any
            return t?.status === 'in_progress' || t?.status === 'accepting_predictions'
          })
          const pastPreds = (predictions ?? []).filter(p => {
            const t = p.tournaments as any
            return t?.status === 'completed'
          })

          return (
            <>
              {activePreds.length > 0 && (
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
                    Active predictions
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activePreds.map(p => {
                      const t = p.tournaments as any
                      return (
                        <TournamentCard key={p.id} t={{
                          id: t.id, name: t.name, tour: t.tour, category: t.category,
                          surface: t.surface, starts_at: t.starts_at, ends_at: t.ends_at,
                          status: t.status, location: t.location, flag_emoji: t.flag_emoji,
                        }} />
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Past predictions (completed tournaments) */}
              {pastPreds.length > 0 && (
                <div className={activePreds.length > 0 ? 'mt-10' : ''}>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
                    Past predictions
                  </h2>
                  <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
                    <div className="overflow-x-auto">
                    <div className="min-w-[400px]">
                    <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
                      <div className="col-span-7"  style={hStyle}>TOURNAMENT</div>
                      <div className="col-span-5 text-right"  style={hStyle}>POINTS</div>
                    </div>
                    {pastPreds.map(p => {
                      const t = p.tournaments as any
                      const pts = p.points_earned ?? 0
                      return (
                        <Link
                          key={p.id}
                          href={`/tournaments/${t?.id}`}
                          className="grid grid-cols-12 px-5 py-4 border-b last:border-0 tournament-card"
                          style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                        >
                          <div className="col-span-7 flex items-center gap-2">
                            {t?.flag_emoji && <span>{t.flag_emoji}</span>}
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>
                              {t?.location ?? t?.name ?? '—'}
                            </span>
                          </div>
                          <div className="col-span-5 flex items-center justify-end">
                            <span style={{
                              fontFamily: 'var(--font-mono)', fontSize: '0.9rem',
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
                  </div>
                  </div>
                </div>
              )}

              {activePreds.length === 0 && pastPreds.length === 0 && (
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
                    Predictions
                  </h2>
                  <div className="bg-white rounded-sm border px-6 py-12 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--muted)' }}>No predictions yet</p>
                    {isOwnProfile && (
                      <Link href="/tournaments" style={{ fontSize: '0.85rem', color: 'var(--court)', marginTop: '0.5rem', display: 'inline-block' }}>
                        Browse tournaments →
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </>
          )
        })()}

        {/* ── Head-to-head ──────────────────────────────────────────────────── */}
        {rivalryStats.length > 0 && (
          <div className="mt-10">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
              Head-to-head
            </h2>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="overflow-x-auto">
              <div className="min-w-[360px]">
              <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
                <div className="col-span-6" style={hStyle}>OPPONENT</div>
                <div className="col-span-2 text-center" style={hStyle}>W</div>
                <div className="col-span-2 text-center" style={hStyle}>L</div>
                <div className="col-span-2 text-right" style={hStyle}>PLAYED</div>
              </div>
              {rivalryStats.map(r => (
                <Link
                  key={r.opponentId}
                  href={`/profile/${r.username}`}
                  className="grid grid-cols-12 px-5 py-4 border-b last:border-0 tournament-card"
                  style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                >
                  <div className="col-span-6 flex items-center">
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', color: 'var(--ink)' }}>
                      {r.username}
                    </span>
                  </div>
                  <div className="col-span-2 flex items-center justify-center">
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.9rem',
                      color: r.wins > r.losses ? 'var(--court)' : 'var(--ink)',
                      fontWeight: r.wins > r.losses ? 600 : 400,
                    }}>
                      {r.wins}
                    </span>
                  </div>
                  <div className="col-span-2 flex items-center justify-center">
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.9rem',
                      color: r.losses > r.wins ? '#c84b31' : 'var(--muted)',
                      fontWeight: r.losses > r.wins ? 600 : 400,
                    }}>
                      {r.losses}
                    </span>
                  </div>
                  <div className="col-span-2 flex items-center justify-end">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      {r.total}
                    </span>
                  </div>
                </Link>
              ))}
              </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Ongoing Challenges ────────────────────────────────────────────── */}
        {(() => {
          const ongoingChallenges = challenges.filter(c => c.status === 'accepted' || c.status === 'pending')
          if (ongoingChallenges.length === 0) return null
          return (
            <div className="mt-10" id="challenges">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
                Challenges
              </h2>
              <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
                <div className="overflow-x-auto">
                <div className="min-w-[500px]">
                <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
                  <div className="col-span-5" style={hStyle}>TOURNAMENT</div>
                  <div className="col-span-4" style={hStyle}>OPPONENT</div>
                  <div className="col-span-3 text-right" style={hStyle}>STATUS</div>
                </div>
                {ongoingChallenges.map(c => (
                  <Link
                    key={c.id}
                    href={`/challenges/${c.id}`}
                    className="grid grid-cols-12 px-5 py-4 border-b last:border-0 tournament-card"
                    style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                  >
                    <div className="col-span-5 flex items-center gap-2">
                      {c.tournamentFlag && <span>{c.tournamentFlag}</span>}
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--ink)' }}>
                        {c.tournamentName}
                      </span>
                    </div>
                    <div className="col-span-4 flex items-center">
                      <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{c.opponentName}</span>
                    </div>
                    <div className="col-span-3 flex items-center justify-end">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: c.status === 'accepted' ? 'var(--court)' : 'var(--muted)', letterSpacing: '0.04em' }}>
                        {c.status === 'accepted' ? 'ACTIVE' : 'PENDING'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
              </div>
              </div>
            </div>
          )
        })()}

        {/* ── Friend activity (own profile only) ────────────────────────────── */}
        {isOwnProfile && friendActivityItems.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em' }}>Friend activity</h2>
              <Link href="/friends" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>See all friend activity →</Link>
            </div>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {friendActivityItems.map((item, i) => {
                const icon = item.type === 'picks' ? '🔒' : item.type === 'points' ? '⭐' : '👥'
                return (
                  <div
                    key={`${item.type}-${item.user_id}-${item.date}-${i}`}
                    className="flex items-center gap-3 px-5 py-3 border-b last:border-0"
                    style={{ borderColor: 'var(--chalk-dim)' }}
                  >
                    <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="truncate">
                        <Link href={`/profile/${item.username}`} style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--ink)', textDecoration: 'none' }}>
                          {item.username}
                        </Link>
                        {item.href ? (
                          <Link href={item.href} style={{ fontSize: '0.875rem', color: 'var(--muted)', textDecoration: 'none' }}>
                            {' '}{item.label}
                          </Link>
                        ) : (
                          <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>{' '}{item.label}</span>
                        )}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', flexShrink: 0 }}>
                      {timeAgo(item.date)}
                    </span>
                  </div>
                )
              })}
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
