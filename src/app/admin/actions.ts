'use server'

import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ── Auth guard ────────────────────────────────────────────────────────────────

async function assertAdmin() {
  if (process.env.NODE_ENV === 'development') return
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const adminIds = (process.env.ADMIN_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (!adminIds.includes(user.id)) throw new Error('Forbidden')
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
    const { data: { users: allUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 })
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
  revalidateTag('tournament-detail')

  if (openPredictions) {
    await admin
      .from('tournaments')
      .update({ status: 'accepting_predictions' })
      .eq('id', tournamentId)

    // Notify all users that predictions are now open
    try {
      const { data: t } = await admin
        .from('tournaments')
        .select('name, draw_close_at')
        .eq('id', tournamentId)
        .single()
      const { data: { users: allUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 })
      if (allUsers.length > 0 && t) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = allUsers.map((u: any) => ({
          user_id:       u.id,
          type:          'draw_open',
          tournament_id: tournamentId,
          meta:          { tournament_name: t.name },
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
  const { data: tournament, error } = await admin
    .from('tournaments')
    .insert({
      external_id,
      name: data.name.trim(),
      tour: data.tour,
      category: data.category,
      surface: data.surface,
      location: `${data.city.trim()}, ${data.country.trim()}`,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      starts_year,
      draw_size: data.drawSize,
      is_manual: true,
      status: 'upcoming',
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, tournamentId: tournament.id }
}

export async function getManualTournaments(): Promise<{
  ok: boolean
  tournaments: Array<{
    id: string; name: string; tour: string; category: string; status: string
    draw_size: number | null; starts_at: string | null; surface: string | null
    has_draw: boolean
  }>
}> {
  await assertAdmin()
  const admin = createAdminClient()
  const { data } = await admin
    .from('tournaments')
    .select('id, name, tour, category, status, draw_size, starts_at, surface, draws(id)')
    .eq('is_manual', true)
    .order('created_at', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tournaments = (data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    tour: t.tour,
    category: t.category,
    status: t.status,
    draw_size: t.draw_size,
    starts_at: t.starts_at,
    surface: t.surface,
    has_draw: Array.isArray(t.draws) ? t.draws.length > 0 : !!t.draws,
  }))

  return { ok: true, tournaments }
}

export async function getTournamentWithDraw(tournamentId: string): Promise<{
  ok: boolean
  tournament?: {
    id: string; name: string; external_id: string; tour: string; category: string
    status: string; draw_size: number | null; starts_at: string | null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bracketData?: any
  matchResults?: Array<{ external_match_id: string; round: string; winner_external_id: string; loser_external_id: string; score: string | null }>
  error?: string
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .select('id, name, external_id, tour, category, status, draw_size, starts_at')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) return { ok: false, error: tErr?.message ?? 'Tournament not found' }

  const { data: draw } = await admin
    .from('draws')
    .select('bracket_data')
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
    },
    bracketData: draw?.bracket_data ?? null,
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
    .select('id, external_id, draw_size, tour, name, draw_close_at')
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
  slots.forEach((slot, i) => {
    const idx = String(i + 1).padStart(3, '0')
    const p1 = slot.player1ExternalId ? playerMap.get(slot.player1ExternalId) ?? null : null
    const p2 = slot.player2ExternalId ? playerMap.get(slot.player2ExternalId) ?? null : null
    allMatches.push({
      matchId: `${externalId}-${firstRound}-${idx}`,
      round: firstRound,
      player1: p1,
      player2: p2,
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
    const { data: { users: allUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (allUsers.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = allUsers.map((u: any) => ({
        user_id: u.id,
        type: 'draw_open',
        tournament_id: tournamentId,
        meta: { tournament_name: tournament.name },
      }))
      await (admin as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
        .from('notifications').insert(rows)
    }
  } catch (e) {
    console.error('[buildDraw] notification error:', e)
  }

  revalidateTag('tournament-detail')

  return { ok: true, matchCount: allMatches.length }
}

// ── Structured result entry ──────────────────────────────────────────────────
// Enter a single match result by matchId (must match bracket_data matchId).

export async function saveMatchResult(
  tournamentId: string,
  matchId: string,
  winnerExternalId: string,
  loserExternalId: string,
  score?: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()

  // Determine round from matchId (format: "ext-id-ROUND-001")
  const parts = matchId.split('-')
  // Round is the second-to-last segment
  const roundSegment = parts[parts.length - 2]
  const validRounds = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']
  if (!validRounds.includes(roundSegment)) {
    return { ok: false, error: `Cannot determine round from matchId "${matchId}"` }
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

  revalidateTag('tournament-detail')
  return { ok: true }
}
