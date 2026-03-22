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
}

function getHref(n: { type: string; tournament_id: string | null; meta: Record<string, string | number> }): string {
  if (n.type === 'friend_request' || n.type === 'friend_accepted') return '/friends'
  if (n.type === 'challenge_received' || n.type === 'challenge_cancelled') return '/challenges'
  if (n.type === 'challenge_picks_locked' && n.meta.challenge_id) return `/challenges/${n.meta.challenge_id}`
  if (n.type === 'friend_picks_locked' && n.tournament_id && n.meta.username) {
    return `/tournaments/${n.tournament_id}/picks/${n.meta.username}`
  }
  if (n.type === 'league_member_joined' && n.meta.league_id) return `/leagues/${n.meta.league_id}`
  if (n.type === 'league_member_left' && n.meta.league_id) return `/leagues/${n.meta.league_id}`
  if (n.type === 'league_deleted') return '/leagues'
  if (n.type === 'league_ownership_transferred' && n.meta.league_id) return `/leagues/${n.meta.league_id}`
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
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} userId={user.id} />

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
              const href = getHref({ type: n.type, tournament_id: n.tournament_id, meta })

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
                          <>Draw is open for <strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong>. Make your picks before it closes.</>
                        )}
                        {n.type === 'points_awarded' && (
                          <>You earned <strong>{meta.points ?? 0} pts</strong> for {meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}.</>
                        )}
                        {n.type === 'challenge_received' && (
                          <><strong>{meta.challenger_username ?? 'Someone'}</strong> challenged you for <strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong>.</>
                        )}
                        {n.type === 'challenge_cancelled' && (
                          <><strong>{meta.challenger_username ?? 'Someone'}</strong> cancelled their challenge for <strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong>.</>
                        )}
                        {n.type === 'challenge_picks_locked' && (
                          <><strong>{meta.username ?? 'Your opponent'}</strong> locked their picks for your <strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong> challenge. Lock yours to compare!</>
                        )}
                        {n.type === 'friend_request' && (
                          <><strong>{meta.from_username ?? 'Someone'}</strong> sent you a friend request.</>
                        )}
                        {n.type === 'friend_accepted' && (
                          <><strong>{meta.friend_username ?? 'Someone'}</strong> accepted your friend request. You&apos;re now friends.</>
                        )}
                        {n.type === 'friend_picks_locked' && (
                          <><strong>{meta.username ?? 'A friend'}</strong> locked in their picks for <strong>{meta.tournament_location ?? meta.tournament_name ?? 'a tournament'}</strong>.</>
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
