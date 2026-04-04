'use server'

import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient, listAllUsers } from '@/lib/supabase/admin'
import { COUNTRIES, codeToFlag } from './countries'

/** Look up a country name and return its flag emoji, or null if not found. */
function flagForCountry(countryName: string): string | null {
  const trimmed = countryName.trim().toLowerCase()
  const match = COUNTRIES.find(c => c.name.toLowerCase() === trimmed)
  return match ? codeToFlag(match.code) : null
}

// ── Auth guard ────────────────────────────────────────────────────────────────

// Cache admin IDs at module level — parsed once per cold start, not per request
const ADMIN_IDS = new Set(
  (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
)

async function assertAdmin() {
  if (process.env.NODE_ENV === 'development') return
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  if (!ADMIN_IDS.has(user.id)) throw new Error('Forbidden')
}

function getBaseUrl(): string {
  // In dev: localhost. In prod: use NEXT_PUBLIC_BASE_URL or VERCEL_URL.
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

// ── Test notifications ────────────────────────────────────────────────────────

import type { NotificationType } from './constants'

export async function sendTestNotification(
  type: NotificationType,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()
  try {
    const allUsers = await listAllUsers(admin)
    if (!allUsers.length) return { ok: true, count: 0 }

    const meta: Record<string, unknown> = {
      test:                true,
      tournament_name:     'Test Tournament',
      challenger_username: 'test_user',
      from_username:       'test_user',
      friend_username:     'test_user',
      username:            'test_user',
      points:              100,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = allUsers.map((u: any) => ({
      user_id: u.id,
      type,
      meta,
    }))

    const { error } = await admin.from('notifications').insert(rows)
    if (error) return { ok: false, error: error.message }
    return { ok: true, count: allUsers.length }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// ── Cron trigger ──────────────────────────────────────────────────────────────

export async function triggerCron(key: string): Promise<{ ok: boolean; data: unknown }> {
  await assertAdmin()
  const cronSecret = process.env.CRON_SECRET
  const headers: Record<string, string> = cronSecret
    ? { Authorization: `Bearer ${cronSecret}` }
    : {}
  try {
    const res = await fetch(`${getBaseUrl()}/api/cron/${key}`, {
      headers,
      cache: 'no-store',
      // Give cron routes enough time; still bounded by the Vercel function limit.
      signal: AbortSignal.timeout(55_000),
    })
    const data = await res.json().catch(() => ({ error: 'Non-JSON response' }))
    return { ok: res.ok, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, data: { error: message } }
  }
}

// ── Tournament status override ────────────────────────────────────────────────

const VALID_STATUSES = ['upcoming', 'accepting_predictions', 'in_progress', 'completed'] as const
type ValidStatus = typeof VALID_STATUSES[number]

export async function setTournamentStatus(
  tournamentId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  if (!VALID_STATUSES.includes(status as ValidStatus)) {
    return { ok: false, error: `Invalid status "${status}"` }
  }
  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .update({ status })
    .eq('id', tournamentId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Tournament delete ─────────────────────────────────────────────────────────

export async function deleteTournament(
  tournamentId: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .delete()
    .eq('id', tournamentId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Tournament details update ─────────────────────────────────────────────────

const VALID_SURFACES = ['hard', 'clay', 'grass'] as const

export async function updateTournamentDetails(
  tournamentId: string,
  fields: {
    surface?: string | null
    starts_at?: string | null
    ends_at?: string | null
    draw_close_at?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()

  const update: Record<string, unknown> = {}

  if ('surface' in fields) {
    const s = fields.surface
    if (s && !VALID_SURFACES.includes(s as typeof VALID_SURFACES[number])) {
      return { ok: false, error: `Invalid surface "${s}"` }
    }
    update.surface = s ?? null
  }
  if ('starts_at' in fields) {
    update.starts_at   = fields.starts_at ?? null
    // Keep denormalized starts_year in sync — used by the (external_id, starts_year) unique index
    update.starts_year = fields.starts_at ? new Date(fields.starts_at).getUTCFullYear() : null
  }
  if ('ends_at' in fields)       update.ends_at       = fields.ends_at       ?? null
  if ('draw_close_at' in fields) update.draw_close_at = fields.draw_close_at ?? null

  if (Object.keys(update).length === 0) return { ok: false, error: 'Nothing to update' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .update(update)
    .eq('id', tournamentId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Manual draw entry ─────────────────────────────────────────────────────────
// Used when the tennis API cannot supply draw data.
// Player externalIds are normalized name slugs ("Carlos Alcaraz" → "carlos-alcaraz").
// For scoring to work, manual results must use the same player name normalization.

const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']

/** Normalize a player name to a stable slug used as their externalId. */
function normalizePlayerId(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics (é→e, ñ→n, ü→u …)
    .replace(/[^a-z0-9\s]/g, '')      // keep letters, digits, spaces
    .trim()
    .replace(/\s+/g, '-')             // spaces → dashes
}

export interface ManualMatch {
  player1Name: string
  player1Seed?: number | null
  player1Country?: string
  player2Name: string
  player2Seed?: number | null
  player2Country?: string
}

/**
 * Save a manually-entered draw for a tournament.
 * Builds the full bracket: named player matches for `firstRound`, then TBD
 * matches for every subsequent round (QF/SF/F etc.) which fill in from picks.
 */
export async function saveManualDraw(
  tournamentId: string,
  externalId: string,
  firstRound: string,
  matches: ManualMatch[],
  openPredictions: boolean,
): Promise<{ ok: boolean; error?: string; matchCount?: number }> {
  await assertAdmin()
  if (!matches.length) return { ok: false, error: 'No matches provided' }

  const startIdx = ROUND_ORDER.indexOf(firstRound)
  if (startIdx === -1) return { ok: false, error: `Unknown round "${firstRound}"` }

  const rounds = ROUND_ORDER.slice(startIdx)
  const allMatches: Record<string, unknown>[] = []

  // First round — named players
  matches.forEach((m, i) => {
    const idx = String(i + 1).padStart(3, '0')
    allMatches.push({
      matchId: `${externalId}-${firstRound}-${idx}`,
      round: firstRound,
      player1: m.player1Name.trim() ? {
        externalId: normalizePlayerId(m.player1Name),
        name:       m.player1Name.trim(),
        country:    (m.player1Country ?? '').trim(),
        ...(m.player1Seed != null ? { seed: m.player1Seed } : {}),
      } : null,
      player2: m.player2Name.trim() ? {
        externalId: normalizePlayerId(m.player2Name),
        name:       m.player2Name.trim(),
        country:    (m.player2Country ?? '').trim(),
        ...(m.player2Seed != null ? { seed: m.player2Seed } : {}),
      } : null,
    })
  })

  // Subsequent rounds — TBD (null players; bracket fills in from picks)
  let prevCount = matches.length
  for (let ri = 1; ri < rounds.length; ri++) {
    const round = rounds[ri]
    const count = Math.ceil(prevCount / 2)
    for (let i = 0; i < count; i++) {
      allMatches.push({
        matchId: `${externalId}-${round}-${String(i + 1).padStart(3, '0')}`,
        round,
        player1: null,
        player2: null,
      })
    }
    prevCount = count
  }

  const draw = { tournamentExternalId: externalId, rounds, matches: allMatches }
  const admin = createAdminClient()

  const { error: drawError } = await admin
    .from('draws')
    .upsert(
      { tournament_id: tournamentId, bracket_data: draw as unknown, synced_at: new Date().toISOString() },
      { onConflict: 'tournament_id' },
    )
  if (drawError) return { ok: false, error: drawError.message }

  // Bust the ISR cache so tournament detail pages refresh immediately
  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')

  if (openPredictions) {
    await admin
      .from('tournaments')
      .update({ status: 'accepting_predictions' })
      .eq('id', tournamentId)

    // Notify all users that predictions are now open
    try {
      const { data: t } = await admin
        .from('tournaments')
        .select('name, location, flag_emoji, draw_close_at')
        .eq('id', tournamentId)
        .single()
      const allUsers = await listAllUsers(admin)
      if (allUsers.length > 0 && t) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = allUsers.map((u: any) => ({
          user_id:       u.id,
          type:          'draw_open',
          tournament_id: tournamentId,
          meta:          { tournament_name: t.name, tournament_location: t.location ?? null, tournament_flag_emoji: t.flag_emoji ?? null },
        }))
        await (admin as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
          .from('notifications').insert(rows)
      }
    } catch (e) {
      console.error('[saveManualDraw] notification error:', e)
    }
  }

  return { ok: true, matchCount: allMatches.length }
}

// ── PDF draw parsing ──────────────────────────────────────────────────────────
// Parses an ATP/WTA draw PDF (128-player with R128 byes) into ManualMatch[] for R64.
// Works server-side only; relies on the pdf-parse npm package (no pdftotext binary).

interface DrawEntry {
  position:   number
  seed?:      number
  qualifier?: string   // WC, Q, LL, PR, Alt
  name?:      string   // undefined if it's a Bye
  country?:   string
  isBye:      boolean
}

/** Title-case a string, handling spaces and hyphens. */
function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/(?:^|[\s-])\S/g, c => c.toUpperCase())
}

/**
 * Convert ATP "LASTNAME, Firstname" to "Firstname Lastname".
 * Strips trailing ellipsis from truncated PDF names (e.g. "MPETSHI PERRICARD, G…").
 */
function formatAtpName(raw: string): string {
  const trimmed = raw.trim().replace(/[…]+$/, '').trim()
  const commaIdx = trimmed.indexOf(',')
  if (commaIdx === -1) return toTitleCase(trimmed)
  const lastName  = trimmed.slice(0, commaIdx).trim()
  const firstName = trimmed.slice(commaIdx + 1).trim()
  return [toTitleCase(firstName), toTitleCase(lastName)].filter(Boolean).join(' ')
}

/**
 * Parse extracted PDF text into per-position draw entries.
 * Expected line format (from pdf-parse v2):
 *   "{pos}  {seed?|qualifier?}  LASTNAME, Firstname  {CTY?}"
 */
function parseAtpDrawText(text: string): DrawEntry[] {
  const entries = new Map<number, DrawEntry>()

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    // Line must start with a draw position number (1-128)
    const posMatch = line.match(/^(\d{1,3})\s+/)
    if (!posMatch) continue
    const position = parseInt(posMatch[1], 10)
    if (position < 1 || position > 128) continue

    let rest = line.slice(posMatch[0].length).trim()

    // Bye
    if (/^bye\b/i.test(rest)) {
      entries.set(position, { position, isBye: true })
      continue
    }

    // Lucky Loser placeholder
    if (/^lucky loser/i.test(rest)) {
      entries.set(position, { position, name: 'Lucky Loser', isBye: false })
      continue
    }

    // Optional seed (1-2 digit number) or qualifier marker
    let seed: number | undefined
    let qualifier: string | undefined

    const seedMatch = rest.match(/^(\d{1,2})\s+/)
    if (seedMatch) {
      seed = parseInt(seedMatch[1], 10)
      rest = rest.slice(seedMatch[0].length).trim()
    } else {
      const qualMatch = rest.match(/^(WC|Q|LL|PR|Alt)\s+/i)
      if (qualMatch) {
        qualifier = qualMatch[1].toUpperCase()
        rest = rest.slice(qualMatch[0].length).trim()
      }
    }

    // Country is a 3-letter all-caps word at the end (possibly tab-separated)
    let country: string | undefined
    const countryMatch = rest.match(/(?:\s|\t)([A-Z]{3})\s*$/)
    if (countryMatch) {
      country = countryMatch[1]
      rest = rest.slice(0, rest.length - countryMatch[0].length).trim()
    }

    const name = formatAtpName(rest)
    if (!name) continue

    entries.set(position, { position, seed, qualifier, name, country, isBye: false })
  }

  return Array.from(entries.values()).sort((a, b) => a.position - b.position)
}

/**
 * Group 128 draw entries into 32 R64 matches.
 * For each group of 4 positions: the seeded player (adjacent to a Bye) is known;
 * their R64 opponent is TBD (empty string → null in the bracket).
 *
 * Pattern A: [seed, bye, q1, q2]  → R64: seed vs ""
 * Pattern B: [q1, q2, bye, seed]  → R64: "" vs seed
 */
function groupIntoR64Matches(entries: DrawEntry[]): ManualMatch[] {
  const matches: ManualMatch[] = []
  const groups = Math.floor(entries.length / 4)

  for (let g = 0; g < groups; g++) {
    const grp    = entries.slice(g * 4, g * 4 + 4)
    const byeIdx = grp.findIndex(e => e.isBye)

    let seedEntry: DrawEntry | undefined
    let seedIsTop = true

    if      (byeIdx === 1) { seedEntry = grp[0]; seedIsTop = true  }  // [seed, bye, ...]
    else if (byeIdx === 2) { seedEntry = grp[3]; seedIsTop = false }   // [..., bye, seed]
    else if (byeIdx === 0) { seedEntry = grp[1]; seedIsTop = true  }  // [bye, seed, ...] unusual
    else if (byeIdx === 3) { seedEntry = grp[2]; seedIsTop = false }  // [..., seed, bye] unusual

    if (!seedEntry || seedEntry.isBye) {
      matches.push({ player1Name: '', player2Name: '' })
      continue
    }

    if (seedIsTop) {
      matches.push({
        player1Name:    seedEntry.name    ?? '',
        player1Seed:    seedEntry.seed    ?? null,
        player1Country: seedEntry.country ?? '',
        player2Name: '',
      })
    } else {
      matches.push({
        player1Name: '',
        player2Name:    seedEntry.name    ?? '',
        player2Seed:    seedEntry.seed    ?? null,
        player2Country: seedEntry.country ?? '',
      })
    }
  }

  return matches
}

/**
 * Parse a tournament draw PDF uploaded by the admin.
 * Returns R64 ManualMatches for a 128-player draw with R128 byes (e.g. Miami Open).
 * Each match has one seeded player (confirmed) and one empty slot (TBD R128 winner).
 */
export async function parsePdfDraw(formData: FormData): Promise<{
  ok:          boolean
  error?:      string
  matches?:    ManualMatch[]
  firstRound?: string
  rawText?:    string
}> {
  await assertAdmin()

  const file = formData.get('pdf') as File | null
  if (!file || file.size === 0) return { ok: false, error: 'No PDF file provided' }
  if (!file.name.toLowerCase().endsWith('.pdf')) return { ok: false, error: 'File must be a PDF' }

  let text: string
  try {
    // Dynamic import keeps pdf-parse out of the client bundle
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse } = await import('pdf-parse') as any
    const bytes  = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()
    text = result.text as string
  } catch (err) {
    return { ok: false, error: `PDF extraction failed: ${String(err)}` }
  }

  const entries    = parseAtpDrawText(text)
  if (entries.length === 0) {
    return { ok: false, error: 'No draw entries found. Is this an ATP/WTA draw PDF?', rawText: text.slice(0, 500) }
  }

  const byeCount    = entries.filter(e => e.isBye).length
  const playerCount = entries.filter(e => !e.isBye).length

  // 128-draw with 32 byes → group into 32 R64 matches (seeded player + TBD)
  if (entries.length === 128 && byeCount === 32 && playerCount === 96) {
    const matches = groupIntoR64Matches(entries)
    return { ok: true, matches, firstRound: 'R64' }
  }

  // 64-draw (no byes, all players named) → consecutive pairs form R32 matches
  if (byeCount === 0 && playerCount >= 32) {
    const matches: ManualMatch[] = []
    for (let i = 0; i + 1 < entries.length; i += 2) {
      const a = entries[i], b = entries[i + 1]
      matches.push({
        player1Name:    a.name    ?? '',
        player1Seed:    a.seed    ?? null,
        player1Country: a.country ?? '',
        player2Name:    b.name    ?? '',
        player2Seed:    b.seed    ?? null,
        player2Country: b.country ?? '',
      })
    }
    return { ok: true, matches, firstRound: playerCount <= 32 ? 'R32' : 'R64' }
  }

  return {
    ok: false,
    error: `Unrecognised draw structure: ${entries.length} positions, ${byeCount} byes, ${playerCount} players.`,
    rawText: text.slice(0, 1000),
  }
}

// ── Manual result entry ───────────────────────────────────────────────────────
// Enter match results by player name. IDs are resolved against the stored draw
// so they are always consistent (whether the draw came from API or manual entry).

export interface ManualResult {
  round: string
  winnerName: string
  loserName: string
  score?: string
}

export async function saveManualResults(
  tournamentId: string,
  externalId: string,
  results: ManualResult[],
  markInProgress: boolean,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  await assertAdmin()
  if (!results.length) return { ok: false, error: 'No results provided' }

  const admin = createAdminClient()

  // Load the stored draw to resolve player names → externalIds
  const { data: drawRow } = await admin
    .from('draws')
    .select('bracket_data')
    .eq('tournament_id', tournamentId)
    .single()

  const draw = drawRow?.bracket_data as Record<string, unknown> | null
  const drawMatches = (draw?.matches as Array<Record<string, unknown>> | undefined) ?? []

  // Build name (lowercased) → externalId map
  const nameToId = new Map<string, string>()
  for (const m of drawMatches) {
    const p1 = m.player1 as Record<string, string> | null
    const p2 = m.player2 as Record<string, string> | null
    if (p1?.name && p1?.externalId) nameToId.set(p1.name.toLowerCase(), p1.externalId)
    if (p2?.name && p2?.externalId) nameToId.set(p2.name.toLowerCase(), p2.externalId)
  }

  // Fall back to normalizing the name if not found in draw (qualifier, lucky loser, etc.)
  const resolveId = (name: string): string =>
    nameToId.get(name.trim().toLowerCase()) ?? normalizePlayerId(name)

  // Group by round to assign unique external_match_ids within the upsert
  const roundCounters: Record<string, number> = {}
  const rows = results.map(r => {
    roundCounters[r.round] = (roundCounters[r.round] ?? 0) + 1
    const seq = String(roundCounters[r.round]).padStart(3, '0')
    return {
      tournament_id:      tournamentId,
      external_match_id:  `${externalId}-${r.round}-result-${seq}`,
      round:              r.round,
      winner_external_id: resolveId(r.winnerName),
      loser_external_id:  resolveId(r.loserName),
      score:              (r.score ?? '').trim(),
      played_at:          new Date().toISOString(),
    }
  })

  const { error } = await admin
    .from('match_results')
    .upsert(rows, { onConflict: 'tournament_id,external_match_id' })
  if (error) return { ok: false, error: error.message }

  if (markInProgress) {
    await admin
      .from('tournaments')
      .update({ status: 'in_progress' })
      .eq('id', tournamentId)
      .eq('status', 'accepting_predictions')
  }

  return { ok: true, count: rows.length }
}

// ── Player management ─────────────────────────────────────────────────────────

export async function createPlayer(data: {
  name: string
  country: string
  tour: 'ATP' | 'WTA'
}): Promise<{ ok: boolean; player?: { id: string; external_id: string; name: string; country: string; tour: string }; error?: string }> {
  await assertAdmin()
  const external_id = normalizePlayerId(data.name)
  if (!external_id) return { ok: false, error: 'Invalid player name' }

  const admin = createAdminClient()
  const { data: player, error } = await admin
    .from('players')
    .upsert(
      { external_id, name: data.name.trim(), country: data.country.trim(), tour: data.tour },
      { onConflict: 'external_id' },
    )
    .select('id, external_id, name, country, tour')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, player: player as { id: string; external_id: string; name: string; country: string; tour: string } }
}

export async function updatePlayerCountry(
  playerId: string,
  country: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()
  const { error } = await admin
    .from('players')
    .update({ country: country.trim() })
    .eq('id', playerId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function searchPlayers(
  query: string,
  tour?: 'ATP' | 'WTA',
): Promise<{ ok: boolean; players: Array<{ id: string; external_id: string; name: string; country: string; tour: string }> }> {
  await assertAdmin()
  const admin = createAdminClient()
  let q = admin
    .from('players')
    .select('id, external_id, name, country, tour')
    .ilike('name', `%${query}%`)
    .order('name')
    .limit(20)

  if (tour) q = q.eq('tour', tour)

  const { data } = await q
  return { ok: true, players: (data ?? []) as Array<{ id: string; external_id: string; name: string; country: string; tour: string }> }
}

// ── Bulk-seed players from existing synced draws ──────────────────────────────

export async function seedPlayersFromDraws(): Promise<{ ok: boolean; imported: number; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()

  // Fetch all draws + tournament tour info
  const { data: draws, error: drawErr } = await admin
    .from('draws')
    .select('bracket_data, tournaments!inner(tour)')

  if (drawErr) return { ok: false, imported: 0, error: drawErr.message }
  if (!draws?.length) return { ok: true, imported: 0 }

  // Extract unique players from all bracket_data
  const seen = new Map<string, { name: string; country: string; tour: string }>()
  for (const draw of draws) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bracket = draw.bracket_data as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tour = (draw as any).tournaments?.tour ?? 'ATP'
    const matches = bracket?.matches ?? []
    for (const m of matches) {
      if (m.player1?.externalId && m.player1.name) {
        seen.set(m.player1.externalId, { name: m.player1.name, country: m.player1.country ?? '', tour })
      }
      if (m.player2?.externalId && m.player2.name) {
        seen.set(m.player2.externalId, { name: m.player2.name, country: m.player2.country ?? '', tour })
      }
    }
  }

  if (seen.size === 0) return { ok: true, imported: 0 }

  // Batch upsert — skip conflicts on external_id
  const rows = [...seen.entries()].map(([externalId, p]) => ({
    external_id: externalId,
    name: p.name,
    country: p.country,
    tour: p.tour,
  }))

  // Supabase upsert in chunks of 500
  let imported = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { data: upserted, error } = await admin
      .from('players')
      .upsert(chunk, { onConflict: 'external_id', ignoreDuplicates: true })
      .select('id')
    if (error) return { ok: false, imported, error: error.message }
    imported += upserted?.length ?? 0
  }

  return { ok: true, imported }
}

export async function seedPlayersFromApi(): Promise<{ ok: boolean; imported: number; tournamentsScanned: number; error?: string }> {
  await assertAdmin()

  const apiKey = process.env.TENNIS_API_KEY
  if (!apiKey) return { ok: false, imported: 0, tournamentsScanned: 0, error: 'TENNIS_API_KEY not configured' }

  const BASE_URL = 'https://api.api-tennis.com/tennis/'

  // Helper to call the API
  async function fetchApi(params: Record<string, string>) {
    const url = new URL(BASE_URL)
    url.searchParams.set('APIkey', apiKey!)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (Number(json.success) !== 1) throw new Error(json.error ?? 'API error')
    return json.result ?? []
  }

  // 1. Fetch all tournaments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTournaments: any[] = await fetchApi({ method: 'get_tournaments' })

  // 2. Filter to ATP/WTA singles only
  const validTours: Record<string, 'ATP' | 'WTA'> = {}
  for (const t of allTournaments) {
    const type = ((t.event_type_type ?? '') as string).toUpperCase()
    if (type.includes('ATP') && !type.includes('CHALLENGER') && !type.includes('DOUBLES')) {
      validTours[String(t.tournament_key)] = 'ATP'
    } else if (type.includes('WTA') && !type.includes('DOUBLES')) {
      validTours[String(t.tournament_key)] = 'WTA'
    }
  }

  const tournamentKeys = Object.keys(validTours)
  if (tournamentKeys.length === 0) {
    return { ok: false, imported: 0, tournamentsScanned: 0, error: `Found ${allTournaments.length} tournaments but none matched ATP/WTA singles filter` }
  }

  const seen = new Map<string, { name: string; country: string; tour: 'ATP' | 'WTA' }>()

  // 3. Fetch fixtures one at a time with delay to avoid rate limits
  const today = new Date().toISOString().slice(0, 10)
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  let scanned = 0
  let errors = 0
  let emptyResults = 0
  let firstError = ''

  for (const key of tournamentKeys) {
    scanned++
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fixtures: any[] = await fetchApi({
        method: 'get_fixtures',
        tournament_key: key,
        date_start: yearAgo,
        date_stop: today,
      })

      if (!Array.isArray(fixtures) || fixtures.length === 0) {
        emptyResults++
        continue
      }

      const tour = validTours[key]
      for (const f of fixtures) {
        // Use player key if available, otherwise use normalised name
        const homeName = f.event_home_team
        const homeKey = f.event_home_team_key
        if (homeName && String(homeName).trim()) {
          const eid = homeKey ? String(homeKey) : normalizePlayerId(String(homeName))
          if (eid && !seen.has(eid)) {
            seen.set(eid, { name: String(homeName), country: f.event_home_team_country ?? '', tour })
          }
        }
        const awayName = f.event_away_team
        const awayKey = f.event_away_team_key
        if (awayName && String(awayName).trim()) {
          const eid = awayKey ? String(awayKey) : normalizePlayerId(String(awayName))
          if (eid && !seen.has(eid)) {
            seen.set(eid, { name: String(awayName), country: f.event_away_team_country ?? '', tour })
          }
        }
      }
    } catch (err) {
      errors++
      if (!firstError) firstError = String(err)
      // If too many consecutive errors, stop early
      if (errors >= 10 && seen.size === 0) {
        return { ok: false, imported: 0, tournamentsScanned: scanned, error: `API failing (${errors} errors). First: ${firstError}` }
      }
    }

    // Stop early if we have enough
    if (seen.size >= 500) break

    // Small delay between requests to be kind to the API
    await new Promise(r => setTimeout(r, 200))
  }

  if (seen.size === 0) {
    return {
      ok: false, imported: 0, tournamentsScanned: scanned,
      error: `No players found. ${errors} errors, ${emptyResults} empty.${firstError ? ` First error: ${firstError}` : ''}`,
    }
  }

  // 4. Bulk upsert
  const admin = createAdminClient()
  const rows = [...seen.entries()].map(([externalId, p]) => ({
    external_id: externalId,
    name: p.name,
    country: p.country,
    tour: p.tour,
  }))

  let imported = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { data: upserted, error } = await admin
      .from('players')
      .upsert(chunk, { onConflict: 'external_id', ignoreDuplicates: true })
      .select('id')
    if (error) return { ok: false, imported, tournamentsScanned: scanned, error: error.message }
    imported += upserted?.length ?? 0
  }

  return { ok: true, imported, tournamentsScanned: scanned }
}

// resetAndImportPlayers — moved to /api/admin/import-players route.ts
// (Server actions time out on Vercel; the API route has maxDuration = 120s
//  and uses parallel fetching.) The client calls the route directly.

// ── Manual tournament creation ────────────────────────────────────────────────

export async function createTournament(data: {
  name: string
  tour: 'ATP' | 'WTA'
  category: 'grand_slam' | 'masters_1000' | '500' | '250'
  country: string
  city: string
  surface: 'hard' | 'clay' | 'grass'
  startsAt: string
  drawSize: 32 | 64 | 128
}): Promise<{ ok: boolean; tournamentId?: string; error?: string }> {
  await assertAdmin()

  const external_id = normalizePlayerId(data.name)
  if (!external_id) return { ok: false, error: 'Invalid tournament name' }

  const startsAt = new Date(data.startsAt)
  const starts_year = startsAt.getUTCFullYear()
  // Default ends_at to 7 days after start (14 for grand slams)
  const durationDays = data.category === 'grand_slam' ? 14 : 7
  const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000)

  const admin = createAdminClient()
  const flag = flagForCountry(data.country)

  const { data: tournament, error } = await admin
    .from('tournaments')
    .insert({
      external_id,
      name: data.name.trim(),
      tour: data.tour,
      category: data.category,
      surface: data.surface,
      location: `${data.city.trim()}, ${data.country.trim()}`,
      flag_emoji: flag,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      starts_year,
      draw_size: data.drawSize,
      is_manual: true,
      status: 'upcoming',
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `A tournament with slug "${external_id}" already exists for ${starts_year}. Try a different name.` }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, tournamentId: tournament.id }
}

export async function getManualTournaments(): Promise<{
  ok: boolean
  tournaments: Array<{
    id: string; name: string; tour: string; category: string; status: string
    starts_at: string | null; surface: string | null
    location: string | null; flag_emoji: string | null
    has_draw: boolean
  }>
}> {
  await assertAdmin()
  const admin = createAdminClient()

  // Only show admin-created tournaments (is_manual = true)
  const { data: tournaments, error } = await admin
    .from('tournaments')
    .select('id, name, tour, category, status, starts_at, surface, location, flag_emoji')
    .eq('is_manual', true)
    .order('starts_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('getManualTournaments error:', error.message)
    return { ok: false, tournaments: [] }
  }

  // Check which tournaments have draws (separate query)
  const ids = (tournaments ?? []).map(t => t.id)
  const { data: draws } = ids.length > 0
    ? await admin.from('draws').select('tournament_id').in('tournament_id', ids)
    : { data: [] }
  const drawSet = new Set((draws ?? []).map((d: { tournament_id: string }) => d.tournament_id))

  return {
    ok: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tournaments: (tournaments ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      tour: t.tour,
      category: t.category,
      status: t.status,
      starts_at: t.starts_at,
      surface: t.surface,
      location: t.location ?? null,
      flag_emoji: t.flag_emoji ?? null,
      has_draw: drawSet.has(t.id),
    })),
  }
}

// ── Scoring status (for Award Points section in admin panel) ─────────────────

export interface ScoringTournament {
  id: string
  name: string
  status: string
  location: string | null
  flag_emoji: string | null
  totalResults: number      // non-BYE match results
  scoredResults: number     // unique match_result_ids in point_ledger
  pendingResults: number    // totalResults - scoredResults
}

export async function getScoringStatus(): Promise<ScoringTournament[]> {
  await assertAdmin()
  const admin = createAdminClient()

  // Get in_progress and completed tournaments
  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id, name, status, location, flag_emoji')
    .in('status', ['in_progress', 'completed'])
    .order('starts_at', { ascending: false })

  if (!tournaments?.length) return []

  const ids = tournaments.map(t => t.id)

  // Count non-BYE match results per tournament
  const { data: results } = await admin
    .from('match_results')
    .select('id, tournament_id')
    .in('tournament_id', ids)
    .neq('score', 'BYE')

  const resultCountByTournament: Record<string, number> = {}
  const resultIdsByTournament: Record<string, Set<string>> = {}
  for (const r of results ?? []) {
    resultCountByTournament[r.tournament_id] = (resultCountByTournament[r.tournament_id] ?? 0) + 1
    if (!resultIdsByTournament[r.tournament_id]) resultIdsByTournament[r.tournament_id] = new Set()
    resultIdsByTournament[r.tournament_id].add(r.id)
  }

  // Get scored match_result_ids from point_ledger
  const allResultIds = (results ?? []).map(r => r.id)
  const { data: scored } = allResultIds.length > 0
    ? await admin
        .from('point_ledger')
        .select('match_result_id')
        .in('match_result_id', allResultIds)
    : { data: [] }

  // Unique scored result IDs per tournament
  const scoredByTournament: Record<string, Set<string>> = {}
  for (const s of scored ?? []) {
    // Find which tournament this result belongs to
    for (const [tid, rids] of Object.entries(resultIdsByTournament)) {
      if (rids.has(s.match_result_id)) {
        if (!scoredByTournament[tid]) scoredByTournament[tid] = new Set()
        scoredByTournament[tid].add(s.match_result_id)
        break
      }
    }
  }

  return tournaments.map((t: any) => {
    const total = resultCountByTournament[t.id] ?? 0
    const scored = scoredByTournament[t.id]?.size ?? 0
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      location: t.location ?? null,
      flag_emoji: t.flag_emoji ?? null,
      totalResults: total,
      scoredResults: scored,
      pendingResults: total - scored,
    }
  })
}

export async function getTournament(tournamentId: string): Promise<{
  ok: boolean
  tournament?: {
    id: string; name: string; tour: string; category: string
    country: string; city: string; surface: string | null
    starts_at: string | null; draw_size: number | null; status: string
  }
  error?: string
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data: tournament, error } = await admin
    .from('tournaments')
    .select('id, name, tour, category, location, surface, starts_at, draw_size, status')
    .eq('id', tournamentId)
    .single()

  if (error || !tournament) return { ok: false, error: error?.message ?? 'Tournament not found' }

  // Parse "City, Country" from location field
  const location = (tournament.location as string) ?? ''
  const commaIdx = location.indexOf(',')
  const city = commaIdx >= 0 ? location.slice(0, commaIdx).trim() : ''
  const country = commaIdx >= 0 ? location.slice(commaIdx + 1).trim() : location.trim()

  return {
    ok: true,
    tournament: {
      id: tournament.id,
      name: tournament.name,
      tour: tournament.tour,
      category: tournament.category,
      country,
      city,
      surface: tournament.surface,
      starts_at: tournament.starts_at,
      draw_size: tournament.draw_size as number | null,
      status: tournament.status,
    },
  }
}

export async function updateTournament(
  tournamentId: string,
  data: {
    name: string
    tour: 'ATP' | 'WTA'
    category: 'grand_slam' | 'masters_1000' | '500' | '250'
    country: string
    city: string
    surface: 'hard' | 'clay' | 'grass'
    startsAt: string
    drawSize: 32 | 64 | 128
  },
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()

  const startsAt = new Date(data.startsAt)
  const starts_year = startsAt.getUTCFullYear()
  const durationDays = data.category === 'grand_slam' ? 14 : 7
  const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000)

  const flag = flagForCountry(data.country)

  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .update({
      name: data.name.trim(),
      tour: data.tour,
      category: data.category,
      surface: data.surface,
      location: `${data.city.trim()}, ${data.country.trim()}`,
      flag_emoji: flag,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      starts_year,
      draw_size: data.drawSize,
    })
    .eq('id', tournamentId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function getTournamentWithDraw(tournamentId: string): Promise<{
  ok: boolean
  tournament?: {
    id: string; name: string; external_id: string; tour: string; category: string
    status: string; draw_size: number | null; starts_at: string | null
    location: string | null; flag_emoji: string | null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bracketData?: any
  lockedMatches?: Record<string, string>
  matchResults?: Array<{ external_match_id: string; round: string; winner_external_id: string; loser_external_id: string; score: string | null }>
  error?: string
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .select('id, name, external_id, tour, category, status, draw_size, starts_at, location, flag_emoji')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) return { ok: false, error: tErr?.message ?? 'Tournament not found' }

  const { data: draw } = await admin
    .from('draws')
    .select('bracket_data, locked_matches')
    .eq('tournament_id', tournamentId)
    .single()

  const { data: results } = await admin
    .from('match_results')
    .select('external_match_id, round, winner_external_id, loser_external_id, score')
    .eq('tournament_id', tournamentId)

  return {
    ok: true,
    tournament: tournament as {
      id: string; name: string; external_id: string; tour: string; category: string
      status: string; draw_size: number | null; starts_at: string | null
      location: string | null; flag_emoji: string | null
    },
    bracketData: draw?.bracket_data ?? null,
    lockedMatches: (draw?.locked_matches as Record<string, string>) ?? {},
    matchResults: (results ?? []) as Array<{ external_match_id: string; round: string; winner_external_id: string; loser_external_id: string; score: string | null }>,
  }
}

// ── Structured draw builder ──────────────────────────────────────────────────
// Builds a draw from player external_ids (sourced from the players table).
// Unlike saveManualDraw (text-based), this uses structured player objects.

export async function buildDraw(
  tournamentId: string,
  slots: Array<{ player1ExternalId: string | null; player2ExternalId: string | null }>,
): Promise<{ ok: boolean; error?: string; matchCount?: number }> {
  await assertAdmin()
  if (!slots.length) return { ok: false, error: 'No matches provided' }

  const admin = createAdminClient()

  // Load tournament
  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .select('id, external_id, draw_size, tour, name, location, flag_emoji, draw_close_at')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) return { ok: false, error: tErr?.message ?? 'Tournament not found' }

  const drawSize = tournament.draw_size as number
  const expectedMatches = drawSize / 2
  if (slots.length !== expectedMatches) {
    return { ok: false, error: `Expected ${expectedMatches} matches for draw size ${drawSize}, got ${slots.length}` }
  }

  // Collect all player external_ids to load from players table
  const playerIds = new Set<string>()
  for (const slot of slots) {
    if (slot.player1ExternalId) playerIds.add(slot.player1ExternalId)
    if (slot.player2ExternalId) playerIds.add(slot.player2ExternalId)
  }

  // Load player records
  const playerMap = new Map<string, { externalId: string; name: string; country: string }>()
  if (playerIds.size > 0) {
    const { data: players } = await admin
      .from('players')
      .select('external_id, name, country')
      .in('external_id', Array.from(playerIds))
    for (const p of players ?? []) {
      playerMap.set(p.external_id, { externalId: p.external_id, name: p.name, country: p.country })
    }
  }

  // Compute rounds from draw size
  const drawSizeToFirstRound: Record<number, number> = { 128: 0, 64: 1, 32: 2 }
  const startIdx = drawSizeToFirstRound[drawSize]
  if (startIdx === undefined) return { ok: false, error: `Unsupported draw size: ${drawSize}` }
  const rounds = ROUND_ORDER.slice(startIdx)
  const firstRound = rounds[0]
  const externalId = tournament.external_id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMatches: any[] = []

  // First round — players from slots
  let qualifierCounter = 0
  slots.forEach((slot, i) => {
    const idx = String(i + 1).padStart(3, '0')
    const matchId = `${externalId}-${firstRound}-${idx}`
    const resolveSlot = (extId: string | null) => {
      if (!extId) return null
      if (extId === 'QUALIFIER') {
        qualifierCounter++
        return { externalId: `qualifier-${qualifierCounter}`, name: 'Qualifier', country: '' }
      }
      return playerMap.get(extId) ?? null
    }
    allMatches.push({
      matchId,
      round: firstRound,
      player1: resolveSlot(slot.player1ExternalId),
      player2: resolveSlot(slot.player2ExternalId),
    })
  })

  // Subsequent rounds — TBD (null players)
  let prevCount = slots.length
  for (let ri = 1; ri < rounds.length; ri++) {
    const round = rounds[ri]
    const count = Math.ceil(prevCount / 2)
    for (let i = 0; i < count; i++) {
      allMatches.push({
        matchId: `${externalId}-${round}-${String(i + 1).padStart(3, '0')}`,
        round,
        player1: null,
        player2: null,
      })
    }
    prevCount = count
  }

  // Handle BYEs: auto-advance the non-BYE player by creating match_results
  const byeResults: Array<{
    tournament_id: string; external_match_id: string; round: string
    winner_external_id: string; loser_external_id: string; score: string; played_at: string
  }> = []
  for (const match of allMatches) {
    if (match.round !== firstRound) continue
    const hasP1 = match.player1 !== null
    const hasP2 = match.player2 !== null
    if (hasP1 && !hasP2) {
      byeResults.push({
        tournament_id: tournamentId,
        external_match_id: match.matchId,
        round: firstRound,
        winner_external_id: match.player1.externalId,
        loser_external_id: 'bye',
        score: 'BYE',
        played_at: new Date().toISOString(),
      })
    } else if (!hasP1 && hasP2) {
      byeResults.push({
        tournament_id: tournamentId,
        external_match_id: match.matchId,
        round: firstRound,
        winner_external_id: match.player2.externalId,
        loser_external_id: 'bye',
        score: 'BYE',
        played_at: new Date().toISOString(),
      })
    }
  }

  const draw = { tournamentExternalId: externalId, rounds, matches: allMatches }

  const { error: drawError } = await admin
    .from('draws')
    .upsert(
      { tournament_id: tournamentId, bracket_data: draw as unknown, synced_at: new Date().toISOString() },
      { onConflict: 'tournament_id' },
    )
  if (drawError) return { ok: false, error: drawError.message }

  // Insert BYE results so they show as resolved
  if (byeResults.length > 0) {
    await admin
      .from('match_results')
      .upsert(byeResults, { onConflict: 'tournament_id,external_match_id' })
  }

  // Open predictions
  await admin
    .from('tournaments')
    .update({ status: 'accepting_predictions' })
    .eq('id', tournamentId)

  // Notify users
  try {
    const allUsers = await listAllUsers(admin)
    if (allUsers.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = allUsers.map((u: any) => ({
        user_id: u.id,
        type: 'draw_open',
        tournament_id: tournamentId,
        meta: { tournament_name: tournament.name, tournament_location: tournament.location ?? null, tournament_flag_emoji: tournament.flag_emoji ?? null },
      }))
      await (admin as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
        .from('notifications').insert(rows)
    }
  } catch (e) {
    console.error('[buildDraw] notification error:', e)
  }

  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')

  return { ok: true, matchCount: allMatches.length }
}

// ── Structured result entry ──────────────────────────────────────────────────
// Enter a single match result by matchId (must match bracket_data matchId).

/**
 * Find all downstream match IDs that involve a specific player.
 * Walks forward through the bracket from the given round to find
 * matches where the player appears as winner or loser.
 */
async function findDownstreamResults(
  admin: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  playerExternalId: string,
  fromRound: string,
): Promise<string[]> {
  const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']
  const startIdx = ROUND_ORDER.indexOf(fromRound)
  if (startIdx < 0) return []

  // Get all results for rounds AFTER the given round
  const laterRounds = ROUND_ORDER.slice(startIdx + 1)
  if (laterRounds.length === 0) return []

  const { data: results } = await admin
    .from('match_results')
    .select('external_match_id, winner_external_id, loser_external_id')
    .eq('tournament_id', tournamentId)
    .in('round', laterRounds)

  // Find results where this player appears
  return (results ?? [])
    .filter(r => r.winner_external_id === playerExternalId || r.loser_external_id === playerExternalId)
    .map(r => r.external_match_id)
}

export async function saveMatchResult(
  tournamentId: string,
  matchId: string,
  winnerExternalId: string,
  loserExternalId: string,
  score?: string,
): Promise<{ ok: boolean; error?: string; cascadeDeleted?: string[] }> {
  await assertAdmin()
  const admin = createAdminClient()

  // Determine round from matchId (format: "ext-id-ROUND-001")
  const parts = matchId.split('-')
  const roundSegment = parts[parts.length - 2]
  const validRounds = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']
  if (!validRounds.includes(roundSegment)) {
    return { ok: false, error: `Cannot determine round from matchId "${matchId}"` }
  }

  // Check if we're editing an existing result (winner changed)
  let cascadeDeleted: string[] = []
  const { data: existingResult } = await admin
    .from('match_results')
    .select('winner_external_id')
    .eq('tournament_id', tournamentId)
    .eq('external_match_id', matchId)
    .maybeSingle()

  if (existingResult && existingResult.winner_external_id !== winnerExternalId) {
    // Winner changed — cascade delete downstream results involving the OLD winner
    const oldWinner = existingResult.winner_external_id
    const downstream = await findDownstreamResults(admin, tournamentId, oldWinner, roundSegment)
    if (downstream.length > 0) {
      await admin
        .from('match_results')
        .delete()
        .eq('tournament_id', tournamentId)
        .in('external_match_id', downstream)
      cascadeDeleted = downstream
    }
  }

  const { error } = await admin
    .from('match_results')
    .upsert({
      tournament_id: tournamentId,
      external_match_id: matchId,
      round: roundSegment,
      winner_external_id: winnerExternalId,
      loser_external_id: loserExternalId,
      score: (score ?? '').trim() || null,
      played_at: new Date().toISOString(),
    }, { onConflict: 'tournament_id,external_match_id' })

  if (error) return { ok: false, error: error.message }

  // Transition to in_progress on first real result (non-BYE)
  if (loserExternalId !== 'bye') {
    await admin
      .from('tournaments')
      .update({ status: 'in_progress' })
      .eq('id', tournamentId)
      .eq('status', 'accepting_predictions')
  }

  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')
  return { ok: true, cascadeDeleted }
}

/** Clear a match result and cascade-delete downstream results involving the winner. */
export async function clearMatchResult(
  tournamentId: string,
  matchId: string,
): Promise<{ ok: boolean; error?: string; cascadeDeleted?: string[] }> {
  await assertAdmin()
  const admin = createAdminClient()

  // Get the existing result to find the winner for cascade
  const { data: existing } = await admin
    .from('match_results')
    .select('winner_external_id, round')
    .eq('tournament_id', tournamentId)
    .eq('external_match_id', matchId)
    .maybeSingle()

  if (!existing) return { ok: false, error: 'No result found for this match' }

  // Cascade delete downstream results involving this winner
  let cascadeDeleted: string[] = []
  const downstream = await findDownstreamResults(admin, tournamentId, existing.winner_external_id, existing.round)
  if (downstream.length > 0) {
    await admin
      .from('match_results')
      .delete()
      .eq('tournament_id', tournamentId)
      .in('external_match_id', downstream)
    cascadeDeleted = downstream
  }

  // Delete the result itself
  const { error } = await admin
    .from('match_results')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('external_match_id', matchId)

  if (error) return { ok: false, error: error.message }

  revalidateTag('tournament-detail', 'default')
  revalidateTag('tournament-list', 'default')
  return { ok: true, cascadeDeleted }
}

// ── Cron runs log ──────────────────────────────────────────────────────────

export interface CronRun {
  id: string
  job_name: string
  status: string
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  summary: Record<string, unknown> | null
  error: string | null
}

export async function getCronRuns(): Promise<CronRun[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('cron_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[admin] Failed to fetch cron runs:', error)
    return []
  }
  return (data ?? []) as CronRun[]
}

// ── Auto-Predict admin actions ──────────────────────────────────────────────

export type AutoPredictStats = {
  enabledCount: number
  recentRuns: Array<{
    id: string
    tournament_id: string
    triggered_by: string
    users_processed: number
    predictions_created: number
    predictions_updated: number
    created_at: string
  }>
}

export async function getAutoPredictStats(): Promise<AutoPredictStats> {
  await assertAdmin()
  const admin = createAdminClient()

  const [{ count }, { data: runs }] = await Promise.all([
    admin.from('users').select('id', { count: 'exact', head: true }).eq('auto_predict_enabled', true),
    admin.from('auto_predict_runs')
      .select('id, tournament_id, triggered_by, users_processed, predictions_created, predictions_updated, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  return {
    enabledCount: count ?? 0,
    recentRuns: (runs ?? []) as AutoPredictStats['recentRuns'],
  }
}

export async function searchUsersForAutoPredict(
  query: string,
): Promise<{ users: Array<{ id: string; username: string; auto_predict_enabled: boolean }> }> {
  await assertAdmin()
  const admin = createAdminClient()

  let q = admin
    .from('users')
    .select('id, username, auto_predict_enabled')
    .order('username')
    .limit(20)

  if (query.trim()) {
    q = q.ilike('username', `%${query}%`)
  }

  const { data } = await q
  return { users: (data ?? []) as Array<{ id: string; username: string; auto_predict_enabled: boolean }> }
}

export async function toggleAutoPredict(
  userId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('users')
    .update({ auto_predict_enabled: enabled } as any)
    .eq('id', userId)
    .select('id, auto_predict_enabled')
    .single()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'User not found' }
  return { ok: true }
}

// ── App Settings ─────────────────────────────────────────────────────────────

import type { PredictionMode } from '@/lib/app-settings'

export type AppSettings = {
  prediction_mode: PredictionMode
}

export async function getAppSettings(): Promise<AppSettings> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('app_settings')
    .select('key, value')

  if (error || !data) return { prediction_mode: 'anytime' }

  const settings: AppSettings = { prediction_mode: 'anytime' }
  for (const row of data) {
    if (row.key === 'prediction_mode') {
      const v = String(row.value)
      settings.prediction_mode = v.includes('pre_tournament') ? 'pre_tournament'
        : v.includes('manual_lock') ? 'manual_lock'
        : 'anytime'
    }
  }
  return settings
}

export async function updatePredictionMode(
  mode: PredictionMode,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const VALID_MODES: PredictionMode[] = ['anytime', 'pre_tournament', 'manual_lock']
  if (!VALID_MODES.includes(mode)) {
    return { ok: false, error: 'Invalid mode' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('app_settings')
    .upsert(
      { key: 'prediction_mode', value: mode, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )

  if (error) return { ok: false, error: error.message }

  // Bust the cached prediction mode so all pages pick it up immediately
  revalidateTag('app-settings', 'default')

  return { ok: true }
}

// ── Match Locks (manual_lock mode) ──────────────────────────────────────────

/**
 * Lock specific matches for a tournament.
 * Adds matchIds to draws.locked_matches JSONB with current timestamp.
 */
export async function lockMatches(
  tournamentId: string,
  matchIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  if (!matchIds.length) return { ok: false, error: 'No match IDs provided' }

  const admin = createAdminClient()

  // Fetch current locked_matches
  const { data: draw, error: fetchErr } = await admin
    .from('draws')
    .select('locked_matches')
    .eq('tournament_id', tournamentId)
    .single()

  if (fetchErr || !draw) return { ok: false, error: fetchErr?.message ?? 'Draw not found' }

  const current = (draw.locked_matches as Record<string, string>) ?? {}
  const now = new Date().toISOString()
  const updated = { ...current }
  for (const id of matchIds) {
    if (!updated[id]) updated[id] = now
  }

  const { error } = await admin
    .from('draws')
    .update({ locked_matches: updated })
    .eq('tournament_id', tournamentId)

  if (error) return { ok: false, error: error.message }

  revalidateTag('app-settings', 'default')
  return { ok: true }
}

/**
 * Unlock specific matches for a tournament.
 * Removes matchIds from draws.locked_matches JSONB.
 */
export async function unlockMatches(
  tournamentId: string,
  matchIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  if (!matchIds.length) return { ok: false, error: 'No match IDs provided' }

  const admin = createAdminClient()

  const { data: draw, error: fetchErr } = await admin
    .from('draws')
    .select('locked_matches')
    .eq('tournament_id', tournamentId)
    .single()

  if (fetchErr || !draw) return { ok: false, error: fetchErr?.message ?? 'Draw not found' }

  const current = (draw.locked_matches as Record<string, string>) ?? {}
  const updated = { ...current }
  for (const id of matchIds) {
    delete updated[id]
  }

  const { error } = await admin
    .from('draws')
    .update({ locked_matches: updated })
    .eq('tournament_id', tournamentId)

  if (error) return { ok: false, error: error.message }

  revalidateTag('app-settings', 'default')
  return { ok: true }
}

/**
 * Lock all matches in a specific round.
 */
export async function lockRound(
  tournamentId: string,
  round: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()

  // Fetch bracket data to get matchIds for the round
  const { data: draw, error: fetchErr } = await admin
    .from('draws')
    .select('bracket_data, locked_matches')
    .eq('tournament_id', tournamentId)
    .single()

  if (fetchErr || !draw?.bracket_data) return { ok: false, error: fetchErr?.message ?? 'Draw not found' }

  const bracket = draw.bracket_data as { matches: Array<{ matchId: string; round: string }> }
  const roundMatchIds = bracket.matches
    .filter(m => m.round === round)
    .map(m => m.matchId)

  if (!roundMatchIds.length) return { ok: false, error: 'No matches found for this round' }

  const current = (draw.locked_matches as Record<string, string>) ?? {}
  const now = new Date().toISOString()
  const updated = { ...current }
  for (const id of roundMatchIds) {
    if (!updated[id]) updated[id] = now
  }

  const { error } = await admin
    .from('draws')
    .update({ locked_matches: updated })
    .eq('tournament_id', tournamentId)

  if (error) return { ok: false, error: error.message }

  revalidateTag('app-settings', 'default')
  return { ok: true }
}
