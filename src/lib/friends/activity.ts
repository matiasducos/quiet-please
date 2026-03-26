import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ActivityItem = {
  type: 'picks' | 'points' | 'league' | 'tournament'
  user_id: string | null
  username: string | null
  label: string
  date: string
  href?: string
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (days  > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins  > 0) return `${mins}m ago`
  return 'just now'
}

/* ── Shared helper: fetch picks/points/league events for a set of user IDs ── */

async function fetchUserEvents(
  admin: SupabaseClient,
  userIds: string[],
  since: string,
  limits = { picks: 50, points: 200, leagues: 30 },
): Promise<ActivityItem[]> {
  if (userIds.length === 0) return []

  const [{ data: lockedPicks }, { data: pointsRows }, { data: leagueJoins }] = await Promise.all([
    admin.from('predictions')
      .select('user_id, tournament_id, submitted_at, users(username), tournaments(name, location, flag_emoji)')
      .in('user_id', userIds)
      .eq('is_fully_locked', true)
      .is('challenge_id', null)
      .gte('submitted_at', since)
      .order('submitted_at', { ascending: false })
      .limit(limits.picks),
    admin.from('point_ledger')
      .select('user_id, tournament_id, points, awarded_at, predictions(challenge_id), users(username), tournaments(name, location, flag_emoji)')
      .in('user_id', userIds)
      .gte('awarded_at', since)
      .order('awarded_at', { ascending: false })
      .limit(limits.points),
    admin.from('league_members')
      .select('user_id, joined_at, users(username), leagues(id, name, is_public)')
      .in('user_id', userIds)
      .gte('joined_at', since)
      .order('joined_at', { ascending: false })
      .limit(limits.leagues),
  ])

  const picksEvents: ActivityItem[] = (lockedPicks ?? []).map((p: any) => {
    const flag = p.tournaments?.flag_emoji ? `${p.tournaments.flag_emoji} ` : ''
    return {
      type: 'picks' as const,
      user_id: p.user_id,
      username: p.users?.username ?? 'Unknown',
      label: `locked picks for ${flag}${p.tournaments?.location ?? p.tournaments?.name ?? 'a tournament'}`,
      date: p.submitted_at,
      href: `/tournaments/${p.tournament_id}`,
    }
  })

  // Aggregate points by user + tournament + source (ranking vs challenge)
  const pointsMap = new Map<string, {
    user_id: string; username: string; points: number
    tournament_name: string; awarded_at: string; tournament_id: string
    source: 'ranking' | 'challenge'
  }>()
  for (const row of (pointsRows ?? []) as any[]) {
    const isChallenge = row.predictions?.challenge_id != null
    const source = isChallenge ? 'challenge' : 'ranking'
    const key = `${row.user_id}:${row.tournament_id}:${source}`
    const existing = pointsMap.get(key)
    const flag = row.tournaments?.flag_emoji ? `${row.tournaments.flag_emoji} ` : ''
    if (existing) {
      existing.points += row.points
      if (row.awarded_at > existing.awarded_at) existing.awarded_at = row.awarded_at
    } else {
      pointsMap.set(key, {
        user_id: row.user_id,
        username: row.users?.username ?? 'Unknown',
        points: row.points,
        tournament_name: `${flag}${row.tournaments?.location ?? row.tournaments?.name ?? 'a tournament'}`,
        awarded_at: row.awarded_at,
        tournament_id: row.tournament_id,
        source,
      })
    }
  }
  const pointsEvents: ActivityItem[] = Array.from(pointsMap.values()).map(p => ({
    type: 'points' as const,
    user_id: p.user_id,
    username: p.username,
    label: `earned ${p.points} ${p.source === 'challenge' ? 'challenge' : 'ranking'} pts at ${p.tournament_name}`,
    date: p.awarded_at,
    href: `/tournaments/${p.tournament_id}`,
  }))

  const leagueEvents: ActivityItem[] = (leagueJoins ?? [])
    .filter((m: any) => m.leagues?.is_public)
    .map((m: any) => ({
      type: 'league' as const,
      user_id: m.user_id,
      username: m.users?.username ?? 'Unknown',
      label: `joined ${m.leagues?.name ?? 'a league'}`,
      date: m.joined_at,
      href: `/leagues/${m.leagues?.id}`,
    }))

  return [...picksEvents, ...pointsEvents, ...leagueEvents]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

/* ── Tournament status events for relevant tournaments ── */

async function fetchTournamentEvents(
  admin: SupabaseClient,
  relevantUserIds: string[],
  since: string,
): Promise<ActivityItem[]> {
  // Get tournament IDs where any of these users have predictions
  const { data: relevantPreds } = await admin
    .from('predictions')
    .select('tournament_id')
    .in('user_id', relevantUserIds)
    .is('challenge_id', null)

  const tournamentIds = [...new Set((relevantPreds ?? []).map((p: any) => p.tournament_id))]
  if (tournamentIds.length === 0) return []

  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id, name, location, flag_emoji, status, starts_at, ends_at')
    .in('id', tournamentIds)
    .in('status', ['accepting_predictions', 'draw_published', 'in_progress', 'completed'])

  const events: ActivityItem[] = []
  for (const t of tournaments ?? []) {
    const flag = t.flag_emoji ? `${t.flag_emoji} ` : ''
    const displayName = `${flag}${t.location ?? t.name}`

    if (t.status === 'accepting_predictions' || t.status === 'draw_published') {
      const eventDate = t.starts_at ?? since
      if (eventDate >= since) {
        events.push({
          type: 'tournament', user_id: null, username: null,
          label: `${displayName} — draw published`,
          date: eventDate,
          href: `/tournaments/${t.id}`,
        })
      }
    }

    if (t.status === 'in_progress' && t.starts_at && t.starts_at >= since) {
      events.push({
        type: 'tournament', user_id: null, username: null,
        label: `${displayName} — tournament started`,
        date: t.starts_at,
        href: `/tournaments/${t.id}`,
      })
    }

    if (t.status === 'completed' && t.ends_at && t.ends_at >= since) {
      events.push({
        type: 'tournament', user_id: null, username: null,
        label: `${displayName} — tournament completed`,
        date: t.ends_at,
        href: `/tournaments/${t.id}`,
      })
    }
  }

  return events
}

/* ── Public: friends-only feed (used on /friends, profile pages) ── */

export async function getFriendActivity(userId: string, limit = 15): Promise<ActivityItem[]> {
  const admin = createAdminClient()

  const { data: friendships } = await admin
    .from('friendships')
    .select('requester_id, addressee_id')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq('status', 'accepted')

  const friendIds = (friendships ?? []).map(f =>
    f.requester_id === userId ? f.addressee_id : f.requester_id
  )

  if (friendIds.length === 0) return []

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const events = await fetchUserEvents(admin, friendIds, since)
  return events.slice(0, limit)
}

/* ── Public: blended feed for dashboard (self + friends + tournament updates) ── */

export async function getActivity(userId: string, limit = 10): Promise<ActivityItem[]> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: friendships } = await admin
    .from('friendships')
    .select('requester_id, addressee_id')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq('status', 'accepted')

  const friendIds = (friendships ?? []).map(f =>
    f.requester_id === userId ? f.addressee_id : f.requester_id
  )

  const allUserIds = [userId, ...friendIds]

  const [userEvents, tournamentEvents] = await Promise.all([
    fetchUserEvents(admin, allUserIds, since),
    fetchTournamentEvents(admin, allUserIds, since),
  ])

  return [...userEvents, ...tournamentEvents]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit)
}
