import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentCard from '@/components/TournamentCard'
import { getActivity, timeAgo } from '@/lib/friends/activity'
import { getTournamentEngagement } from '@/lib/tournaments/engagement'
import { getUpcomingTournaments, getLiveTournaments } from '@/lib/tournaments/cached'
import DashboardTour from '@/components/DashboardTour'

export const metadata: Metadata = { title: 'Dashboard | Quiet Please' }

export default async function DashboardPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const supabase = await createClient()

  // Shared tournament data is cached (60s TTL); user-specific data is not
  const [upcomingTournaments, liveTournaments, { count: predictionCount }] = await Promise.all([
    getUpcomingTournaments(3),
    getLiveTournaments(4),
    supabase.from('predictions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('challenge_id', null),
  ])

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

  const stats = [
    { label: 'Ranking points', value: profile?.ranking_points ?? 0 },
    { label: 'Predictions',    value: predictionCount ?? 0 },
    { label: 'Global rank',    value: `#${globalRank}` },
  ]

  const activity = await getActivity(user.id, 8)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} userId={user.id} />
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
              {enrichedLive.map(t => (
                <TournamentCard key={t.id} t={t} />
              ))}
            </div>
          </div>
        )}

        {/* Upcoming tournaments */}
        <div data-tour="upcoming">
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.01em' }}>Upcoming tournaments</h2>
            <Link href="/tournaments" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>View all →</Link>
          </div>

          {!upcomingTournaments || upcomingTournaments.length === 0 ? (
            <div className="bg-white rounded-sm border py-16 px-8 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--ink)', marginBottom: '0.5rem' }}>
                No upcoming tournaments
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem', maxWidth: '360px', margin: '0 auto 1.5rem' }}>
                The calendar syncs daily. When draws open, they&apos;ll appear here so you can make your picks.
              </p>
              <Link
                href="/tournaments"
                className="inline-block px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90"
                style={{ background: 'var(--court)' }}
              >
                Browse all tournaments
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {upcomingTournaments.map(t => (
                <Link
                  key={t.id}
                  href={`/tournaments/${t.id}`}
                  className="flex items-center justify-between bg-white rounded-sm border px-6 py-4 tournament-card"
                  style={{ borderColor: 'var(--chalk-dim)', textDecoration: 'none' }}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="px-2 py-0.5 text-xs rounded-sm flex-shrink-0" style={{ background: t.tour === 'WTA' ? '#fbeaf0' : '#e6f1fb', color: t.tour === 'WTA' ? '#993556' : '#185FA5', fontFamily: 'var(--font-mono)' }}>
                      {t.tour}
                    </span>
                    <div className="min-w-0">
                      <span className="truncate block" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>
                        {t.flag_emoji && <span style={{ marginRight: '4px' }}>{t.flag_emoji}</span>}
                        {t.location ?? t.name}
                      </span>
                      {t.location && (
                        <span className="truncate block" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)' }}>{t.name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                      {t.starts_at ? new Date(t.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                    </span>
                    {t.status === 'accepting_predictions' && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--court)', fontWeight: 500, whiteSpace: 'nowrap' }}>Predict →</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      <DashboardTour />
    </main>
  )
}
