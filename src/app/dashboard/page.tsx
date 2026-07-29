import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentCard from '@/components/TournamentCard'
import { getActivity, timeAgo } from '@/lib/friends/activity'
import { getTournamentEngagement } from '@/lib/tournaments/engagement'
import { getLiveTournaments } from '@/lib/tournaments/cached'
import PredictionStats from '@/components/PredictionStats'
import type { RoundStat, PlayerStat } from '@/components/PredictionStats'
import DashboardTour from '@/components/DashboardTour'
import { formatPoints } from '@/lib/utils/format'
import { getLiveStatuses } from '@/lib/tennis/live-status'
import { ROUND_LABEL } from '@/lib/tennis/my-tournament'

export const metadata: Metadata = { title: 'Dashboard | Quiet Please' }

export default async function DashboardPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const supabase = await createClient()
  // The stats functions are granted to service_role only (057), so they must go
  // through the admin client — the user client is explicitly revoked.
  const admin = createAdminClient()

  // Shared tournament data is cached (60s TTL); user-specific data is not
  // The all-time aggregates sit in this batch rather than after it: they are the
  // slowest queries on the page (they scan every prediction the user has made),
  // so running them in parallel keeps them off the critical path.
  const [liveTournaments, { count: predictionCount }, roundRes, playerRes] = await Promise.all([
    getLiveTournaments(4),
    supabase.from('predictions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('challenge_id', null),
    admin.rpc('user_round_stats', { p_user_id: user.id }),
    admin.rpc('user_player_stats', { p_user_id: user.id, p_limit: 14 }),
  ])

  if (roundRes.error)  console.error('[dashboard] user_round_stats failed:', roundRes.error.message)
  if (playerRes.error) console.error('[dashboard] user_player_stats failed:', playerRes.error.message)
  const roundStats  = (roundRes.data ?? []) as RoundStat[]
  const playerStats = (playerRes.data ?? []) as PlayerStat[]

  // Rank + engagement in parallel (both depend on prior data)
  const liveIds = liveTournaments.map(t => t.id)
  const [{ count: higherCount }, engagement] = await Promise.all([
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gt('ranking_points', profile?.ranking_points ?? 0),
    getTournamentEngagement(liveIds),
  ])

  const globalRank = (higherCount ?? 0) + 1

  // Enrich live tournaments with engagement counts
  const enrichedLive = liveTournaments.map(t => ({
    ...t,
    prediction_count: engagement[t.id]?.predictions ?? 0,
    challenge_count: engagement[t.id]?.challenges ?? 0,
  }))

  // The viewer's own standing in each live tournament. Not cached alongside
  // getLiveTournaments(), which is shared across all users.
  const liveStatuses = await getLiveStatuses(user.id, liveIds)

  const stats = [
    { label: 'Ranking points', value: formatPoints(profile?.ranking_points ?? 0) },
    { label: 'Predictions',    value: predictionCount ?? 0 },
    { label: 'Global rank',    value: `#${globalRank}` },
  ]

  const activity = await getActivity(user.id, 8)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} userId={user.id} />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-12">

        <div className="mb-12">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
            Welcome back{profile?.username ? `, ${profile.username}` : ''}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '1rem' }}>Your predictions. Your points. Your season.</p>
        </div>

        {/* Stats */}
        <div data-tour="stats" className="grid grid-cols-3 gap-2 md:gap-4 mb-12">
          {stats.map((stat, i) => (
            <div key={i} className="bg-white rounded-sm border p-3 md:p-6 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                {stat.label}
              </div>
              <div className="text-xl md:text-3xl" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* ─── Activity ────────────────────────────────────────────────────────── */}
        {activity.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.01em' }}>Activity</h2>
              <Link href="/friends" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>See all activities →</Link>
            </div>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              {activity.map((item, i) => {
                const icon = item.type === 'tournament' ? '🎾' : item.type === 'result' ? '🏆' : item.type === 'picks' ? '🔒' : item.type === 'points' ? '⭐' : '👥'
                const isMe = item.user_id === user.id
                return (
                  <div
                    key={`${item.type}-${item.user_id ?? 'system'}-${item.date}-${i}`}
                    className="flex items-center gap-3 px-5 py-3 border-b last:border-0"
                    style={{ borderColor: 'var(--chalk-dim)' }}
                  >
                    <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon}</span>
                    <div className="flex-1 min-w-0 truncate">
                        {item.username ? (
                          <>
                            {item.type === 'result' ? (
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: 'var(--ink)' }}>
                                {item.username}
                              </span>
                            ) : (
                              <Link href={`/profile/${item.username}`} style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', color: isMe ? 'var(--court)' : 'var(--ink)', textDecoration: 'none' }}>
                                {isMe ? 'You' : item.username}
                              </Link>
                            )}
                            {' '}
                          </>
                        ) : null}
                        {item.href ? (
                          <Link href={item.href} style={{ fontSize: '0.875rem', color: 'var(--muted)', textDecoration: 'none' }}>
                            {item.label}
                          </Link>
                        ) : (
                          <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>{item.label}</span>
                        )}
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

        {/* ─── Live Right Now ─────────────────────────────────────────────── */}
        {enrichedLive.length > 0 && (
          <div data-tour="live-now" className="mb-12">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: '#c84b31', boxShadow: '0 0 0 3px rgba(200,75,49,0.2)', flexShrink: 0 }}
                />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Live right now
                </span>
              </div>
              <Link href="/tournaments" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>See all tournaments →</Link>
            </div>
            <div className={`grid gap-3 ${enrichedLive.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
              {enrichedLive.map(t => {
                const s = liveStatuses[t.id]
                return (
                  <TournamentCard
                    key={t.id}
                    t={t}
                    footer={s ? (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', lineHeight: 1.6 }}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span style={{ color: 'var(--ink)' }}>
                            {s.pointsSoFar.toLocaleString()} pts
                            <span style={{ color: 'var(--muted)' }}> · {s.correct} of {s.decided} correct</span>
                          </span>
                          {s.currentRound && (
                            <span style={{ color: 'var(--muted)' }}>
                              {ROUND_LABEL[s.currentRound] ?? s.currentRound} done
                            </span>
                          )}
                        </div>
                        {s.topRiding.length > 0 && (
                          <div style={{ color: '#1a6b3c', marginTop: '2px' }}>
                            {s.topRiding.map(p => `${p.name} ${p.riding} to come`).join(' · ')}
                            {s.ridingCount > s.topRiding.length && (
                              <span style={{ color: 'var(--muted)' }}> +{s.ridingCount - s.topRiding.length} more</span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : undefined}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Your record — the same panel as the profile Stats tab */}
        <div data-tour="record">
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.01em' }}>Your record</h2>
            <Link href={`/profile/${profile?.username ?? ''}?tab=stats`} style={{ fontSize: '0.875rem', color: 'var(--court)' }}>
              Full stats →
            </Link>
          </div>
          <PredictionStats
            rounds={roundStats}
            players={playerStats}
            tournamentsEntered={predictionCount ?? 0}
            isOwnProfile
            username={profile?.username ?? ''}
          />
        </div>
      </div>
      <DashboardTour />
    </main>
  )
}
