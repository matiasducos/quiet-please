'use server'

import { createClient } from '@/lib/supabase/server'
import { getNavProfile } from '@/lib/supabase/profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'

// Mark all unread as read — called on page load via inline server action
async function markAllRead(userId: string) {
  'use server'
  const supabase = await createClient()
  await (supabase as any)
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  draw_open:             { label: 'Draw open',          color: '#27500A' },
  points_awarded:        { label: 'Points awarded',     color: '#185FA5' },
  points_expired:        { label: 'Points expired',     color: '#993C1D' },
  tournament_completed:  { label: 'Tournament over',    color: '#27500A' },
  admin_calendar_gap:    { label: 'Calendar',           color: '#92400e' },
  challenge_received:    { label: 'Challenge',           color: '#993C1D' },
  challenge_cancelled:   { label: 'Challenge cancelled', color: '#993C1D' },
  challenge_picks_locked:{ label: 'Challenge update',    color: '#185FA5' },
  friend_request:        { label: 'Friend request',     color: '#7c2d7c' },
  friend_accepted:       { label: 'New friend',          color: '#27500A' },
  friend_picks_locked:   { label: "Friend's picks",      color: '#185FA5' },
  league_member_joined:  { label: 'League',              color: '#27500A' },
  league_member_left:    { label: 'League',              color: '#993C1D' },
  league_deleted:        { label: 'League deleted',      color: '#993C1D' },
  league_ownership_transferred: { label: 'League owner', color: '#185FA5' },
  auto_predictions_generated:  { label: 'Auto-prediction', color: '#7c2d7c' },
  achievement_earned:          { label: 'Achievement',      color: '#D4A017' },
  referral_joined:             { label: 'Invite joined',    color: '#1a6b3c' },
}

function getHref(
  n: { type: string; tournament_id: string | null; meta: Record<string, string | number> },
  viewerUsername?: string,
): string {
  if (n.type === 'friend_request' || n.type === 'friend_accepted') return '/friends'
  // An invite now carries the challenge it is about, so it can open the bracket
  // rather than the list. Older rows have no id and still land on the list.
  if (n.type === 'challenge_received') {
    return n.meta.challenge_id ? `/challenges/${n.meta.challenge_id}` : '/challenges'
  }
  if (n.type === 'challenge_cancelled') return '/challenges'
  if (n.type === 'challenge_picks_locked' && n.meta.challenge_id) return `/challenges/${n.meta.challenge_id}`
  if (n.type === 'friend_picks_locked' && n.tournament_id && n.meta.username) {
    return `/tournaments/${n.tournament_id}/picks/${n.meta.username}`
  }
  if (n.type === 'league_member_joined' && n.meta.league_id) return `/leagues/${n.meta.league_id}`
  if (n.type === 'league_member_left' && n.meta.league_id) return `/leagues/${n.meta.league_id}`
  if (n.type === 'league_deleted') return '/leagues'
  if (n.type === 'league_ownership_transferred' && n.meta.league_id) return `/leagues/${n.meta.league_id}`
  if (n.type === 'auto_predictions_generated' && n.tournament_id) return `/tournaments/${n.tournament_id}/predict`
  if (n.type === 'achievement_earned') {
    return viewerUsername ? `/profile/${viewerUsername}?tab=achievements` : '/leaderboard'
  }
  // Their own profile, where the rolling total sits next to the all-time one —
  // the only place the drop makes sense in context.
  if (n.type === 'points_expired') {
    return viewerUsername ? `/profile/${viewerUsername}` : '/leaderboard'
  }
  // The recap, not the edition page. The reader already knows the tournament
  // finished — this notification is what told them — so landing them on the
  // page that repeats that is a dead end. Falls back to the edition page for a
  // tournament with no series, which has no recap URL. Same rule the activity
  // feed's completion row follows.
  if (n.type === 'tournament_completed') {
    return n.meta.series_slug && n.meta.starts_year
      ? `/tournaments/${n.meta.series_slug}/${n.meta.starts_year}/recap`
      : n.tournament_id ? `/tournaments/${n.tournament_id}` : '/tournaments'
  }
  // Straight to where the missing edition gets entered.
  if (n.type === 'admin_calendar_gap') return '/admin/tournaments/new'
  if (n.type === 'referral_joined') {
    return n.meta.invitee_username ? `/profile/${n.meta.invitee_username}` : '/invite'
  }
  if (n.tournament_id) return `/tournaments/${n.tournament_id}`
  return '/tournaments'
}

function formatRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default async function NotificationsPage() {
  const { user, profile } = await getNavProfile()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: notifications } = await (supabase as any)
    .from('notifications')
    .select('id, type, meta, read_at, created_at, tournament_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Mark as read (fire-and-forget — we don't await so page renders immediately)
  markAllRead(user.id)

  const items = notifications ?? []

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav deletionRequestedAt={profile?.deletion_requested_at} username={profile?.username} points={profile?.ranking_points ?? 0} userId={user.id} />

      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10">

        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Notifications
          </h1>
        </div>

        {items.length === 0 ? (
          <div className="bg-white rounded-sm border py-16 px-8 text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--ink)', marginBottom: '0.5rem' }}>
              All caught up
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              You&apos;ll be notified here when draws open, friends lock their picks, or you receive challenges.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((n: any) => {
              const meta = (n.meta ?? {}) as Record<string, string | number>
              const typeMeta = TYPE_META[n.type] ?? { label: n.type, color: 'var(--ink)' }
              const isUnread = !n.read_at
              const href = getHref({ type: n.type, tournament_id: n.tournament_id, meta }, profile?.username)

              return (
                <Link
                  key={n.id}
                  href={href}
                  className="block bg-white rounded-sm border px-5 py-4 hover:border-current transition-colors"
                  style={{
                    borderColor: isUnread ? 'var(--court)' : 'var(--chalk-dim)',
                    textDecoration: 'none',
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Type badge */}
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.6rem',
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: typeMeta.color,
                          fontWeight: 600,
                          display: 'block',
                          marginBottom: '4px',
                        }}
                      >
                        {typeMeta.label}
                      </span>

                      {/* Message */}
                      <p style={{ fontSize: '0.9rem', color: 'var(--ink)', lineHeight: 1.4 }}>
                        {n.type === 'draw_open' && (
                          <>Draw is open for {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}<strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong>. Make your picks before it closes.</>
                        )}
                        {n.type === 'points_awarded' && (
                          <>You earned <strong>{meta.points ?? 0} pts</strong> for {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}.</>
                        )}
                        {n.type === 'points_expired' && (
                          <>
                            <strong>{meta.points_expired ?? 0} pts</strong> dropped out of your rolling 52-week ranking
                            {Number(meta.tournament_count ?? 0) === 1 && (meta.tournament_location || meta.tournament_name)
                              ? <> — a year has passed since {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}<strong>{meta.tournament_location ?? meta.tournament_name}</strong></>
                              : <> — a year has passed since {meta.tournament_count ?? 0} of your tournaments</>}
                            . You still have <strong>{meta.points_remaining ?? 0} pts</strong>. Nothing is lost: your full record is on your profile.
                          </>
                        )}
                        {n.type === 'tournament_completed' && (
                          <>
                            {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}
                            <strong>{meta.tournament_location ?? meta.tournament_name ?? 'A tournament'}</strong> is over.
                            {Number(meta.points ?? 0) > 0
                              ? <> You finished <strong>#{meta.finish_rank ?? 0}</strong> of {meta.field_size ?? 0} with <strong>{meta.points ?? 0} pts</strong>.</>
                              : <> You didn&apos;t score this time.</>}
                            {' '}See how everyone did.
                          </>
                        )}
                        {n.type === 'admin_calendar_gap' && (
                          <>
                            Next year&apos;s edition is missing for <strong>{meta.gap_count ?? 0} tournament{Number(meta.gap_count ?? 0) === 1 ? '' : 's'}</strong>.
                            The soonest is <strong>{meta.soonest_series ?? 'a tournament'}</strong> {meta.soonest_tour ? <>({meta.soonest_tour})</> : null}, whose {meta.soonest_year ?? ''} points expire on{' '}
                            <strong>{meta.soonest_expiry ? String(meta.soonest_expiry).slice(0, 10) : 'soon'}</strong>.
                            Load the new edition first, or {meta.affected_predictions ?? 0} scoring predictions drop off on the 52-week fallback.
                          </>
                        )}
                        {/* The pick count and scope only exist on invites sent
                            after the draft flow shipped; older rows fall back to
                            the bare sentence rather than reading "0 picks". */}
                        {n.type === 'challenge_received' && (
                          <><strong>{meta.challenger_username ?? 'Someone'}</strong> challenged you for {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}<strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong>
                          {Number(meta.pick_count ?? 0) > 0
                            ? <> — their bracket is in with <strong>{meta.pick_count} pick{Number(meta.pick_count) === 1 ? '' : 's'}</strong>{meta.scope_label ? <> ({String(meta.scope_label).toLowerCase()})</> : null}. Beat it.</>
                            : <>.</>}
                          </>
                        )}
                        {n.type === 'challenge_cancelled' && (
                          <><strong>{meta.challenger_username ?? 'Someone'}</strong> cancelled their challenge for {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}<strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong>.</>
                        )}
                        {n.type === 'challenge_picks_locked' && (
                          <><strong>{meta.username ?? 'Your opponent'}</strong> locked their picks for your {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}<strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong> challenge. Lock yours to compare!</>
                        )}
                        {n.type === 'friend_request' && (
                          <><strong>{meta.from_username ?? 'Someone'}</strong> sent you a friend request.</>
                        )}
                        {n.type === 'friend_accepted' && (
                          <><strong>{meta.friend_username ?? 'Someone'}</strong> accepted your friend request. You&apos;re now friends.</>
                        )}
                        {n.type === 'friend_picks_locked' && (
                          <><strong>{meta.username ?? 'A friend'}</strong> locked in their picks for {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}<strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong>.</>
                        )}
                        {n.type === 'league_member_joined' && (
                          <><strong>{meta.joiner_username ?? 'Someone'}</strong> joined your league <strong>{meta.league_name ?? 'a league'}</strong>.</>
                        )}
                        {n.type === 'league_member_left' && (
                          <><strong>{meta.leaver_username ?? 'Someone'}</strong> left your league <strong>{meta.league_name ?? 'a league'}</strong>.</>
                        )}
                        {n.type === 'league_deleted' && (
                          <>The league <strong>{meta.league_name ?? 'a league'}</strong> was deleted by its owner.</>
                        )}
                        {n.type === 'league_ownership_transferred' && (
                          <>You are now the owner of <strong>{meta.league_name ?? 'a league'}</strong>.</>
                        )}
                        {n.type === 'auto_predictions_generated' && (
                          <>Your predictions for {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}<strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong> were automatically generated.{meta.picks_count ? <> ({meta.picks_count} picks)</> : null}</>
                        )}
                        {n.type === 'achievement_earned' && (
                          <>{meta.achievement_emoji ?? '🏅'} Achievement unlocked: <strong>{meta.achievement_name ?? 'an achievement'}</strong>. {meta.achievement_description ?? ''}</>
                        )}
                        {n.type === 'referral_joined' && (
                          <>🎾 <strong>{meta.invitee_username ?? 'Someone'}</strong> joined Quiet Please via your invite. You&apos;re now friends.</>
                        )}
                      </p>
                    </div>

                    <div className="flex-shrink-0 flex items-center gap-2">
                      {isUnread && (
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: 'var(--court)',
                            display: 'block',
                          }}
                        />
                      )}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {formatRelative(n.created_at)}
                      </span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
