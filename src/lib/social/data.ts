import { createAdminClient } from '@/lib/supabase/admin'
import { ROUND_ORDER, ROUND_LABEL } from '@/lib/tennis/my-tournament'
import { COUNTRIES, ALIASES } from '@/app/admin/countries'

/**
 * Data behind the admin social cards.
 *
 * Everything here runs with the service-role client: the cards aggregate across
 * all users (pick rates, the tournament podium), which no session-scoped query
 * could see through RLS, and the only caller is an admin-guarded route.
 */

// ── Card kinds ────────────────────────────────────────────────────────────────

export const CARD_KINDS = ['draw', 'recap', 'complete'] as const
export type CardKind = (typeof CARD_KINDS)[number]

export const CARD_LABEL: Record<CardKind, string> = {
  draw: 'Draw published',
  recap: 'Round recap',
  complete: 'Champion',
}

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface CardTournament {
  name: string
  flagEmoji: string
  location: string
  tour: string
  category: string
  surface: string | null
  startsAt: string | null
  endsAt: string | null
}

export interface CardPlayer {
  name: string
  /** Unicode regional-indicator flag, or '' when the country is unknown. */
  flag: string
  seed: number | null
}

export interface DrawCard {
  kind: 'draw'
  tournament: CardTournament
  drawSize: number
  /** Distinct countries in the draw — the one extra fact a draw always supports. */
  countries: number
  /**
   * Opening matches in draw-sheet order. Deliberately not filtered to seeded
   * players: no draw in this database carries a `seed` (the builder never
   * collects one), so a seeds-only card renders empty. Draw order is the
   * available proxy — match 1 is the top of the sheet.
   */
  opening: Array<{ a: CardPlayer; b: CardPlayer }>
}

export interface RecapMatch {
  winner: CardPlayer
  loser: CardPlayer
  score: string
  /** Share of global brackets that called it, 0–100. null when nothing is scored yet. */
  pickedPct: number | null
  isUpset: boolean
}

export interface RecapCard {
  kind: 'recap'
  tournament: CardTournament
  round: string
  roundLabel: string
  /** Rounds that have results, for the admin's round picker. */
  availableRounds: Array<{ round: string; label: string }>
  matches: RecapMatch[]
  bracketCount: number
  podium: PodiumEntry[]
}

export interface PodiumEntry {
  username: string
  points: number
}

export interface CompleteCard {
  kind: 'complete'
  tournament: CardTournament
  champion: CardPlayer | null
  runnerUp: CardPlayer | null
  finalScore: string
  /** Share of brackets that called the champion, 0–100. */
  championPickedPct: number | null
  podium: PodiumEntry[]
  bracketCount: number
}

export type SocialCard = DrawCard | RecapCard | CompleteCard

// ── Country → flag emoji ──────────────────────────────────────────────────────

const NAME_TO_CODE: Record<string, string> = {}
for (const c of COUNTRIES) NAME_TO_CODE[c.name.toLowerCase()] = c.code.toLowerCase()
for (const [alias, code] of Object.entries(ALIASES)) NAME_TO_CODE[alias.toLowerCase()] = code.toLowerCase()

/**
 * Player flags render as emoji rather than <img src="flagcdn…"> like
 * CountryFlag does in the app. Satori resolves remote images by fetching them
 * during render, so a 32-player draw would mean 32 blocking round trips to a
 * third party before a single byte of PNG comes back — and any one of them
 * failing leaves a hole in a card that is about to be posted publicly.
 * Emoji go through the same twemoji path as the tournament flag instead.
 */
export function countryToFlag(nameOrCode: string | null | undefined): string {
  const lower = (nameOrCode ?? '').trim().toLowerCase()
  if (!lower || lower === 'world') return ''
  const code = /^[a-z]{2}$/.test(lower) ? lower : NAME_TO_CODE[lower]
  if (!code) return ''
  return String.fromCodePoint(...[...code.toUpperCase()].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

// ── Internal draw shapes ──────────────────────────────────────────────────────

interface RawDrawPlayer { externalId?: string; name?: string; country?: string; seed?: number }
interface RawDrawMatch { matchId: string; round: string; player1: RawDrawPlayer | null; player2: RawDrawPlayer | null }

interface ResultRow {
  id: string
  round: string
  winner_external_id: string
  loser_external_id: string
  score: string | null
}

/** Chunked so a wide draw never pushes the `.in()` list past the URL length limit. */
const IN_CHUNK = 80

// ── Loader ────────────────────────────────────────────────────────────────────

export async function getSocialCard(
  tournamentId: string,
  kind: CardKind,
  opts: { round?: string } = {},
): Promise<{ ok: true; card: SocialCard } | { ok: false; error: string }> {
  const admin = createAdminClient()

  const [{ data: tRow, error: tErr }, { data: drawRow, error: dErr }, { data: results, error: rErr }] =
    await Promise.all([
      admin
        .from('tournaments')
        .select('id, name, tour, category, surface, location, flag_emoji, starts_at, ends_at, status')
        .eq('id', tournamentId)
        .single(),
      admin.from('draws').select('bracket_data').eq('tournament_id', tournamentId).maybeSingle(),
      admin
        .from('match_results')
        .select('id, round, winner_external_id, loser_external_id, score')
        .eq('tournament_id', tournamentId)
        .limit(500),
    ])

  if (tErr || !tRow) return { ok: false, error: tErr?.message ?? 'Tournament not found' }
  if (dErr) return { ok: false, error: dErr.message }
  if (rErr) return { ok: false, error: rErr.message }

  const tournament: CardTournament = {
    name: tRow.name,
    flagEmoji: tRow.flag_emoji ?? '',
    location: tRow.location ?? '',
    tour: tRow.tour,
    category: tRow.category,
    surface: tRow.surface,
    startsAt: tRow.starts_at,
    endsAt: tRow.ends_at,
  }

  const bracket = (drawRow?.bracket_data ?? null) as { matches?: RawDrawMatch[] } | null
  const drawMatches = bracket?.matches ?? []
  const resultRows = (results ?? []) as ResultRow[]

  // Player identity comes from the draw snapshot, which is authoritative for the
  // names as they were seeded. Qualifiers and lucky losers entered later have no
  // snapshot, so anything a result references but the draw doesn't is filled in
  // from the registry rather than posted as a raw external id.
  const byId = new Map<string, CardPlayer>()
  for (const m of drawMatches) {
    for (const p of [m.player1, m.player2]) {
      if (!p?.externalId || !p.name) continue
      if (!byId.has(p.externalId)) {
        byId.set(p.externalId, { name: p.name, flag: countryToFlag(p.country), seed: p.seed ?? null })
      }
    }
  }

  const missing = [...new Set(resultRows.flatMap(r => [r.winner_external_id, r.loser_external_id]))].filter(
    id => id && !byId.has(id),
  )
  for (let i = 0; i < missing.length; i += IN_CHUNK) {
    const { data: players, error } = await admin
      .from('players')
      .select('external_id, name, country')
      .in('external_id', missing.slice(i, i + IN_CHUNK))
    if (error) console.error('getSocialCard: player lookup failed', error.message)
    for (const p of players ?? []) {
      byId.set(p.external_id, { name: p.name, flag: countryToFlag(p.country), seed: null })
    }
  }

  const player = (id: string): CardPlayer => byId.get(id) ?? { name: id, flag: '', seed: null }

  if (kind === 'draw') {
    const firstRound = ROUND_ORDER.find(r => drawMatches.some(m => m.round === r && m.player1))
    const opening = drawMatches.filter(m => m.round === firstRound)
    if (!opening.length) return { ok: false, error: 'No draw has been published for this tournament yet' }

    const toCard = (p: RawDrawPlayer | null): CardPlayer =>
      p?.name
        ? { name: p.name, flag: countryToFlag(p.country), seed: p.seed ?? null }
        : { name: 'Qualifier', flag: '', seed: null }

    const countries = new Set(
      [...byId.values()].map(p => p.flag).filter(Boolean),
    ).size

    return {
      ok: true,
      card: {
        kind: 'draw',
        tournament,
        drawSize: opening.length * 2,
        countries,
        opening: opening.slice(0, 6).map(m => ({ a: toCard(m.player1), b: toCard(m.player2) })),
      },
    }
  }

  // Both remaining cards report against scored results.
  // Widened to string[]: ROUND_ORDER is `as const`, and the narrow literal union
  // it produces would reject the untrusted `opts.round` coming off a query param.
  const roundsWithResults: string[] = ROUND_ORDER.filter(r => resultRows.some(x => x.round === r))
  const availableRounds = roundsWithResults.map(r => ({ round: r, label: ROUND_LABEL[r] ?? r }))

  const [bracketCount, podium] = await Promise.all([
    countBrackets(admin, tournamentId),
    loadPodium(admin, tournamentId),
  ])

  if (kind === 'recap') {
    const round = opts.round && roundsWithResults.includes(opts.round)
      ? opts.round
      : roundsWithResults[roundsWithResults.length - 1]
    if (!round) return { ok: false, error: 'No results have been entered for this tournament yet' }

    const rows = resultRows.filter(r => r.round === round)
    const pickCounts = await loadPickCounts(admin, tournamentId, rows.map(r => r.id))

    const matches: RecapMatch[] = rows.map(r => ({
      winner: player(r.winner_external_id),
      loser: player(r.loser_external_id),
      score: r.score ?? '',
      pickedPct: pct(pickCounts, r.id, bracketCount),
      isUpset: false,
    }))

    // "Upset" is measured against the rest of the round, never against a fixed
    // percentage. Pick rates fall structurally as a tournament progresses — to
    // call a quarterfinal you had to have the winner surviving three earlier
    // rounds — so real Wimbledon quarterfinals score 0–9% across the board. An
    // absolute threshold (the first version used 35%) brands every late match an
    // upset, which is the same as branding none of them.
    //
    // Comparing to the round's own median self-normalises: it asks "was this
    // match unusual *for this stage*", which is the actual claim being made.
    const scored = matches.filter(m => m.pickedPct != null)
    if (scored.length >= 3) {
      const rates = scored.map(m => m.pickedPct as number).sort((a, b) => a - b)
      const median = rates[Math.floor(rates.length / 2)]
      const lowest = rates[0]
      // A round of one or two matches has no "normal" to deviate from, hence the
      // length guard above; a zero median means nobody called anything, so there
      // is no standout to point at either.
      if (median > 0 && lowest <= median * 0.5) {
        const target = matches.find(m => m.pickedPct === lowest)
        if (target) target.isUpset = true
      }
    }

    return {
      ok: true,
      card: {
        kind: 'recap',
        tournament,
        round,
        roundLabel: ROUND_LABEL[round] ?? round,
        availableRounds,
        matches,
        bracketCount,
        podium,
      },
    }
  }

  // kind === 'complete'
  const final = resultRows.find(r => r.round === 'F')
  if (!final) return { ok: false, error: 'No final result has been entered for this tournament yet' }

  const championCounts = await loadPickCounts(admin, tournamentId, [final.id])

  return {
    ok: true,
    card: {
      kind: 'complete',
      tournament,
      champion: player(final.winner_external_id),
      runnerUp: player(final.loser_external_id),
      finalScore: final.score ?? '',
      championPickedPct: pct(championCounts, final.id, bracketCount),
      podium,
      bracketCount,
    },
  }
}

// ── Aggregates ────────────────────────────────────────────────────────────────

/**
 * Percentages are only ever computed from a lookup that actually succeeded.
 *
 * The first version of this took `number | undefined` and treated a missing
 * count as zero. With migration 074 not yet applied, that rendered "UPSET —
 * only 0% of brackets called it" across the Wimbledon final: a fabricated
 * statistic, on a card whose entire purpose is to be published. A null map
 * (lookup failed) and an absent key (nobody called it) are different facts, and
 * only the second one is safe to print.
 *
 * Below MIN_SAMPLE the percentage is suppressed too — "0% of 3 brackets" is
 * noise being dressed up as a finding.
 */
const MIN_SAMPLE = 10

function pct(counts: Map<string, number> | null, matchId: string, total: number): number | null {
  if (!counts || total < MIN_SAMPLE) return null
  return Math.round(((counts.get(matchId) ?? 0) / total) * 100)
}

type Admin = ReturnType<typeof createAdminClient>

/**
 * Global brackets for the tournament — the denominator for every percentage.
 * A head count, so the row cap never applies no matter how many users enter.
 */
async function countBrackets(admin: Admin, tournamentId: string): Promise<number> {
  const { count, error } = await admin
    .from('predictions')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)
  if (error) {
    console.error('countBrackets error:', error.message)
    return 0
  }
  return count ?? 0
}

/** Top 3 global brackets. Bounded by LIMIT, so it stays flat as the app grows. */
async function loadPodium(admin: Admin, tournamentId: string): Promise<PodiumEntry[]> {
  const { data, error } = await admin
    .from('predictions')
    .select('points_earned, users!inner(username)')
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)
    .gt('points_earned', 0)
    .order('points_earned', { ascending: false })
    .limit(3)

  if (error) {
    console.error('loadPodium error:', error.message)
    return []
  }
  return (data ?? []).map(r => ({
    username: (r.users as unknown as { username: string }).username,
    points: r.points_earned ?? 0,
  }))
}

/**
 * match_result_id → number of global brackets that called it. See migration 074.
 *
 * Returns null — not an empty map — when the lookup fails, so callers cannot
 * mistake "the RPC is missing" for "nobody picked this". See pct() above.
 */
async function loadPickCounts(
  admin: Admin,
  tournamentId: string,
  matchIds: string[],
): Promise<Map<string, number> | null> {
  if (!matchIds.length) return new Map()

  const { data, error } = await admin.rpc('social_match_pick_counts', {
    t_id: tournamentId,
    m_ids: matchIds,
  })
  if (error) {
    console.error('loadPickCounts error:', error.message)
    return null
  }

  const out = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ match_result_id: string; correct_count: number }>) {
    out.set(row.match_result_id, Number(row.correct_count))
  }
  return out
}
