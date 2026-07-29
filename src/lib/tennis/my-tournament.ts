/**
 * Per-user tournament summary — the "Your tournament" panel on a tournament page.
 *
 * Pure derivation from data the page already has: the user's picks, the
 * tournament's match results, the draw, and the user's point_ledger rows. No
 * queries here, so it stays testable and the page stays thin.
 *
 * Two things worth knowing about the shape of this data:
 *
 *  - Accuracy and points diverge sharply. Later rounds are worth far more per
 *    match (a grand slam final is 2000 base against 10 for a first-round match)
 *    and the streak multiplier compounds on top, so a round can carry a low hit
 *    rate and still dominate the total. Reporting one accuracy figure would
 *    misrepresent the tournament, which is why `rounds` carries both.
 *
 *  - Player names and countries live on the draw as a snapshot, not a foreign
 *    key. Players who were placeholders when the draw was built (qualifiers)
 *    have neither, so callers can pass `overrides` from the players registry.
 */

export const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'] as const

export const ROUND_LABEL: Record<string, string> = {
  R128: 'R128', R64: 'R64', R32: 'R32', R16: 'R16',
  QF: 'Quarterfinal', SF: 'Semifinal', F: 'Final',
}

export interface DrawPlayer { name?: string | null; country?: string | null; externalId?: string | null }
export interface DrawMatch { matchId: string; round: string; player1?: DrawPlayer | null; player2?: DrawPlayer | null }

export interface MatchResultRow {
  external_match_id: string
  winner_external_id: string | null
  loser_external_id: string | null
  round: string
}

export interface MyTournamentInput {
  /** predictions.picks — external_match_id → picked winner's external id */
  picks: Record<string, string>
  results: MatchResultRow[]
  matches: DrawMatch[]
  /** point_ledger rows for this user's global prediction, keyed by match */
  pointsByMatch: Record<string, number>
  /** external_id → registry values, for players the draw snapshot is missing */
  overrides?: Record<string, { name?: string | null; country?: string | null }>
}

export interface RoundSummary {
  round: string
  label: string
  decided: number
  correct: number
  points: number
  /** 0–100, share of decided matches called correctly */
  accuracy: number
  /** 0–100, share of the user's total points earned in this round */
  pointsShare: number
}

export interface PlayerSummary {
  externalId: string
  name: string
  /** full country name, e.g. "Italy" — null when unknown. Flag is derived at render. */
  country: string | null
  picks: number
  points: number
  active: boolean
  /** rounds still picked and not yet played — only meaningful while active */
  riding: number
  /** round the player was eliminated in, null while still active */
  outRound: string | null
}

export interface MyTournament {
  pointsSoFar: number
  correct: number
  decided: number
  distinctPicked: number
  activeCount: number
  /** the most advanced round with at least one result, null before play starts */
  currentRound: string | null
  /**
   * Winner of the final, once played. Needed because "never lost a match" is how
   * active is derived — which would otherwise label the champion as still active
   * on a finished tournament.
   */
  championExternalId: string | null
  rounds: RoundSummary[]
  /** active players with picks still to come, richest first */
  stillToCome: PlayerSummary[]
  /** active players with no picks left to come */
  activeIdle: PlayerSummary[]
  /** every picked player, by points earned then picks made */
  players: PlayerSummary[]
}

function displayName(
  externalId: string,
  fromDraw: Record<string, string>,
  overrides: Record<string, { name?: string | null }>,
): string {
  return fromDraw[externalId] || overrides[externalId]?.name || 'Qualifier'
}

export function buildMyTournament(input: MyTournamentInput): MyTournament {
  const { picks, results, matches, pointsByMatch, overrides = {} } = input

  // ── Lookups from the draw ─────────────────────────────────────────────────
  const nameByExternalId: Record<string, string> = {}
  const countryByExternalId: Record<string, string> = {}
  const roundByMatchId: Record<string, string> = {}
  for (const m of matches) {
    if (m?.matchId && m.round) roundByMatchId[m.matchId] = m.round
    for (const p of [m?.player1, m?.player2]) {
      if (!p?.externalId) continue
      if (p.name) nameByExternalId[p.externalId] = p.name
      if (p.country) countryByExternalId[p.externalId] = p.country
    }
  }

  const resultByMatchId = new Map(results.map(r => [r.external_match_id, r]))

  // ── Headline counts ───────────────────────────────────────────────────────
  let correct = 0
  for (const r of results) {
    if (r.winner_external_id && picks[r.external_match_id] === r.winner_external_id) correct++
  }
  const pointsSoFar = Object.values(pointsByMatch).reduce((s, p) => s + p, 0)

  // ── Per round ─────────────────────────────────────────────────────────────
  const rounds: RoundSummary[] = []
  for (const round of ROUND_ORDER) {
    const inRound = results.filter(r => r.round === round)
    if (inRound.length === 0) continue

    let roundCorrect = 0
    let roundPoints = 0
    for (const r of inRound) {
      if (r.winner_external_id && picks[r.external_match_id] === r.winner_external_id) roundCorrect++
      roundPoints += pointsByMatch[r.external_match_id] ?? 0
    }

    rounds.push({
      round,
      label: ROUND_LABEL[round] ?? round,
      decided: inRound.length,
      correct: roundCorrect,
      points: roundPoints,
      accuracy: Math.round((roundCorrect / inRound.length) * 100),
      pointsShare: pointsSoFar > 0 ? Math.round((roundPoints / pointsSoFar) * 100) : 0,
    })
  }
  const currentRound = rounds.length > 0 ? rounds[rounds.length - 1].round : null
  const championExternalId = results.find(r => r.round === 'F')?.winner_external_id ?? null

  // ── Per player ────────────────────────────────────────────────────────────
  // A player is out once they appear as the loser of any played match.
  const eliminatedIn = new Map<string, string>()
  for (const r of results) {
    if (r.loser_external_id && !eliminatedIn.has(r.loser_external_id)) {
      eliminatedIn.set(r.loser_external_id, r.round)
    }
  }

  const pickCount: Record<string, number> = {}
  const riding: Record<string, number> = {}
  for (const [matchId, playerId] of Object.entries(picks)) {
    if (!playerId) continue
    pickCount[playerId] = (pickCount[playerId] ?? 0) + 1
    // Picks still to come = picked for a match not yet played. Keyed off
    // the result rather than the round, so a half-finished round counts correctly.
    if (!resultByMatchId.has(matchId) && roundByMatchId[matchId]) {
      riding[playerId] = (riding[playerId] ?? 0) + 1
    }
  }

  // Points attribute to the player who won the match, which — since a ledger row
  // only exists for a correct pick — is the player the user picked.
  const pointsByPlayer: Record<string, number> = {}
  for (const [matchExternalId, pts] of Object.entries(pointsByMatch)) {
    const winner = resultByMatchId.get(matchExternalId)?.winner_external_id
    if (winner) pointsByPlayer[winner] = (pointsByPlayer[winner] ?? 0) + pts
  }

  const players: PlayerSummary[] = Object.keys(pickCount).map(externalId => {
    const outRound = eliminatedIn.get(externalId) ?? null
    const active = outRound === null
    return {
      externalId,
      name: displayName(externalId, nameByExternalId, overrides),
      country: countryByExternalId[externalId] || overrides[externalId]?.country || null,
      picks: pickCount[externalId],
      points: pointsByPlayer[externalId] ?? 0,
      active,
      riding: active ? (riding[externalId] ?? 0) : 0,
      outRound,
    }
  })

  const byValue = (a: PlayerSummary, b: PlayerSummary) => b.points - a.points || b.picks - a.picks
  players.sort(byValue)

  const active = players.filter(p => p.active)

  return {
    pointsSoFar,
    correct,
    decided: results.length,
    distinctPicked: players.length,
    activeCount: active.length,
    currentRound,
    championExternalId,
    rounds,
    stillToCome: active.filter(p => p.riding > 0).sort((a, b) => b.riding - a.riding || byValue(a, b)),
    activeIdle: active.filter(p => p.riding === 0).sort(byValue),
    players,
  }
}
