import { createAdminClient } from '@/lib/supabase/admin'

export type ActivityItem = {
  type: 'picks' | 'points' | 'league'
  user_id: string
  username: string
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

/**
 * Fetches recent activity for all accepted friends of `userId`.
 * Looks back 30 days; returns at most `limit` items sorted newest first.
 */
export async function getFriendActivity(userId: string, limit = 15): Promise<ActivityItem[]> {
  const admin = createAdminClient()

  // Get accepted friend IDs
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

  const [{ data: lockedPicks }, { data: pointsRows }, { data: leagueJoins }] = await Promise.all([
    admin.from('predictions')
      .select('user_id, tournament_id, submitted_at, users(username), tournaments(name, location, flag_emoji)')
      .in('user_id', friendIds)
      .eq('is_fully_locked', true)
      .is('challenge_id', null)
      .gte('submitted_at', since)
      .order('submitted_at', { ascending: false })
      .limit(50),
    admin.from('point_ledger')
      .select('user_id, tournament_id, points, awarded_at, users(username), tournaments(name, location, flag_emoji)')
      .in('user_id', friendIds)
      .gte('awarded_at', since)
      .order('awarded_at', { ascending: false })
      .limit(200),
    admin.from('league_members')
      .select('user_id, joined_at, users(username), leagues(id, name, is_public)')
      .in('user_id', friendIds)
      .gte('joined_at', since)
      .order('joined_at', { ascending: false })
      .limit(30),
  ])

  const picksEvents: ActivityItem[] = (lockedPicks ?? []).map((p: any) => {
    const flag = p.tournaments?.flag_emoji ? `${p.tournaments.flag_emoji} ` : ''
    return {
      type: 'picks',
      user_id: p.user_id,
      username: p.users?.username ?? 'Unknown',
      label: `locked picks for ${flag}${p.tournaments?.location ?? p.tournaments?.name ?? 'a tournament'}`,
      date: p.submitted_at,
      href: `/tournaments/${p.tournament_id}`,
    }
  })

  // Aggregate points by user + tournament
  const pointsMap = new Map<string, {
    user_id: string; username: string; points: number
    tournament_name: string; awarded_at: string; tournament_id: string
  }>()
  for (const row of (pointsRows ?? []) as any[]) {
    const key = `${row.user_id}:${row.tournament_id}`
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
      })
    }
  }
  const pointsEvents: ActivityItem[] = Array.from(pointsMap.values()).map(p => ({
    type: 'points',
    user_id: p.user_id,
    username: p.username,
    label: `earned ${p.points} pts at ${p.tournament_name}`,
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
    .slice(0, limit)
}
