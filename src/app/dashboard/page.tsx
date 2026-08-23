import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import TournamentCard from '@/components/TournamentCard'
import ActivityFeed from '@/components/ActivityFeed'
import { getActivity } from '@/lib/friends/activity'
import { getTournamentEngagement } from '@/lib/tournaments/engagement'
import { getOnNowTournaments } from '@/lib/tournaments/cached'
import PredictionStats from '@/components/PredictionStats'
import type { RoundStat, PlayerStat, MissedPlayerStat } from '@/components/PredictionStats'
import DashboardTour from '@/components/DashboardTour'
import { formatPoints } from '@/lib/utils/format'
import { getLiveStatuses } from '@/lib/tennis/live-status'
import { ROUND_LABEL } from '@/lib/tennis/my-tournament'
import { getRecentResultsForUser, withRecaps } from '@/lib/tournaments/recap'

export const metadata: Metadata = { title: 'Dashboard' }

/** 1st, 2nd, 3rd, 4th… — 11th–13th are the exceptions the naive rule gets wrong. */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

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
  const [onNowTournaments, { count: predictionCount }, roundRes, playerRes, missedRes] = await Promise.all([
    getOnNowTournaments(4),
    supabase.from('predictions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('challenge_id', null),
    admin.rpc('user_round_stats', { p_user_id: user.id }),
    admin.rpc('user_player_stats', { p_user_id: user.id, p_limit: 14 }),
    admin.rpc('user_missed_winners', { p_user_id: user.id, p_limit: 6 }),
  ])

  if (roundRes.error)  console.error('[dashboard] user_round_stats failed:', roundRes.error.message)
  if (playerRes.error) console.error('[dashboard] user_player_stats failed:', playerRes.error.message)
  if (missedRes.error) console.error('[dashboard] user_missed_winners failed:', missedRes.error.message)
  const roundStats  = (roundRes.data ?? []) as RoundStat[]
  const playerStats = (playerRes.data ?? []) as PlayerStat[]
  const missedStats = (missedRes.data ?? []) as MissedPlayerStat[]

  // Rank + engagement in parallel (both depend on prior data)
  const onNowIds = onNowTournaments.map(t => t.id)
  const [{ count: higherCount }, engagement] = await Promise.all([
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gt('ranking_points', profile?.ranking_points ?? 0),
    getTournamentEngagement(onNowIds),
  ])

  const globalRank = (higherCount ?? 0) + 1

  // Enrich the strip with engagement counts
  const enrichedLive = onNowTournaments.map(t => ({
    ...t,
    prediction_count: engagement[t.id]?.predictions ?? 0,
    challenge_count: engagement[t.id]?.challenges ?? 0,
  }))

  // The viewer's own standing in each tournament on the strip. Not cached
  // alongside getOnNowTournaments(), which is shared across all users.
  //
  // Returns nothing for a tournament that has not started — no results means no
  // standing — so those cards simply render without a footer.
  const liveStatuses = await getLiveStatuses(user.id, onNowIds)

  const stats = [
    { label: 'Ranking points', value: formatPoints(profile?.ranking_points ?? 0) },
    { label: 'Predictions',    value: predictionCount ?? 0 },
    { label: 'Global rank',    value: `#${globalRank}` },
  ]

  const activity = await getActivity(user.id, 15)

  // Every recent finish, with this user's own result attached where they played.
  const recentResults = await withRecaps(await getRecentResultsForUser(user.id, 2))

  // A line about *this* moment rather than a restatement of the page. When
  // something is running the dashboard's job is to point at it; when nothing is,
  // it points at the one panel that's still worth reading.
  // The strip now carries tournaments that have not started, and "is under way"
  // is false for those — the line has to follow the headliner's own status.
  const headliner = enrichedLive[0]
  const headlinerName = headliner
    ? `${headliner.flag_emoji ? `${headliner.flag_emoji} ` : ''}${headliner.location ?? headliner.name}`
    : null
  const subtitle = headliner
    ? headliner.status === 'in_progress'
      ? `${headlinerName} is under way — every result moves your bracket.`
      : `${headlinerName} has its draw out — get your bracket in before play starts.`
    : 'Nothing on court right now. Good moment to look back at your record.'

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} userId={user.id} />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-12">

        <div className="mb-12">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
            Welcome back{profile?.username ? `, ${profile.username}` : ''}
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '1rem' }}>{subtitle}</p>
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
              <Link href="/activity" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>See all activities →</Link>
            </div>
            {/* Cuts mid-row on purpose: a half-visible row is the clearest
                signal that the list keeps going. */}
            <ActivityFeed items={activity} viewerId={user.id} maxHeight="26rem" />
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

        {/* ─── Recent results ──────────────────────────────────────────────
            Shown for every recent tournament, entered or not. An active user
            who never opens the homepage would otherwise never see a recap, and
            the recap is the engaging part — worth reading about an event you
            skipped. Where they did play, their own finish rides on top as the
            card footer, the same slot "Live right now" uses for standings. */}
        {recentResults.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.01em' }}>
                Recent results
              </h2>
              <Link href="/tournaments?status=completed&year=all" className="shrink-0" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>
                All results →
              </Link>
            </div>
            <div className={`grid gap-3 ${recentResults.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
              {recentResults.map(t => (
                <TournamentCard
                  key={t.id}
                  t={t}
                  footer={
                    t.mine ? (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', lineHeight: 1.6 }}>
                        <span style={{ color: 'var(--ink)' }}>
                          You · {formatPoints(t.mine.points)} pts
                          {/* The field is only quoted when it is known: a recap
                              that failed to load leaves it at 0, and "3rd of 0"
                              is worse than no denominator at all. */}
                          {t.mine.field > 0 && (
                            <span style={{ color: 'var(--muted)' }}>
                              {' '}· finished {ordinal(t.mine.rank)} of {formatPoints(t.mine.field)}
                            </span>
                          )}
                        </span>
                      </div>
                    ) : undefined
                  }
                />
              ))}
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
            missedPlayers={missedStats}
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
