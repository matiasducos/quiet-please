import { createAdminClient } from '@/lib/supabase/admin'
import { countryToFlag, type CardPlayer, type CardTournament, type PicksCard, type RawDrawMatch } from './data'
import { ROUND_ORDER } from '@/lib/tennis/pick-gaps'
import { resolveLegacyTournamentId } from '@/lib/tournaments/series'

/**
 * The story card for one user's bracket — the only card built from a *person*
 * rather than from a tournament.
 *
 * It exists because "Share picks" copied a URL and nothing else. On a phone
 * that is a link with no picture, and Instagram will not take a link at all.
 *
 * WHY THE CALL TO ACTION IS PAINTED ON
 *
 * Instagram cannot be handed a caption from a web page: Stories sharing runs on
 * Android implicit intents and iOS custom URL schemes with a Facebook App ID,
 * and neither exists in a browser. Even the plain share sheet drops the `text`
 * when an image goes to Instagram. So the invitation and the URL are part of
 * the artwork, the way Strava and Spotify do it — anything not in the pixels
 * does not survive the handoff.
 */

/** Deepest round first, since that is the order the card reads in. */
const DEEPEST_FIRST = [...ROUND_ORDER].reverse()

const GROUP_LABEL: Record<string, string> = {
  F:    'Champion',
  SF:   'Finalists',
  QF:   'Semifinalists',
  R16:  'Quarterfinalists',
  R32:  'Last 16',
  R64:  'Last 32',
  R128: 'Last 64',
}

/**
 * A pick names the winner of a match, so the label describes what the pick
 * makes them, not the round it sits in: picking the SF is picking the two
 * finalists. Off-by-one here would put "Semifinalists" over the two players
 * this bracket says will contest the final.
 */
function labelFor(round: string, count: number): string {
  // Once the champion is deduplicated out of it, the semifinal round holds
  // exactly one player: the person this bracket has losing the final.
  // "Finalists" over a single name would be wrong twice over.
  if (round === 'SF' && count === 1) return 'Runner-up'
  return GROUP_LABEL[round] ?? round
}

export type PicksCardResult =
  | { ok: true; card: PicksCard }
  | { ok: false; error: string; status: number }

export async function getPicksCard(
  tournamentId: string,
  username: string,
  origin: string,
): Promise<PicksCardResult> {
  const db = createAdminClient()

  const { data: user, error: uErr } = await db
    .from('users')
    .select('id, username')
    .eq('username', username)
    .maybeSingle()
  if (uErr) return { ok: false, error: uErr.message, status: 500 }
  if (!user) return { ok: false, error: 'No such user', status: 404 }

  const [
    { data: tournament, error: tErr },
    { data: draw, error: dErr },
    { data: prediction, error: pErr },
  ] = await Promise.all([
    db.from('tournaments')
      .select('name, flag_emoji, location, tour, category, surface, starts_at, ends_at')
      .eq('id', tournamentId).single(),
    db.from('draws').select('bracket_data').eq('tournament_id', tournamentId).single(),
    db.from('predictions')
      .select('id, picks, is_fully_locked, points_earned')
      .eq('tournament_id', tournamentId)
      .eq('user_id', user.id)
      .is('challenge_id', null)
      .maybeSingle(),
  ])

  if (tErr || !tournament) return { ok: false, error: 'Tournament not found', status: 404 }
  if (dErr || !draw?.bracket_data) return { ok: false, error: 'Draw not found', status: 404 }
  if (pErr) return { ok: false, error: pErr.message, status: 500 }
  if (!prediction) return { ok: false, error: 'No bracket', status: 404 }

  // Same gate as the picks page this card links to. An unlocked bracket is
  // private, and a card is a far more public thing than a URL — there would be
  // no point rendering a picture of picks whose page 404s for whoever opens it.
  if (prediction.is_fully_locked !== true) {
    return { ok: false, error: 'Bracket is not locked', status: 403 }
  }

  const picks = (prediction.picks ?? {}) as Record<string, string>
  const matches = ((draw.bracket_data as { matches?: RawDrawMatch[] }).matches ?? [])

  // Every player the draw knows, so a pick's id resolves to a name and a flag.
  const byId = new Map<string, CardPlayer>()
  for (const m of matches) {
    for (const p of [m.player1, m.player2]) {
      if (!p?.externalId || !p.name) continue
      if (!byId.has(p.externalId)) {
        byId.set(p.externalId, { name: p.name, flag: countryToFlag(p.country), seed: p.seed ?? null })
      }
    }
  }

  const byRound = new Map<string, RawDrawMatch[]>()
  for (const m of matches) {
    if (!byRound.has(m.round)) byRound.set(m.round, [])
    byRound.get(m.round)!.push(m)
  }

  /**
   * A slot the draw has not filled with a person yet.
   *
   * Two ways it reaches here and both must be dropped. A pick on a
   * `qualifier-N` placeholder resolves perfectly well against the draw
   * snapshot and would print the word "Qualifier" as somebody's champion. And
   * a pick whose id the draw no longer holds is dangling — a resolved
   * qualifier or a withdrawal overwrote the slot — which is a known state of
   * this data, not a hypothetical.
   */
  const isPlaceholder = (id: string, p: CardPlayer | undefined): boolean =>
    !p || p.name === 'Qualifier' || id.startsWith('qualifier-')

  /**
   * Picks for one round, minus anyone already named in a deeper one.
   *
   * A bracket carries its players forward, so the champion is also one of the
   * two finalists, and both finalists are also semifinalists. Printed
   * literally, the card repeats the same two names down every group and says
   * almost nothing — the first render of it listed "D. Medvedev" as champion
   * and again as a finalist, directly underneath.
   *
   * Naming each player once, at the deepest point this bracket takes them, is
   * both shorter and more informative: what is left in each group is the part
   * the reader does not already know.
   */
  const seen = new Set<string>()
  const playersPicked = (round: string): CardPlayer[] => {
    const out: CardPlayer[] = []
    for (const m of byRound.get(round) ?? []) {
      const id = picks[m.matchId]
      if (!id || seen.has(id)) continue
      const p = byId.get(id)
      if (isPlaceholder(id, p)) continue
      seen.add(id)
      out.push(p!)
    }
    return out
  }

  // Champion is the pick for the Final. It leads the card when it exists —
  // which is the interesting case, since a bracket with a champion is a bracket
  // somebody committed to.
  const champion = playersPicked('F')[0] ?? null

  // Then the rounds below it, deepest first. A bracket that stops at the third
  // round still gets a card: it leads with the deepest thing that was picked
  // rather than printing an empty hero.
  const groups: PicksCard['groups'] = []
  for (const round of DEEPEST_FIRST) {
    if (round === 'F') continue
    const players = playersPicked(round)
    if (players.length === 0) continue
    groups.push({ label: labelFor(round, players.length), players })
  }

  // Points and standing only once there is something to have earned them —
  // "0 points, 47th" before a ball is struck reads as failure rather than
  // anticipation, and this card's whole job is to recruit an opponent.
  const { count: playedCount } = await db
    .from('match_results')
    .select('external_match_id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)

  let points: number | null = null
  let rank: number | null = null
  if ((playedCount ?? 0) > 0) {
    points = prediction.points_earned ?? 0
    // Rank as a count rather than a sorted fetch: one indexed count instead of
    // pulling every bracket in the tournament to find one position.
    const { count: ahead } = await db
      .from('predictions')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .is('challenge_id', null)
      .gt('points_earned', points)
    rank = (ahead ?? 0) + 1
  }

  const cardTournament: CardTournament = {
    name:      tournament.name,
    flagEmoji: tournament.flag_emoji ?? '',
    location:  tournament.location ?? '',
    tour:      tournament.tour ?? '',
    category:  tournament.category ?? '',
    surface:   tournament.surface ?? null,
    startsAt:  tournament.starts_at ?? null,
    endsAt:    tournament.ends_at ?? null,
  }

  // The slug URL, never the UUID one. This string is printed on the card, and
  // someone has to be able to read it off a screenshot and type it — which a
  // UUID defeats. The slug lives on tournament_series, not on tournaments, so
  // it is resolved the same way a legacy /tournaments/<uuid> link is.
  const legacy = await resolveLegacyTournamentId(tournamentId)
  const path = `/tournaments/${legacy?.slug ?? tournamentId}/picks/${user.username}`

  return {
    ok: true,
    card: {
      kind: 'picks',
      tournament: cardTournament,
      username: user.username,
      champion,
      groups,
      points,
      rank,
      shareUrl: `${origin.replace(/^https?:\/\//, '')}${path}`,
    },
  }
}
