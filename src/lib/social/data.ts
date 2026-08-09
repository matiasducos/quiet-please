import { createAdminClient } from '@/lib/supabase/admin'
import { ROUND_ORDER, ROUND_LABEL } from '@/lib/tennis/my-tournament'
import { COUNTRIES, ALIASES } from '@/app/admin/countries'
import { getRecap } from '@/lib/tournaments/recap'
import { cardHighlights } from '@/lib/tournaments/recap-types'
import type { Highlight } from '@/lib/tournaments/recap-types'

/**
 * Data behind the admin social cards.
 *
 * Everything here runs with the service-role client: the cards aggregate across
 * all users (pick rates, the tournament podium), which no session-scoped query
 * could see through RLS, and the only caller is an admin-guarded route.
 */

// ── Card kinds ────────────────────────────────────────────────────────────────

export const CARD_KINDS = ['draw', 'recap', 'complete', 'stats'] as const
export type CardKind = (typeof CARD_KINDS)[number]

export const CARD_LABEL: Record<CardKind, string> = {
  draw: 'Draw published',
  recap: 'Round recap',
  complete: 'Champion',
  stats: 'Tournament recap',
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
  /**
   * People in the draw, not the bracket size — byes are empty slots and are not
   * counted. A 64-bracket with 8 byes reports 56.
   */
  entrants: number
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
  /** match_results.id — the handle the admin's match picker selects on. */
  id: string
  winner: CardPlayer
  loser: CardPlayer
  score: string
  /**
   * Global brackets that called it. null means *unknown* — the lookup failed, or
   * there are no brackets to count — and must never be shown as 0. See pct().
   */
  pickedCount: number | null
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
  /**
   * Every match in the round, in draw order — not just the ones on the card.
   * The studio lists these for the admin to choose from, and the template shows
   * whichever ones `selectedIds` names, so the picker and the render agree by
   * construction rather than by two matching slices.
   */
  matches: RecapMatch[]
  /** Ids the admin chose to feature. null means "whatever fits, from the top". */
  selectedIds: string[] | null
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

/**
 * The end-of-tournament stats card.
 *
 * Reads the STORED recap (migration 076) rather than recomputing anything. Two
 * reasons, and the second is the important one: the aggregation expands every
 * bracket's picks and has no business running behind an image request — but
 * more than that, a card built from a second implementation could contradict
 * the recap page it is advertising. Same row, same numbers.
 *
 * `lines` comes from `cardHighlights()`, which is also what the web cards
 * render. That is deliberate: every percentage it emits has already passed the
 * sample check, so this card cannot publish "67% backed them" off three
 * brackets — the failure mode that matters most on something posted publicly.
 */
export interface StatsCard {
  kind: 'stats'
  tournament: CardTournament
  /** Pre-formatted, pre-gated stat lines, most newsworthy first. */
  lines: Highlight[]
  bracketCount: number
  picksMade: number
  podium: PodiumEntry[]
}

export type SocialCard = DrawCard | RecapCard | CompleteCard | StatsCard

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

/**
 * A bye is not a player and a walkover is not a match.
 *
 * The two are stored differently, which is easy to get backwards:
 *  - In the draw, a bye is a **null slot** (DrawBuilder maps 'BYE' → null).
 *    A qualifier placeholder is the opposite — a real object, `{ externalId:
 *    'qualifier-N', name: 'Qualifier' }`.
 *  - In match_results, a bye is a row whose loser is the literal id 'bye' with
 *    score 'BYE'. There are 197 such rows across the database, so a Masters
 *    R128 recap without this filter is mostly "A. Zverev d. bye".
 */
const BYE_ID = 'bye'

function isByeId(id: string | null | undefined): boolean {
  return (id ?? '').trim().toLowerCase() === BYE_ID
}

function isQualifierSlot(p: RawDrawPlayer | null | undefined): boolean {
  return !!p && (p.name === 'Qualifier' || String(p.externalId ?? '').startsWith('qualifier-'))
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function getSocialCard(
  tournamentId: string,
  kind: CardKind,
  opts: { round?: string; matchIds?: string[] } = {},
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

  // Walkovers are dropped once, here, so every consumer below is automatically
  // bye-free: the round list, the recap, the pick-rate lookup and the final.
  const resultRows = ((results ?? []) as ResultRow[]).filter(
    r => !isByeId(r.winner_external_id) && !isByeId(r.loser_external_id),
  )

  // The stats card returns here, before the player resolution below.
  //
  // It needs none of it: every name it prints is already baked into the stored
  // payload, resolved against the registry at build time. Falling through would
  // mean up to seven `.in()` lookups to decorate players this card never names.
  if (kind === 'stats') {
    const recap = await getRecap(tournamentId)
    if (!recap) {
      return {
        ok: false,
        error: 'No recap stored yet. It is built when the tournament completes — use "Rebuild recap" on the results page to build one now.',
      }
    }
    const p = recap.payload
    return {
      ok: true,
      card: {
        kind: 'stats',
        tournament,
        // Four rather than the web card's three: a 1080-wide canvas has room,
        // and gating means a thin tournament simply yields fewer.
        lines: cardHighlights(p, 4),
        bracketCount: p.participation?.brackets ?? 0,
        picksMade: p.participation?.picks_made ?? 0,
        podium: (p.podium ?? []).map(e => ({ username: e.username, points: e.points })),
      },
    }
  }

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

  // Every id the card might name, resolved against the live registry — not just
  // the ones the draw snapshot is missing.
  //
  // Two cases need this. A player who entered after the draw was built (a lucky
  // loser, or a qualifier who came through) appears only in the results, so the
  // draw has no snapshot at all; those really are the numeric registry ids —
  // '12951' is J. Fearnley. And a name corrected in the registry after the draw
  // was built would otherwise stay stale on the card forever, because the
  // snapshot is a copy. Refreshing keeps posts current without changing which
  // player an id refers to.
  //
  // The one thing this cannot repair is a `qualifier-N` placeholder: it has no
  // registry row by construction, so a slot still reading "Qualifier" means the
  // draw itself has not been updated yet.
  const knownIds = new Set<string>([
    ...byId.keys(),
    ...resultRows.flatMap(r => [r.winner_external_id, r.loser_external_id]),
  ])
  const lookupIds = [...knownIds].filter(id => id && !id.startsWith('qualifier-'))

  for (let i = 0; i < lookupIds.length; i += IN_CHUNK) {
    const { data: players, error } = await admin
      .from('players')
      .select('external_id, name, country')
      .in('external_id', lookupIds.slice(i, i + IN_CHUNK))
    if (error) console.error('getSocialCard: player lookup failed', error.message)
    for (const p of players ?? []) {
      // Keep the seed, which is draw data the registry has no opinion on.
      byId.set(p.external_id, {
        name: p.name,
        flag: countryToFlag(p.country),
        seed: byId.get(p.external_id)?.seed ?? null,
      })
    }
  }

  const player = (id: string): CardPlayer => byId.get(id) ?? { name: id, flag: '', seed: null }

  if (kind === 'draw') {
    const firstRound = ROUND_ORDER.find(r => drawMatches.some(m => m.round === r && m.player1))
    const firstRoundMatches = drawMatches.filter(m => m.round === firstRound)
    if (!firstRoundMatches.length) {
      return { ok: false, error: 'No draw has been published for this tournament yet' }
    }

    const slots = firstRoundMatches.flatMap(m => [m.player1, m.player2])

    // Entrants, not bracket size. A 64-draw with 8 byes has 56 people in it, and
    // "64 players in the draw" would be a false claim on a public post. A
    // qualifier placeholder is still a person who will play, so it counts; a
    // null slot is a bye and does not.
    const entrants = slots.filter(p => p != null).length

    // A snapshot name is only a fallback: prefer the registry entry, so a
    // qualifier resolved (or a name fixed) after the draw was built shows up.
    const toCard = (p: RawDrawPlayer | null): CardPlayer => {
      if (!p) return { name: 'Bye', flag: '', seed: null }
      const resolved = p.externalId ? byId.get(p.externalId) : undefined
      if (resolved && !isQualifierSlot(p)) return { ...resolved, seed: p.seed ?? resolved.seed }
      return {
        name: p.name || 'Qualifier',
        flag: countryToFlag(p.country),
        seed: p.seed ?? null,
      }
    }

    const countries = new Set([...byId.values()].map(p => p.flag).filter(Boolean)).size

    return {
      ok: true,
      card: {
        kind: 'draw',
        tournament,
        entrants,
        countries,
        // Only ties that will actually be played — "J. Sinner v Bye" is not a
        // matchup worth putting on a story.
        opening: firstRoundMatches
          .filter(m => m.player1 != null && m.player2 != null)
          .slice(0, 6)
          .map(m => ({ a: toCard(m.player1), b: toCard(m.player2) })),
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
      id: r.id,
      winner: player(r.winner_external_id),
      loser: player(r.loser_external_id),
      score: r.score ?? '',
      pickedCount: count(pickCounts, r.id, bracketCount),
      pickedPct: pct(pickCounts, r.id, bracketCount),
      isUpset: false,
    }))

    // An id that is not in this round is dropped rather than honoured: the param
    // is user-supplied, and a stale one (the admin switched rounds with a
    // selection still in the URL) would otherwise select nothing and render an
    // empty card. Draw order is preserved — the admin picks *which* matches
    // appear, not what order they read in.
    const inRound = new Set(matches.map(m => m.id))
    const requested = (opts.matchIds ?? []).filter(id => inRound.has(id))
    const selectedIds = opts.matchIds ? requested : null

    // "Upset" is measured against the rest of the round, never against a fixed
    // percentage. Pick rates fall structurally as a tournament progresses — to
    // call a quarterfinal you had to have the winner surviving three earlier
    // rounds — so real Wimbledon quarterfinals score 0–9% across the board. An
    // absolute threshold (the first version used 35%) brands every late match an
    // upset, which is the same as branding none of them.
    //
    // Comparing to the round's own median self-normalises: it asks "was this
    // match unusual *for this stage*", which is the actual claim being made.
    //
    // Note this runs over the whole round, before the admin's selection is
    // applied. The claim is about the round, so narrowing the sample to the
    // three matches someone chose to feature would make the badge mean something
    // different depending on what else was ticked.
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
        selectedIds,
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

/**
 * The raw head count behind pct(), which every featured match now prints.
 *
 * MIN_SAMPLE deliberately does *not* apply. "0% of 3 brackets" is a statistic
 * with no sample behind it, which is why pct() suppresses it; "1 bracket called
 * it" is a head count, and a head count is exactly as true at three brackets as
 * at three thousand.
 *
 * The two conditions that do suppress it are the ones where the number is
 * unknown rather than small: a failed lookup (null map), and a tournament with
 * no global brackets at all — there, "No bracket called it" would imply a field
 * that got it wrong instead of a field that does not exist.
 */
function count(counts: Map<string, number> | null, matchId: string, total: number): number | null {
  if (!counts || total === 0) return null
  return counts.get(matchId) ?? 0
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
