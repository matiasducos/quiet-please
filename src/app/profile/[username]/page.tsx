import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { sendFriendRequest, acceptFriendRequest, declineFriendRequest } from '@/app/friends/actions'
import { AcceptRequestButton } from '@/app/friends/FriendActionButton'
import LocationEditForm from '@/app/profile/LocationEditForm'
import UsernameEditForm from '@/app/profile/UsernameEditForm'
import { formatPoints } from '@/lib/utils/format'
import CountryFlag from '@/components/CountryFlag'
import EmailPrefsToggle from '@/app/profile/EmailPrefsToggle'
import { resolvePreferences } from '@/lib/email-preferences'
import ReplayTourButton from '@/components/ReplayTourButton'
import { getFriendActivity, timeAgo } from '@/lib/friends/activity'
import AchievementsTab from './AchievementsTab'
import Footer from '@/components/Footer'
import DeleteAccountSection from '@/app/profile/DeleteAccountSection'

// Internal ledger round → "form" letter + color class. "F" in the ledger is
// the tournament winner (cron awards WINNER_POINTS on F), so a correct F pick
// shows as a "W" — the user's predicted player became champion.
const ROUND_RANK: Record<string, number> = { R128: 1, R64: 2, R32: 3, R16: 4, QF: 5, SF: 6, F: 7 }
const FORM_FROM_ROUND: Record<string, { letter: string; cls: string }> = {
  F:    { letter: 'W',   cls: 'w' },
  SF:   { letter: 'F',   cls: 'f' },
  QF:   { letter: 'SF',  cls: 's' },
  R16:  { letter: 'QF',  cls: 'q' },
  R32:  { letter: 'R16', cls: 'q' },
  R64:  { letter: 'R32', cls: 'x' },
  R128: { letter: 'R64', cls: 'x' },
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>
  searchParams: Promise<{ msg?: string; type?: string; edit?: string; tab?: string; sub?: string }>
}) {
  const { username } = await params
  const { msg, type, edit, tab, sub } = await searchParams
  const activeTab = tab === 'achievements' ? 'achievements' : 'overview'
  const activeSubTab: 'tournaments' | 'challenges' | 'rivals' =
    sub === 'challenges' ? 'challenges' : sub === 'rivals' ? 'rivals' : 'tournaments'
  const { user, profile: currentProfile } = await getNavProfile()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('id, username, total_points, ranking_points, atp_ranking_points, wta_ranking_points, country, city, created_at, email_notifications, email_preferences, deletion_requested_at')
    .eq('username', username)
    .single()

  if (!profile) {
    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav deletionRequestedAt={currentProfile?.deletion_requested_at} username={currentProfile?.username} points={currentProfile?.ranking_points ?? 0} />
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-20 text-center">
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '1rem' }}>404</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '1.5rem' }}>Player not found</h1>
          <Link href="/leaderboard" style={{ color: 'var(--court)', fontSize: '0.9rem' }}>← Back to leaderboard</Link>
        </div>
        <Footer />
      </main>
    )
  }

  const isOwnProfile = user.id === profile.id
  const admin = createAdminClient()

  // ── Parallel fetch: rank, predictions, friendship, challenges, rivalry, streak, wins
  let predQuery = supabase
    .from('predictions')
    .select('id, points_earned, submitted_at, is_fully_locked, tournaments(id, name, tour, category, surface, starts_at, ends_at, status, location, flag_emoji)')
    .eq('user_id', profile.id)
    .is('challenge_id', null)

  if (!isOwnProfile) {
    predQuery = predQuery.eq('is_fully_locked', true)
  }

  const [
    { count: usersAhead },
    { data: predictions },
    friendshipRes,
    { data: rawChallenges },
    { data: rivalChallenges },
    { data: streakRow },
    { count: tournamentsWonCount },
  ] = await Promise.all([
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
    admin.from('challenges')
      .select('challenger_id, challenged_id, winner_id')
      .or(`challenger_id.eq.${profile.id},challenged_id.eq.${profile.id}`)
      .eq('status', 'completed')
      .eq('is_anonymous', false),
    admin.from('point_ledger')
      .select('streak_multiplier')
      .eq('user_id', profile.id)
      .order('streak_multiplier', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('point_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('round', 'F'),
  ])

  const globalRank        = (usersAhead ?? 0) + 1
  const totalPredictions  = predictions?.length ?? 0
  const completedPredCount = predictions?.filter(p => (p.tournaments as any)?.status === 'completed').length ?? 0
  const memberSince       = new Date(profile.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const tournamentsWon    = tournamentsWonCount ?? 0
  const bestStreak        = Math.max(0, (streakRow?.streak_multiplier ?? 1) - 1)

  const friendActivityItems = isOwnProfile ? await getFriendActivity(user.id, 5) : []

  // Achievements — count always, rows only when tab active
  const [{ data: achievementsData }, { count: achievementCount }, { data: preview }] = await Promise.all([
    activeTab === 'achievements'
      ? admin.from('user_achievements').select('achievement_key, tournament_id, meta, earned_at').eq('user_id', profile.id).order('earned_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    admin.from('user_achievements').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
    // Top 3 most recent achievements for overview preview card
    activeTab === 'overview'
      ? admin.from('user_achievements').select('achievement_key, meta, earned_at').eq('user_id', profile.id).order('earned_at', { ascending: false }).limit(3)
      : Promise.resolve({ data: [] as any[] }),
  ])

  type FriendStatus = 'none' | 'friends' | 'sent' | 'received'
  let friendStatus: FriendStatus = 'none'
  let friendshipId: string | null = null

  const fs = friendshipRes.data
  if (fs) {
    friendshipId = fs.id
    if (fs.status === 'accepted') friendStatus = 'friends'
    else if (fs.status === 'pending') friendStatus = fs.requester_id === user.id ? 'sent' : 'received'
  }

  // ── Opponent + tournament name maps (for challenges + rivals) ─────────────
  const challengeOpponentIds = [...new Set([
    ...(rawChallenges ?? []).map(c => c.challenger_id === profile.id ? c.challenged_id : c.challenger_id),
    ...(rivalChallenges ?? []).map((c: any) => c.challenger_id === profile.id ? c.challenged_id : c.challenger_id),
  ])]
  const challengeTournamentIds = [...new Set((rawChallenges ?? []).map(c => c.tournament_id))]

  // ── Recent form: last 6 completed predictions, deepest round reached ────
  const completedPreds = (predictions ?? []).filter(p => (p.tournaments as any)?.status === 'completed')
  const recentCompletedPreds = completedPreds.slice(0, 6)
  const recentPredIds = recentCompletedPreds.map(p => p.id)

  const [oppRes, tRes, { data: recentLedger }] = await Promise.all([
    challengeOpponentIds.length > 0
      ? admin.from('users').select('id, username').in('id', challengeOpponentIds)
      : Promise.resolve({ data: [] as any[] }),
    challengeTournamentIds.length > 0
      ? admin.from('tournaments').select('id, name, location, flag_emoji').in('id', challengeTournamentIds)
      : Promise.resolve({ data: [] as any[] }),
    recentPredIds.length > 0
      ? admin.from('point_ledger').select('prediction_id, round').in('prediction_id', recentPredIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const challengeOpponentNames: Record<string, string> = Object.fromEntries((oppRes.data ?? []).map((u: any) => [u.id, u.username]))
  const challengeTournamentData: Record<string, { name: string; flag: string | null }> = {}
  for (const t of (tRes.data ?? []) as any[]) {
    challengeTournamentData[t.id] = { name: t.location ?? t.name, flag: t.flag_emoji ?? null }
  }

  const maxRoundByPred: Record<string, string> = {}
  for (const row of (recentLedger ?? []) as any[]) {
    const existing = maxRoundByPred[row.prediction_id]
    if (!existing || ROUND_RANK[row.round] > ROUND_RANK[existing]) {
      maxRoundByPred[row.prediction_id] = row.round
    }
  }

  const recentForm = recentCompletedPreds.map(p => {
    const t = p.tournaments as any
    const round = maxRoundByPred[p.id]
    const form = round ? FORM_FROM_ROUND[round] : { letter: '—', cls: 'x' }
    return {
      predId: p.id,
      tournamentId: t?.id,
      tournamentName: t?.location ?? t?.name ?? '—',
      letter: form.letter,
      cls: form.cls,
    }
  })

  // ── Challenges: normalized for display ────────────────────────────────────
  const challenges = (rawChallenges ?? []).map(c => {
    const isProfileChallenger = c.challenger_id === profile.id
    const opponentId = isProfileChallenger ? c.challenged_id : c.challenger_id
    const myPts    = isProfileChallenger ? c.challenger_points : c.challenged_points
    const theirPts = isProfileChallenger ? c.challenged_points : c.challenger_points
    const won  = c.winner_id === profile.id
    const lost = c.status === 'completed' && c.winner_id !== null && !won
    const drw  = c.status === 'completed' && c.winner_id === null
    const td = challengeTournamentData[c.tournament_id]
    return {
      id: c.id,
      opponentName:  challengeOpponentNames[opponentId] ?? 'Unknown',
      tournamentName: td?.name ?? 'Unknown',
      tournamentFlag: td?.flag ?? null,
      status: c.status,
      myPts, theirPts, won, lost, drw,
    }
  })
  const ongoingChallengeCount = challenges.filter(c => c.status === 'accepted' || c.status === 'pending').length

  // ── Head-to-head rivalry stats ──────────────────────────────────────────
  type RivalryStat = { opponentId: string; username: string; wins: number; losses: number; draws: number; total: number }
  const rivalryMap = new Map<string, RivalryStat>()
  for (const c of (rivalChallenges ?? []) as any[]) {
    const opponentId = c.challenger_id === profile.id ? c.challenged_id : c.challenger_id
    const uname = challengeOpponentNames[opponentId] ?? 'Unknown'
    const won  = c.winner_id === profile.id
    const lost = c.winner_id !== null && c.winner_id !== profile.id
    const drw  = c.winner_id === null
    const existing = rivalryMap.get(opponentId)
    if (existing) {
      if (won) existing.wins++
      else if (lost) existing.losses++
      else if (drw) existing.draws++
      existing.total++
    } else {
      rivalryMap.set(opponentId, { opponentId, username: uname, wins: won ? 1 : 0, losses: lost ? 1 : 0, draws: drw ? 1 : 0, total: 1 })
    }
  }
  const rivalryStats = Array.from(rivalryMap.values())
    .sort((a, b) => b.total - a.total || b.wins - a.wins)
    .slice(0, 10)

  const h2hTotal = (rivalChallenges ?? []).length
  const h2hWins  = (rivalChallenges ?? []).filter((c: any) => c.winner_id === profile.id).length
  const h2hLoss  = (rivalChallenges ?? []).filter((c: any) => c.winner_id !== null && c.winner_id !== profile.id).length
  const h2hRate  = h2hTotal > 0 ? Math.round((h2hWins / h2hTotal) * 100) : null

  const activePredsCount = (predictions ?? []).filter(p => {
    const t = p.tournaments as any
    return t?.status === 'in_progress' || t?.status === 'accepting_predictions'
  }).length

  // ── Hero theming based on dominant circuit ──────────────────────────────
  const atpPts = profile.atp_ranking_points ?? 0
  const wtaPts = profile.wta_ranking_points ?? 0
  const dominant: 'ATP' | 'WTA' | 'NONE' =
    atpPts === 0 && wtaPts === 0 ? 'NONE' : atpPts >= wtaPts ? 'ATP' : 'WTA'
  const heroGradient =
    dominant === 'ATP' ? 'linear-gradient(135deg,#1a3a5f 0%,#15304d 50%,#102238 100%)' :
    dominant === 'WTA' ? 'linear-gradient(135deg,#4a1a4a 0%,#3d1540 50%,#2d0f2d 100%)' :
                         'linear-gradient(135deg,#1e5a40 0%,#174830 50%,#0f2d1e 100%)'
  const circuitPillBg = dominant === 'ATP' ? '#185FA5' : dominant === 'WTA' ? '#7c2d7c' : '#1e7a5e'

  const showEditLocation = edit === 'location' && isOwnProfile
  const showEditUsername = edit === 'username' && isOwnProfile

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={currentProfile?.deletion_requested_at} username={currentProfile?.username} points={currentProfile?.ranking_points ?? 0} userId={user.id} activePage={activeTab === 'achievements' ? 'achievements' : undefined} />

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

        <Link href="/leaderboard" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.05em', textDecoration: 'none', display: 'inline-block', marginBottom: '16px' }}>
          ← Leaderboard
        </Link>

        {/* ── Hero card ─────────────────────────────────────────────────────── */}
        <div
          className="rounded-sm overflow-hidden mb-6"
          style={{ background: heroGradient, color: '#fff', border: '1px solid var(--chalk-dim)', position: 'relative' }}
        >
          {/* Dot pattern backdrop */}
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0, opacity: 0.06, pointerEvents: 'none',
              backgroundImage: 'radial-gradient(circle at 20% 30%, #fff 1px, transparent 1px), radial-gradient(circle at 80% 70%, #fff 1px, transparent 1px)',
              backgroundSize: '60px 60px',
            }}
          />

          {/* Top strip */}
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid rgba(255,255,255,0.08)', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            <span>Player file</span>
            {dominant !== 'NONE' && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.55)' }}>Dominant circuit</span>
                <span style={{ padding: '2px 9px', borderRadius: '2px', background: circuitPillBg, color: '#fff' }}>{dominant}</span>
              </div>
            )}
          </div>

          {/* Body */}
          <div
            className="hero-body"
            style={{
              position: 'relative', display: 'grid', gridTemplateColumns: '1fr', gap: '24px', padding: '24px 20px',
            }}
          >
            {/* Left: rank + points */}
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(4rem, 12vw, 6.5rem)', lineHeight: 0.9, letterSpacing: '-0.04em', color: '#fff' }}>
                #{globalRank}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.18em', color: 'rgba(255,255,255,0.55)', marginTop: '6px', textTransform: 'uppercase' }}>
                World rank
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', color: '#fff', marginTop: '18px', letterSpacing: '-0.02em' }}>
                {formatPoints(profile.ranking_points ?? 0)} pts
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.55)', marginTop: '2px', textTransform: 'uppercase' }}>
                Ranking · 52-week rolling
              </div>
            </div>

            {/* Right: identity */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
                <div
                  style={{
                    width: '68px', height: '68px', borderRadius: '50%',
                    background: 'linear-gradient(135deg,#fff 0%, #c3dda8 100%)',
                    color: '#1a3a5f', fontFamily: 'var(--font-display)', fontSize: '2rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '3px solid rgba(255,255,255,0.3)', flexShrink: 0,
                  }}
                >
                  {profile.username.charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.6rem, 5vw, 2.4rem)', letterSpacing: '-0.02em', lineHeight: 1.05, color: '#fff', wordBreak: 'break-word' }}>
                    {profile.username}
                    {isOwnProfile && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', background: '#eaf3de', color: 'var(--court)', padding: '2px 8px', borderRadius: '2px', letterSpacing: '0.1em', marginLeft: '10px', textTransform: 'uppercase', verticalAlign: 'middle' }}>
                        You
                      </span>
                    )}
                  </h1>
                  {isOwnProfile && (
                    <Link
                      href={`/profile/${profile.username}?edit=username`}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'rgba(255,255,255,0.55)', textDecoration: 'none', letterSpacing: '0.05em' }}
                    >
                      edit username →
                    </Link>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'rgba(255,255,255,0.75)' }}>
                {(profile.country || profile.city) ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {profile.country ? <CountryFlag country={profile.country} size={14} /> : <span>📍</span>}
                    <span>{[profile.city, profile.country].filter(Boolean).join(', ')}</span>
                    {isOwnProfile && (
                      <Link
                        href={`/profile/${profile.username}?edit=location`}
                        style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.5)', textDecoration: 'none', letterSpacing: '0.04em' }}
                      >
                        edit
                      </Link>
                    )}
                  </div>
                ) : isOwnProfile ? (
                  <Link
                    href={`/profile/${profile.username}?edit=location`}
                    style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none' }}
                  >
                    📍 Set your location
                  </Link>
                ) : null}
                <div>📅 Member since {memberSince}</div>
                {(tournamentsWon > 0 || totalPredictions > 0) && (
                  <div>🏆 {tournamentsWon} won · {totalPredictions} predicted</div>
                )}
              </div>

              {/* Hero actions */}
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {isOwnProfile ? (
                  <>
                    <Link href="/friends" style={heroBtnStyle}>Friends</Link>
                    <Link href="/profile/auto-predictions" style={heroBtnStyle}>Auto-predictions</Link>
                    <ReplayTourButton />
                  </>
                ) : (
                  <>
                    {friendStatus === 'none' && (
                      <form action={sendFriendRequest}>
                        <input type="hidden" name="username" value={profile.username} />
                        <input type="hidden" name="return_to" value={`/profile/${profile.username}`} />
                        <button type="submit" style={{ ...heroBtnStyle, background: 'var(--court)', borderColor: 'var(--court)', color: '#fff', cursor: 'pointer' }}>
                          + Add friend
                        </button>
                      </form>
                    )}
                    {friendStatus === 'sent' && (
                      <span style={{ ...heroBtnStyle, cursor: 'default' }}>Request sent</span>
                    )}
                    {friendStatus === 'received' && (
                      <>
                        <form action={acceptFriendRequest}>
                          <input type="hidden" name="friendship_id" value={friendshipId!} />
                          <input type="hidden" name="return_to" value={`/profile/${profile.username}`} />
                          <AcceptRequestButton />
                        </form>
                        <form action={declineFriendRequest}>
                          <input type="hidden" name="friendship_id" value={friendshipId!} />
                          <input type="hidden" name="return_to" value={`/profile/${profile.username}`} />
                          <button type="submit" style={{ ...heroBtnStyle, cursor: 'pointer' }}>Decline</button>
                        </form>
                      </>
                    )}
                    {friendStatus === 'friends' && (
                      <span style={{ ...heroBtnStyle, background: 'rgba(195,221,168,0.2)', borderColor: 'rgba(195,221,168,0.4)', cursor: 'default' }}>Friends ✓</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Tour strip */}
          <div
            className="tour-strip"
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div style={tourCellStyle}>
              <div style={{ ...tourLblStyle, color: '#8fb8e0' }}>ATP circuit</div>
              <div style={tourValStyle}>{formatPoints(atpPts)} pts</div>
            </div>
            <div style={tourCellStyle}>
              <div style={{ ...tourLblStyle, color: '#e0b0d0' }}>WTA circuit</div>
              <div style={tourValStyle}>{formatPoints(wtaPts)} pts</div>
            </div>
            <div style={tourCellStyle}>
              <div style={tourLblStyle}>Lifetime</div>
              <div style={tourValStyle}>{formatPoints(profile.total_points ?? 0)} pts</div>
            </div>
          </div>
        </div>

        {/* Edit forms */}
        {showEditUsername && <UsernameEditForm username={profile.username} />}
        {showEditLocation && (
          <LocationEditForm
            username={profile.username}
            defaultCountry={profile.country ?? null}
            defaultCity={profile.city ?? null}
          />
        )}

        {/* Location nudge */}
        {isOwnProfile && !profile.country && !showEditLocation && (
          <Link
            href={`/profile/${profile.username}?edit=location`}
            className="flex items-center gap-3 mb-6 px-5 py-4 rounded-sm border"
            style={{ background: '#fefcf3', borderColor: '#e8dfc0', textDecoration: 'none' }}
          >
            <span style={{ fontSize: '1.25rem' }}>📍</span>
            <div>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', color: 'var(--ink)', marginBottom: '2px' }}>
                Set up your location
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.03em' }}>
                Unlock Country & City leaderboards and compete locally
              </p>
            </div>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--court)', fontWeight: 500, flexShrink: 0 }}>
              Set up →
            </span>
          </Link>
        )}

        {/* Tabs: Overview / Achievements */}
        <div className="flex border-b mb-6" style={{ borderColor: 'var(--chalk-dim)', gap: 0 }}>
          <Link
            href={`/profile/${profile.username}`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.75rem', letterSpacing: '0.06em',
              textTransform: 'uppercase', padding: '10px 16px', textDecoration: 'none',
              color: activeTab === 'overview' ? 'var(--ink)' : 'var(--muted)',
              borderBottom: activeTab === 'overview' ? '2px solid var(--court)' : '2px solid transparent',
            }}
          >
            Overview
          </Link>
          <Link
            href={`/profile/${profile.username}?tab=achievements`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.75rem', letterSpacing: '0.06em',
              textTransform: 'uppercase', padding: '10px 16px', textDecoration: 'none',
              color: activeTab === 'achievements' ? 'var(--ink)' : 'var(--muted)',
              borderBottom: activeTab === 'achievements' ? '2px solid var(--court)' : '2px solid transparent',
            }}
          >
            Achievements{(achievementCount ?? 0) > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', marginLeft: '6px', color: 'var(--court)', background: '#eaf3de', padding: '1px 6px', borderRadius: '2px' }}>
                {achievementCount}
              </span>
            )}
          </Link>
        </div>

        {/* Achievements tab */}
        {activeTab === 'achievements' && (
          <AchievementsTab
            achievements={achievementsData ?? []}
            isOwnProfile={isOwnProfile}
            username={profile.username}
          />
        )}

        {/* Overview tab */}
        {activeTab === 'overview' && (<>

          {/* Stat grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-6">
            <StatCard
              value={h2hRate !== null ? `${h2hRate}%` : '—'}
              label="Head-to-head"
              sub={h2hTotal > 0 ? `${h2hWins}W · ${h2hLoss}L` : 'no challenges'}
              accent={h2hRate !== null && h2hRate >= 50}
            />
            <StatCard
              value={bestStreak > 0 ? String(bestStreak) : '—'}
              label="Best streak"
              sub={bestStreak > 0 ? 'correct picks' : 'no picks yet'}
            />
            <StatCard
              value={String(achievementCount ?? 0)}
              label="Achievements"
              sub={(achievementCount ?? 0) > 0 ? 'earned' : 'none yet'}
            />
            <StatCard
              value={String(activePredsCount)}
              label="Active"
              sub={activePredsCount > 0 ? 'in progress' : 'none active'}
            />
          </div>

          {/* Recent form */}
          {recentForm.length > 0 && (
            <div className="bg-white rounded-sm border mb-8" style={{ borderColor: 'var(--chalk-dim)', padding: '18px 20px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.14em', color: 'var(--muted)', textTransform: 'uppercase', marginRight: '6px' }}>
                  Recent form
                </span>
                {recentForm.map((f) => (
                  <Link
                    key={f.predId}
                    href={f.tournamentId ? `/tournaments/${f.tournamentId}` : '#'}
                    title={f.tournamentName}
                    style={{
                      width: '34px', height: '34px', borderRadius: '50%',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.72rem', color: '#fff',
                      background: FORM_COLORS[f.cls],
                      textDecoration: 'none', position: 'relative',
                    }}
                  >
                    {f.letter}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Achievements preview */}
          {(preview?.length ?? 0) > 0 && (
            <div className="mb-10">
              <div className="flex items-center justify-between mb-3">
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>Achievements</h2>
                <Link href={`/profile/${profile.username}?tab=achievements`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--court)', letterSpacing: '0.05em', textDecoration: 'none' }}>
                  see all →
                </Link>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(preview ?? []).map((a: any, i: number) => {
                  const tier = ACHIEVEMENT_TIERS[i] ?? 'bronze'
                  const icon = (a.meta?.icon as string) ?? '🏆'
                  const name = (a.meta?.title as string) ?? a.achievement_key
                  const desc = (a.meta?.description as string) ?? ''
                  return (
                    <div key={`${a.achievement_key}-${i}`} className="bg-white border rounded-sm flex items-center gap-3" style={{ borderColor: 'var(--chalk-dim)', padding: '12px 14px', minWidth: '180px', flex: '1 1 220px' }}>
                      <div
                        style={{
                          width: '40px', height: '40px', borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '1.3rem', flexShrink: 0,
                          background: TIER_GRADIENTS[tier],
                          boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.1)',
                        }}
                      >
                        {icon}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--ink)', lineHeight: 1.1 }}>{name}</div>
                        {desc && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: '3px' }}>
                            {desc}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Career tabs */}
          <div className="flex border-b mb-4 overflow-x-auto" style={{ borderColor: 'var(--chalk-dim)' }}>
            <SubTab active={activeSubTab === 'tournaments'} href={`/profile/${profile.username}`} label="Tournaments" count={completedPredCount} />
            <SubTab active={activeSubTab === 'challenges'}  href={`/profile/${profile.username}?sub=challenges`} label="Challenges" count={ongoingChallengeCount} />
            <SubTab active={activeSubTab === 'rivals'}      href={`/profile/${profile.username}?sub=rivals`}     label="Rivals"     count={rivalryStats.length} />
          </div>

          {/* Tournaments tab content */}
          {activeSubTab === 'tournaments' && (<>
            {(() => {
              const activePreds = (predictions ?? []).filter(p => {
                const t = p.tournaments as any
                return t?.status === 'in_progress' || t?.status === 'accepting_predictions'
              })

              if (activePreds.length === 0 && completedPreds.length === 0) {
                return (
                  <div className="bg-white rounded-sm border px-6 py-12 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--muted)' }}>No predictions yet</p>
                    {isOwnProfile && (
                      <Link href="/tournaments" style={{ fontSize: '0.85rem', color: 'var(--court)', marginTop: '0.5rem', display: 'inline-block' }}>
                        Browse tournaments →
                      </Link>
                    )}
                  </div>
                )
              }

              return (
                <>
                  {activePreds.length > 0 && (
                    <div className="mb-5">
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
                        Active
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {activePreds.map(p => {
                          const t = p.tournaments as any
                          return <MatchRow key={p.id} href={`/tournaments/${t?.id}`} flag={t?.flag_emoji} name={t?.location ?? t?.name ?? '—'} meta={formatTournamentMeta(t)} badgeText="In progress" badgeCls="active" />
                        })}
                      </div>
                    </div>
                  )}
                  {completedPreds.length > 0 && (
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
                        Completed
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {completedPreds.map(p => {
                          const t = p.tournaments as any
                          const pts = p.points_earned ?? 0
                          const round = maxRoundByPred[p.id]
                          const badge = round ? badgeForRound(round) : null
                          return (
                            <MatchRow
                              key={p.id}
                              href={`/tournaments/${t?.id}`}
                              flag={t?.flag_emoji}
                              name={t?.location ?? t?.name ?? '—'}
                              meta={formatTournamentMeta(t)}
                              badgeText={badge?.text ?? null}
                              badgeCls={badge?.cls ?? null}
                              pointsText={pts > 0 ? `+${formatPoints(pts)}` : '0'}
                              pointsMuted={pts === 0}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </>)}

          {/* Challenges tab content */}
          {activeSubTab === 'challenges' && (<>
            {challenges.length === 0 ? (
              <div className="bg-white rounded-sm border px-6 py-12 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--muted)' }}>No challenges yet</p>
                {isOwnProfile && (
                  <Link href="/challenges/new" style={{ fontSize: '0.85rem', color: 'var(--court)', marginTop: '0.5rem', display: 'inline-block' }}>
                    Challenge a friend →
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {challenges.map(c => {
                  const statusText = c.status === 'completed'
                    ? c.won ? 'Won' : c.lost ? 'Lost' : 'Draw'
                    : c.status === 'accepted' ? 'Active' : 'Pending'
                  const statusCls = c.status === 'completed'
                    ? c.won ? 'champ' : c.lost ? 'lost' : 'draw'
                    : c.status === 'accepted' ? 'active' : 'pending'
                  const ptsText = c.status === 'completed'
                    ? `${c.myPts ?? 0} – ${c.theirPts ?? 0}`
                    : null
                  return (
                    <MatchRow
                      key={c.id}
                      href={`/challenges/${c.id}`}
                      flag={c.tournamentFlag}
                      name={c.tournamentName}
                      meta={`vs. ${c.opponentName}`}
                      badgeText={statusText}
                      badgeCls={statusCls}
                      pointsText={ptsText}
                      pointsMuted={!c.won}
                    />
                  )
                })}
              </div>
            )}
          </>)}

          {/* Rivals tab content */}
          {activeSubTab === 'rivals' && (<>
            {rivalryStats.length === 0 ? (
              <div className="bg-white rounded-sm border px-6 py-12 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--muted)' }}>No head-to-head record</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.4rem', letterSpacing: '0.04em' }}>Complete a friends challenge to see rivals here</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {rivalryStats.map(r => (
                  <Link
                    key={r.opponentId}
                    href={`/profile/${r.username}`}
                    className="bg-white border rounded-sm flex items-center gap-3"
                    style={{ borderColor: 'var(--chalk-dim)', padding: '16px 18px', textDecoration: 'none', color: 'var(--ink)' }}
                  >
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '34px', height: '34px', borderRadius: '50%',
                          background: '#eef3ee', color: 'var(--court-dark)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: 'var(--font-display)', fontSize: '1rem', flexShrink: 0,
                        }}
                      >
                        {r.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>{r.username}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>{r.total} played</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '14px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                      <span style={{ color: r.wins > r.losses ? 'var(--court)' : 'var(--ink)', fontWeight: r.wins > r.losses ? 600 : 400 }}>
                        {r.wins}W
                      </span>
                      <span style={{ color: r.losses > r.wins ? '#c84b31' : 'var(--muted)', fontWeight: r.losses > r.wins ? 600 : 400 }}>
                        {r.losses}L
                      </span>
                      {r.draws > 0 && (
                        <span style={{ color: 'var(--muted)' }}>{r.draws}D</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>)}

          {/* Friend activity (own profile) */}
          {isOwnProfile && friendActivityItems.length > 0 && (
            <div className="mt-10">
              <div className="flex items-center justify-between mb-4">
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>Friend activity</h2>
                <Link href="/friends" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--court)', letterSpacing: '0.05em', textDecoration: 'none' }}>See all friend activity →</Link>
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

          {/* Email preferences */}
          {isOwnProfile && (
            <div className="mt-10">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
                Email preferences
              </h2>
              <EmailPrefsToggle initialPreferences={resolvePreferences((profile as any).email_preferences)} />
            </div>
          )}

          {/* Support */}
          {isOwnProfile && (
            <div className="mt-10">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
                Need help?
              </h2>
              <div className="bg-white rounded-sm border px-5 py-4" style={{ borderColor: 'var(--chalk-dim)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--ink)', lineHeight: 1.55 }}>
                  Questions, feedback, or something not working? Email{' '}
                  <a href="mailto:support@quietplease.app" style={{ color: 'var(--court)', textDecoration: 'none', fontWeight: 500 }}>
                    support@quietplease.app
                  </a>
                  {' '}and we&rsquo;ll get back to you.
                </p>
              </div>
            </div>
          )}

          {/* Delete account */}
          {isOwnProfile && (
            <DeleteAccountSection
              username={profile.username}
              deletionRequestedAt={(profile as any).deletion_requested_at ?? null}
            />
          )}

        </>)}
      </div>
      <Footer />

      {/* Hero body responsive: two columns on md+, stacked on mobile */}
      <style>{`
        @media (min-width: 768px) {
          .hero-body { grid-template-columns: 1fr 1fr !important; padding: 32px 28px !important; gap: 32px !important; }
          .tour-strip { flex-direction: row !important; }
          .tour-strip > div { border-right: 1px solid rgba(255,255,255,0.08); border-bottom: 0 !important; }
          .tour-strip > div:last-child { border-right: 0; }
        }
      `}</style>
    </main>
  )
}

// ── Inline style helpers ────────────────────────────────────────────────────
const heroBtnStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  padding: '6px 12px',
  borderRadius: '2px',
  background: 'rgba(255,255,255,0.1)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.2)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  textDecoration: 'none',
  display: 'inline-block',
}

const tourCellStyle: React.CSSProperties = {
  flex: 1,
  padding: '12px 16px',
  textAlign: 'center',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
}

const tourLblStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.58rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.55)',
  marginBottom: '4px',
}

const tourValStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '1.2rem',
  color: '#fff',
  letterSpacing: '-0.01em',
}

// Recent-form dot colors keyed by class
const FORM_COLORS: Record<string, string> = {
  w: 'var(--court)',
  f: '#b78321',
  s: '#8fa4b8',
  q: '#b0b4b8',
  x: '#d4a5a5',
}

// Achievement tier gradients (ordered by recency: gold first, then silver, bronze)
const ACHIEVEMENT_TIERS = ['gold', 'silver', 'bronze'] as const
const TIER_GRADIENTS: Record<string, string> = {
  gold:   'linear-gradient(135deg,#f9e9a8,#d4af37)',
  silver: 'linear-gradient(135deg,#f0f0f0,#b8b8b8)',
  bronze: 'linear-gradient(135deg,#e4ba94,#a07044)',
}

// Map ledger round → badge shown on completed tournament row
function badgeForRound(round: string): { text: string; cls: string } | null {
  switch (round) {
    case 'F':    return { text: 'Champion',   cls: 'champ' }
    case 'SF':   return { text: 'Finalist',   cls: 'final' }
    case 'QF':   return { text: 'SF reach',   cls: 'final' }
    case 'R16':  return { text: 'QF reach',   cls: 'neutral' }
    case 'R32':  return { text: 'R16 reach',  cls: 'neutral' }
    case 'R64':  return { text: 'R32 reach',  cls: 'neutral' }
    case 'R128': return { text: 'R64 reach',  cls: 'neutral' }
    default:     return null
  }
}

function formatTournamentMeta(t: any): string {
  if (!t) return ''
  const parts: string[] = []
  const tier =
    t.category === 'grand_slam'   ? 'Grand Slam' :
    t.category === 'masters_1000' ? (t.tour === 'WTA' ? 'WTA 1000' : 'Masters 1000') :
    t.category === '500'          ? `${t.tour} 500` :
    t.category === '250'          ? `${t.tour} 250` : (t.tour ?? '')
  if (tier) parts.push(tier)
  if (t.surface) parts.push(t.surface.charAt(0).toUpperCase() + t.surface.slice(1))
  if (t.starts_at) parts.push(new Date(t.starts_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }))
  return parts.join(' · ')
}

// ── Subcomponents ───────────────────────────────────────────────────────────
function StatCard({ value, label, sub, accent }: { value: string; label: string; sub?: string | null; accent?: boolean }) {
  return (
    <div className="bg-white rounded-sm border text-center" style={{ borderColor: 'var(--chalk-dim)', padding: '16px 12px' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.65rem', letterSpacing: '-0.02em', color: accent ? 'var(--court)' : 'var(--ink)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', letterSpacing: '0.12em', color: 'var(--muted)', marginTop: '6px', textTransform: 'uppercase' }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--muted)', marginTop: '2px', opacity: 0.6 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function SubTab({ active, href, label, count }: { active: boolean; href: string; label: string; count: number }) {
  return (
    <Link
      href={href}
      style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.72rem', letterSpacing: '0.08em',
        textTransform: 'uppercase', padding: '10px 14px', textDecoration: 'none',
        color: active ? 'var(--ink)' : 'var(--muted)',
        borderBottom: active ? '2px solid var(--court)' : '2px solid transparent',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      {count > 0 && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', marginLeft: '6px', color: 'var(--court)', background: '#eaf3de', padding: '1px 6px', borderRadius: '2px' }}>
          {count}
        </span>
      )}
    </Link>
  )
}

function MatchRow({
  href, flag, name, meta, badgeText, badgeCls, pointsText, pointsMuted,
}: {
  href: string
  flag?: string | null
  name: string
  meta?: string | null
  badgeText?: string | null
  badgeCls?: string | null
  pointsText?: string | null
  pointsMuted?: boolean
}) {
  return (
    <Link
      href={href}
      className="bg-white border rounded-sm"
      style={{ borderColor: 'var(--chalk-dim)', padding: '14px 16px', textDecoration: 'none', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '10px' }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        {flag && <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{flag}</span>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>{name}</div>
          {meta && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>
              {meta}
            </div>
          )}
        </div>
      </div>
      {badgeText && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', padding: '2px 7px', borderRadius: '2px', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', ...BADGE_STYLES[badgeCls ?? 'neutral'] }}>
          {badgeText}
        </span>
      )}
      {pointsText && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 500, color: pointsMuted ? 'var(--muted)' : 'var(--court)', whiteSpace: 'nowrap' }}>
          {pointsText}
        </span>
      )}
    </Link>
  )
}

const BADGE_STYLES: Record<string, React.CSSProperties> = {
  champ:   { background: '#f9e9a8', color: '#7a5e12' },
  final:   { background: '#fde5c1', color: '#8a5a1e' },
  neutral: { background: '#f1efe8', color: 'var(--muted)' },
  active:  { background: '#eaf3de', color: 'var(--court-dark)' },
  pending: { background: '#f1efe8', color: 'var(--muted)' },
  lost:    { background: '#fdecea', color: '#c84b31' },
  draw:    { background: '#f1efe8', color: 'var(--muted)' },
}
