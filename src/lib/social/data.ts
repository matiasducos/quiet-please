import { createAdminClient } from '@/lib/supabase/admin'
import { ROUND_ORDER, ROUND_LABEL } from '@/lib/tennis/my-tournament'
import { buildFeedMap, buildReverseFeedMap, getFeederMatchId, isByeMatch } from '@/lib/tennis/bracket'
import type { DrawMatch } from '@/lib/tennis/types'
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

/** In the order a tournament reaches them. */
export const CARD_KINDS = ['draw', 'upcoming', 'recap', 'complete', 'stats'] as const
export type CardKind = (typeof CARD_KINDS)[number]

export const CARD_LABEL: Record<CardKind, string> = {
  draw: 'Draw published',
  upcoming: 'Up next',
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

/** A first-round tie the admin can put on the draw card. */
export interface DrawMatchOption {
  /** The draw's `matchId` — the handle the admin's match picker selects on. */
  id: string
  a: CardPlayer
  b: CardPlayer
}

export interface DrawCard {
  kind: 'draw'
  tournament: CardTournament
  /**
   * People in the draw, not the bracket size — byes are empty slots and are not
   * counted. A 64-bracket with 8 byes reports 56.
   */
  entrants: number
  /**
   * Every playable first-round tie, in draw-sheet order — not just the ones on
   * the card. See RecapCard.matches for why the whole round travels: the studio
   * lists these for the admin to choose from and the template shows whichever
   * ones `selectedIds` names, so the picker and the render agree by construction.
   *
   * Deliberately not filtered to seeded players: no draw in this database
   * carries a `seed` (the builder never collects one), so a seeds-only list
   * renders empty. Draw order is the available proxy — match 1 is the top of the
   * sheet, which is what the card falls back to when nothing is selected.
   */
  matches: DrawMatchOption[]
  /** Ids the admin chose to feature. null means "whatever fits, from the top". */
  selectedIds: string[] | null
}

/**
 * A tie that has not been played yet, with what the field makes of it.
 *
 * `sample` is the number of brackets carrying a pick on THIS match, and it is
 * the denominator behind `pickedPct` — never the tournament's bracket count. The
 * two are not close: brackets are abandoned round by round, so a quarterfinal
 * routinely has an order of magnitude fewer picks than the tournament has
 * entries. See migration 077, and `canQuotePct` in recap-types for the same
 * discipline applied to the recap.
 */
export interface UpcomingMatch {
  /**
   * The draw's `matchId` — the handle the admin's match picker selects on.
   *
   * Note this is NOT a match_results id like RecapMatch.id: the match has no
   * result row yet, by definition. It is the same string that keys
   * `predictions.picks`, which is what makes the pick lookup possible at all.
   */
  id: string
  a: CardPlayer
  b: CardPlayer
  /**
   * The two players' external ids.
   *
   * The card never renders them; the points email compares them against a
   * recipient's stored pick, which is a player id rather than a side. Carried
   * here rather than re-derived because the walk that resolves who is in an
   * unplayed tie is the expensive part, and it has just been done.
   */
  aId: string
  bId: string
  /**
   * The side more brackets are on. null when no bracket has picked this match —
   * which is the normal state for a round the field has not reached yet, and
   * must read as silence rather than as a 0% for either player.
   */
  favourite: {
    player: CardPlayer
    /** Brackets on this player. A head count, always safe to print. */
    count: number
    /** Their share of `sample`, or null when the sample is too small to quote. */
    pct: number | null
  } | null
  /** Brackets with a pick on this match. */
  sample: number
}

export interface UpcomingCard {
  kind: 'upcoming'
  tournament: CardTournament
  round: string
  roundLabel: string
  /** Rounds with at least one playable unplayed match, for the admin's picker. */
  availableRounds: Array<{ round: string; label: string }>
  /** Every pending match in the round, in draw order — see RecapCard.matches. */
  matches: UpcomingMatch[]
  /** Ids the admin chose to feature. null means "whatever fits, from the top". */
  selectedIds: string[] | null
  bracketCount: number
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

/**
 * One user's bracket, as a story card.
 *
 * Not in CARD_KINDS: those are the admin studio's tournament-wide posts, built
 * by getSocialCard from a tournament id. This one is built per person by
 * getPicksCard and rendered by a public route, so listing it there would put an
 * unbuildable option in the studio's picker.
 */
export interface PicksCard {
  kind: 'picks'
  tournament: CardTournament
  username: string
  /** Pick for the Final. Null when the bracket stops short of it. */
  champion: CardPlayer | null
  /** Rounds below the final, deepest first, already labelled. */
  groups: Array<{ label: string; players: CardPlayer[] }>
  /** Null until the tournament has a result — see getPicksCard. */
  points: number | null
  rank: number | null
  /** Printed on the card, because Instagram drops shared text. */
  shareUrl: string
}

export type SocialCard = DrawCard | UpcomingCard | RecapCard | CompleteCard | StatsCard | PicksCard

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
export interface RawDrawMatch { matchId: string; round: string; player1: RawDrawPlayer | null; player2: RawDrawPlayer | null }

interface ResultRow {
  id: string
  /**
   * The draw's matchId. `saveMatchResult` writes the two as the same string,
   * which is what lets a result be traced back to its slot in the bracket —
   * `pendingMatches` walks winners forward on it.
   */
  external_match_id: string | null
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

// ── Pending matches ───────────────────────────────────────────────────────────

/** A tie both of whose players are known and which has no result yet. */
export interface PendingMatch {
  /** The draw's matchId. */
  id: string
  round: string
  aId: string
  bId: string
}

/** Just enough of a result row to advance a player. */
export interface WinnerRow {
  external_match_id: string | null
  winner_external_id: string | null
}

/**
 * Which matches are still to be played, and who is in them.
 *
 * Pure, and exported, because two callers need the answer and a second
 * implementation would drift: `getSocialCard` builds the card from it, and the
 * studio page decides whether to offer the "Up next" tab at all. Same reasoning
 * as `listUpcomingMatches` going through `getSocialCard` rather than querying
 * directly — the tab, the picker and the PNG have to agree about what "up next"
 * means.
 *
 * The work is real rather than a filter, because a draw snapshot does not know
 * its own future: `bracket_data` is written once when the draw is published, so
 * every match past round one has two null slots and stays that way forever. Who
 * plays in a quarterfinal is only derivable by walking results forward through
 * the positional feed map — the same walk `generateAutoPicks` does, and the same
 * one a user's bracket does on screen.
 *
 * Two sources fill a slot, and both are needed:
 *  - a bye, which is a draw match with one null slot and advances for free
 *  - a result, keyed by the draw's matchId (`saveMatchResult` writes
 *    `external_match_id: matchId`, so the two are the same string)
 */
export function pendingMatches(drawMatches: RawDrawMatch[], results: WinnerRow[]): PendingMatch[] {
  if (!drawMatches.length) return []

  // The bracket helpers are typed against DrawMatch, whose `round` is a narrow
  // union and whose players carry more fields than the snapshot guarantees. The
  // shapes agree on everything these functions actually read — matchId, round,
  // player1/player2 nullness — and the feed map is positional, so it touches no
  // player field at all.
  const typed = drawMatches as unknown as DrawMatch[]
  const reverse = buildReverseFeedMap(buildFeedMap(typed))

  // matchId → whoever came through it.
  const winners: Record<string, string> = {}
  for (const m of typed) {
    if (!isByeMatch(m)) continue
    const advancing = m.player1 ?? m.player2
    if (advancing?.externalId) winners[m.matchId] = advancing.externalId
  }
  for (const r of results) {
    // A bye recorded as a result carries the advancing player as its winner, so
    // it is kept here — unlike the card-facing lists, which drop byes because
    // "A. Zverev d. bye" is not a match. What must never land in this map is the
    // literal 'bye' id itself as a winner.
    if (!r.external_match_id || !r.winner_external_id || isByeId(r.winner_external_id)) continue
    winners[r.external_match_id] = r.winner_external_id
  }

  const slot = (m: DrawMatch, which: 'player1' | 'player2'): string | null => {
    const direct = m[which]
    if (direct?.externalId) return direct.externalId
    const feeder = getFeederMatchId(m.matchId, which, reverse)
    return feeder ? winners[feeder] ?? null : null
  }

  const out: PendingMatch[] = []
  for (const m of typed) {
    // Played, or a bye that resolved itself. Either way there is nothing to come.
    if (winners[m.matchId]) continue
    const aId = slot(m, 'player1')
    const bId = slot(m, 'player2')
    // A half-known tie ("Sinner v TBD") is dropped rather than shown: the round
    // below it is still being played, so the card would be advertising a fixture
    // that does not exist yet.
    if (!aId || !bId) continue
    out.push({ id: m.matchId, round: m.round, aId, bId })
  }
  return out
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
        .select('id, external_match_id, round, winner_external_id, loser_external_id, score')
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

    // Only ties that will actually be played — "J. Sinner v Bye" is not a
    // matchup worth putting on a story, or offering the admin as a choice.
    const matches: DrawMatchOption[] = firstRoundMatches
      .filter(m => m.player1 != null && m.player2 != null)
      .map(m => ({ id: m.matchId, a: toCard(m.player1), b: toCard(m.player2) }))

    // Same contract as the recap and up-next cards: an id that is not in this
    // draw is dropped rather than honoured, since the param is user-supplied and
    // a stale one would otherwise render an empty card. Draw order is preserved
    // — the admin picks *which* matches appear, not what order they read in.
    const inDraw = new Set(matches.map(m => m.id))
    const requested = (opts.matchIds ?? []).filter(id => inDraw.has(id))

    return {
      ok: true,
      card: {
        kind: 'draw',
        tournament,
        entrants,
        matches,
        selectedIds: opts.matchIds ? requested : null,
      },
    }
  }

  if (kind === 'upcoming') {
    // Raw results, not the bye-filtered list: a bye row carries the player who
    // advanced through it, and dropping it would leave their next match looking
    // half-empty. pendingMatches guards the literal 'bye' winner id itself.
    const pending = pendingMatches(drawMatches, (results ?? []) as ResultRow[])
    if (!pending.length) {
      return {
        ok: false,
        error: drawMatches.length
          ? 'Every match with two known players has a result. Enter the next round’s draw or wait for results.'
          : 'No draw has been published for this tournament yet',
      }
    }

    const roundsPending: string[] = ROUND_ORDER.filter(r => pending.some(m => m.round === r))
    // The earliest round still to be played is the default, not the latest: "up
    // next" means the matches about to happen, and a later round with two known
    // players only exists because someone got a bye into it.
    const round = opts.round && roundsPending.includes(opts.round) ? opts.round : roundsPending[0]
    const rows = pending.filter(m => m.round === round)

    const pickCounts = await loadUpcomingPickCounts(admin, tournamentId, rows.map(m => m.id))

    const matches: UpcomingMatch[] = rows.map(m => {
      const a = player(m.aId)
      const b = player(m.bId)
      const perMatch = pickCounts?.get(m.id)
      const aCount = perMatch?.get(m.aId) ?? 0
      const bCount = perMatch?.get(m.bId) ?? 0
      // Only picks naming one of the two players count. A bracket whose slot
      // holds someone the draw has since overtaken is a stale pick, not a vote
      // for either of these two, and including it in the denominator would
      // shrink both shares by a made-up amount.
      const sample = aCount + bCount

      // A dead heat is broken by external id rather than left to Map order, so
      // re-rendering the same card twice cannot swap which player it names.
      const aLeads = aCount > bCount || (aCount === bCount && m.aId <= m.bId)
      const count = aLeads ? aCount : bCount

      return {
        id: m.id,
        a,
        b,
        aId: m.aId,
        bId: m.bId,
        // No picks at all is silence, not a 50/50: printing "50% have Sinner"
        // off zero brackets invents a consensus that does not exist.
        favourite:
          pickCounts && sample > 0
            ? {
                player: aLeads ? a : b,
                count,
                // Suppressed below MIN_SAMPLE, exactly as pct() does for played
                // matches — the head count survives, the percentage does not.
                pct: sample >= MIN_SAMPLE ? Math.round((count / sample) * 100) : null,
              }
            : null,
        sample,
      }
    })

    // Same contract as the recap card: an id that is not in this round is
    // dropped rather than honoured, since the param is user-supplied and a stale
    // one would otherwise render an empty card.
    const inRound = new Set(matches.map(m => m.id))
    const requested = (opts.matchIds ?? []).filter(id => inRound.has(id))

    return {
      ok: true,
      card: {
        kind: 'upcoming',
        tournament,
        round,
        roundLabel: ROUND_LABEL[round] ?? round,
        availableRounds: roundsPending.map(r => ({ round: r, label: ROUND_LABEL[r] ?? r })),
        matches,
        selectedIds: opts.matchIds ? requested : null,
        bracketCount: await countBrackets(admin, tournamentId),
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

/**
 * draw matchId → (player externalId → brackets on them). See migration 077.
 *
 * Null on failure, for the same reason loadPickCounts is: 077 is a manual
 * migration like every other one here, and until it is applied the RPC does not
 * exist. A null map degrades the card to a plain fixture list — players, flags,
 * seeds — which is honest. An empty map would instead claim that not one bracket
 * in the field has picked the next round, which is a much louder statement and
 * would be false.
 */
async function loadUpcomingPickCounts(
  admin: Admin,
  tournamentId: string,
  matchIds: string[],
): Promise<Map<string, Map<string, number>> | null> {
  if (!matchIds.length) return new Map()

  const { data, error } = await admin.rpc('social_upcoming_pick_counts', {
    t_id: tournamentId,
    m_ids: matchIds,
  })
  if (error) {
    console.error('loadUpcomingPickCounts error:', error.message)
    return null
  }

  const out = new Map<string, Map<string, number>>()
  for (const row of (data ?? []) as Array<{ external_match_id: string; picked_id: string; pick_count: number }>) {
    let byPlayer = out.get(row.external_match_id)
    if (!byPlayer) {
      byPlayer = new Map()
      out.set(row.external_match_id, byPlayer)
    }
    byPlayer.set(row.picked_id, Number(row.pick_count))
  }
  return out
}
