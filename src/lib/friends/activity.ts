import { createAdminClient } from '@/lib/supabase/admin'
import { formatPoints } from '@/lib/utils/format'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ActivityItem = {
  type: 'picks' | 'points' | 'league' | 'tournament' | 'result'
  user_id: string | null
  username: string | null
  label: string
  date: string
  href?: string
  /**
   * For 'result' rows only: how the *viewer's* own global bracket did on that
   * match. 'correct' means point_ledger paid them for it, or — while the match
   * is entered but not yet scored — that their pick names the winner. The
   * ledger is preferred wherever it has an answer; see the comment at the query
   * for why the order matters.
   *
   * Absent in two cases, both of which must render as no colour rather than as
   * a miss:
   *   - they had no pick for the match
   *   - the pick was locked, i.e. made after the match started, which
   *     award-points skips entirely, so it can never pay out
   *
   * It describes the viewer, never the row's subject, so it must not be reused
   * on a feed rendered for someone else's profile.
   */
  outcome?: 'correct' | 'wrong'
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
    label: `earned ${formatPoints(p.points)} ${p.source === 'challenge' ? 'challenge' : 'ranking'} pts at ${p.tournament_name}`,
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
  /** Whose picks decide the colour on result rows — the person looking, not the row's subject. */
  viewerId: string,
): Promise<ActivityItem[]> {
  // Get tournament IDs where any of these users have predictions
  const { data: relevantPreds } = await admin
    .from('predictions')
    .select('tournament_id')
    .in('user_id', relevantUserIds)
    .is('challenge_id', null)

  const tournamentIds = [...new Set((relevantPreds ?? []).map((p: any) => p.tournament_id))]
  if (tournamentIds.length === 0) return []

  const ROUND_LABELS: Record<string, string> = {
    R128: 'R128', R64: 'R64', R32: 'R32',
    R16: 'R16', QF: 'Quarterfinals', SF: 'Semifinals', F: 'Final',
  }

  const [{ data: tournaments }, { data: recentResults }, { data: viewerPreds, error: viewerPredsError }, { data: recapRows }] = await Promise.all([
    admin.from('tournaments')
      .select('id, name, location, flag_emoji, status, starts_at, ends_at, completed_at, starts_year, tournament_series(slug)')
      .in('id', tournamentIds)
      .in('status', ['accepting_predictions', 'draw_published', 'in_progress', 'completed']),
    admin.from('match_results')
      .select('id, external_match_id, round, winner_external_id, loser_external_id, score, played_at, tournament_id, tournaments(name, location, flag_emoji)')
      .in('tournament_id', tournamentIds)
      .gte('played_at', since)
      .or('score.neq.BYE,score.is.null')
      .order('played_at', { ascending: false })
      .limit(50),
    // The viewer's own brackets across the tournaments already in play — one
    // bounded query rather than a lookup per result row.
    //
    // `.is('challenge_id', null)` is load-bearing: anyone in a friend challenge
    // has a second predictions row for the same tournament, and colouring the
    // dashboard from a challenge bracket is the leak that has produced wrong
    // per-user figures before.
    admin.from('predictions')
      .select('id, tournament_id, picks, locked_picks')
      .eq('user_id', viewerId)
      .is('challenge_id', null)
      .in('tournament_id', tournamentIds),
    // Which of these have a stored recap. "Tournament completed" is a dead end
    // when it lands on the edition page — the recap is what the reader actually
    // wants at that moment, and this is the cheapest way to know it exists.
    admin.from('tournament_recaps')
      .select('tournament_id')
      .in('tournament_id', tournamentIds),
  ])

  if (viewerPredsError) {
    // Losing the colour is cosmetic; losing the feed is not. Log and carry on
    // with every result row uncoloured.
    console.error('[activity] could not load viewer picks for result colouring:', viewerPredsError.message)
  }

  // tournament_id → the viewer's picks and which of them were locked
  const viewerBrackets = new Map<string, { picks: Record<string, string>; locked: Set<string> }>()
  for (const p of viewerPreds ?? []) {
    viewerBrackets.set(p.tournament_id, {
      picks: (p.picks as Record<string, string>) ?? {},
      locked: new Set((p.locked_picks as string[]) ?? []),
    })
  }

  // Which of these matches actually paid the viewer out.
  //
  // A hit is sourced from point_ledger rather than from `picks[matchId] ===
  // winner`, because brackets stay editable and a ledger row outlives the pick
  // that earned it — measured at 68 of 5173 paid matches where the current pick
  // no longer matches the winner. Comparing the live pick would call those
  // misses on a match the user was paid for.
  //
  // Scoped by prediction_id, not user_id: challenge brackets write to
  // point_ledger too (752 rows today), and user_id alone would let a friend
  // challenge tint the dashboard.
  const paidMatchIds = new Set<string>()
  const viewerPredIds = (viewerPreds ?? []).map(p => p.id)
  const resultIds = (recentResults ?? []).map(r => r.id)
  if (viewerPredIds.length > 0 && resultIds.length > 0) {
    const { data: paidRows, error: paidError } = await admin
      .from('point_ledger')
      .select('match_result_id')
      .in('prediction_id', viewerPredIds)
      .in('match_result_id', resultIds)
    if (paidError) {
      console.error('[activity] could not load point ledger for result colouring:', paidError.message)
    }
    for (const row of paidRows ?? []) paidMatchIds.add(row.match_result_id)
  }

  const recapIds = new Set((recapRows ?? []).map(r => r.tournament_id))

  /** PostgREST types an embedded to-one relation as object-or-array; flatten both. */
  const seriesSlug = (t: { tournament_series?: { slug: string } | { slug: string }[] | null }): string | null => {
    const embedded = t.tournament_series
    return (Array.isArray(embedded) ? embedded[0]?.slug : embedded?.slug) ?? null
  }

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

    // Two different dates, on purpose — this row is the one place in the feed
    // where "is this recent?" and "when did it happen?" have different answers.
    //
    // The WINDOW stays on ends_at, the tournament's calendar end. The DATE
    // moves to completed_at, when the final result was actually entered. They
    // routinely disagree by days, because completion is a manual step: Cincinnati
    // 2026 has ends_at 08-20 and completed_at 08-24, Montreal 08-09 vs 08-14.
    // Sorting on ends_at is what kept this row invisible — Cincinnati's recap
    // was built and its row generated, then stamped four days into the past and
    // buried under every Winston-Salem result played since. The dashboard takes
    // the newest 15; it never got close.
    //
    // The window must NOT move to completed_at with it. 081's backfill set
    // completed_at from max(match_results.scored_at), and scored_at only exists
    // from 068 onwards — so twenty tournaments going back to Monte-Carlo in
    // April all carry 2026-08-01T08:31:44, the moment the catch-up run scored
    // them. Gating on that value would announce the entire clay season as
    // freshly finished. ends_at is typed in by hand from the calendar and is
    // immune to it.
    //
    // Residue: a tournament inside the window whose completed_at is one of
    // those backfilled stamps shifts by a few days. Both dates are already old
    // enough to sit near the bottom of the feed, so nothing is displaced.
    const completedAt = t.completed_at ?? t.ends_at
    if (t.status === 'completed' && t.ends_at && t.ends_at >= since) {
      // Point at the recap when one exists. "Tournament completed" landing on
      // the edition page is a dead end — the reader already knows it finished,
      // and what they want next is what happened. Falls back to the edition
      // page while the recap is still pending (the cron builds it on a later
      // pass) and for tournaments with no series, which have no recap URL.
      const slug = seriesSlug(t)
      const recapHref = recapIds.has(t.id) && slug && t.starts_year != null
        ? `/tournaments/${slug}/${t.starts_year}/recap`
        : null
      events.push({
        type: 'tournament', user_id: null, username: null,
        label: recapHref ? `${displayName} — recap is up` : `${displayName} — tournament completed`,
        date: completedAt,
        href: recapHref ?? `/tournaments/${t.id}`,
      })
    }
  }

  // ── Match result events — resolve player names from draw bracket data ──
  if (recentResults && recentResults.length > 0) {
    const resultTournamentIds = [...new Set(recentResults.map((r: any) => r.tournament_id))]
    const { data: draws } = await admin
      .from('draws')
      .select('tournament_id, bracket_data')
      .in('tournament_id', resultTournamentIds)

    // Build player name lookup: tournamentId → externalId → name
    const playerNames = new Map<string, Map<string, string>>()
    for (const d of draws ?? []) {
      const names = new Map<string, string>()
      for (const m of ((d.bracket_data as any)?.matches ?? []) as any[]) {
        if (m.player1?.externalId) names.set(m.player1.externalId, m.player1.name)
        if (m.player2?.externalId) names.set(m.player2.externalId, m.player2.name)
      }
      playerNames.set(d.tournament_id, names)
    }

    for (const r of recentResults as any[]) {
      if (!r.played_at) continue
      const names = playerNames.get(r.tournament_id)
      const winner = names?.get(r.winner_external_id) ?? 'Unknown'
      const loser = names?.get(r.loser_external_id) ?? 'Unknown'
      const flag = r.tournaments?.flag_emoji ? `${r.tournaments.flag_emoji} ` : ''
      const tName = `${flag}${r.tournaments?.location ?? r.tournaments?.name ?? 'a tournament'}`
      const round = ROUND_LABELS[r.round] ?? r.round
      const score = r.score ? ` ${r.score}` : ''

      // Paid wins over everything, so an edited bracket can't turn a match the
      // viewer was actually paid for into a miss. Only then fall back to
      // comparing the pick with the winner, which is what covers the window
      // between a result being entered and award-points scoring it.
      const bracket = viewerBrackets.get(r.tournament_id)
      const pick = bracket?.picks[r.external_match_id]
      let outcome: ActivityItem['outcome']
      if (paidMatchIds.has(r.id)) {
        // Authoritative, and it survives a later edit to the bracket.
        outcome = 'correct'
      } else if (pick !== undefined && !bracket!.locked.has(r.external_match_id)) {
        // Not paid — which does NOT mean they got it wrong. A result is visible
        // here the moment it is entered, but it only pays once award-points has
        // scored it, and that gap is routinely minutes and occasionally hours:
        // on 2026-08-24, 16 of 22 Winston-Salem R64 results sat unscored while
        // the feed was already showing them. Treating unpaid as a miss painted
        // every correct pick in that window red.
        //
        // So fall back to the pick itself. Safe precisely because it is a
        // fallback: the ledger still wins above it, so the 68-of-5173 paid
        // matches whose current pick no longer matches the winner stay green,
        // which is the case this ordering exists to protect. And a pick made
        // after the match started is already excluded by the `locked` guard, so
        // what reaches this line was chosen before the result was known.
        outcome = pick === r.winner_external_id ? 'correct' : 'wrong'
      }

      events.push({
        type: 'result', user_id: null, username: winner,
        label: `d. ${loser}${score} — ${round} at ${tName}`,
        date: r.played_at,
        href: `/tournaments/${r.tournament_id}/results`,
        outcome,
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
    fetchTournamentEvents(admin, allUserIds, since, userId),
  ])

  return [...userEvents, ...tournamentEvents]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit)
}
