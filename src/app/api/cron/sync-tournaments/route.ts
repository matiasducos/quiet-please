import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const BASE_URL = 'https://api.api-tennis.com/tennis/'

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false  // Fail closed — never open if secret is missing
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

// ── Name normalisation for migration matching ───────────────────────────────
// Strips 4-digit years, punctuation, and extra whitespace so that
// "Australian Open 2026" and "Australian Open" resolve to the same key.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, '')          // strip years like 2024, 2025, 2026
    .replace(/[^a-z0-9\s]/g, ' ')         // replace punctuation with space
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Tour / category helpers (mirrored in the adapter — kept in sync) ────────

function normalizeTour(type: string): 'ATP' | 'WTA' | null {
  const t = (type ?? '').toUpperCase()
  if (t.includes('ATP') && !t.includes('CHALLENGER') && !t.includes('DOUBLES')) return 'ATP'
  if (t.includes('WTA') && !t.includes('DOUBLES')) return 'WTA'
  return null
}

function normalizeCategory(tournamentName: string): string {
  const n = (tournamentName ?? '').toLowerCase()

  const grandSlams = ['australian open', 'roland garros', 'french open', 'wimbledon', 'us open']
  if (grandSlams.some(g => n.includes(g))) return 'grand_slam'

  const masters = [
    'indian wells', 'bnp paribas open', 'miami open',
    'monte-carlo', 'monte carlo', 'madrid open', 'mutua madrid',
    'italian open', 'internazionali bnl', "internazionali d'italia", 'rome masters',
    'canadian open', 'rogers cup', 'national bank open',
    'western & southern', 'cincinnati',
    'shanghai', 'rolex shanghai', 'paris masters', 'rolex paris',
    'china open', 'beijing open', 'wuhan open',
  ]
  if (masters.some(m => n.includes(m))) return 'masters_1000'

  const fiveHundred = [
    'abn amro', 'rotterdam', 'dubai', 'acapulco', 'open mexicano',
    'barcelona open', 'banc sabadell',
    "queen's club", 'cinch championships',
    'terra wortmann', 'halle open', 'citi open', 'washington open',
    'erste bank', 'vienna open', 'swiss indoors', 'basel open',
    'ostrava open', 'linz open', 'mubadala abu dhabi', 'bad homburg',
  ]
  if (fiveHundred.some(f => n.includes(f))) return '500'

  return '250'
}

// ── API fetch ───────────────────────────────────────────────────────────────

async function fetchApiTournaments(apiKey: string): Promise<any[]> {
  const url = new URL(BASE_URL)
  url.searchParams.set('APIkey', apiKey)
  url.searchParams.set('method', 'get_tournaments')

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),  // longer timeout — this is the main sync call
  })

  if (!res.ok) {
    throw new Error(`api-tennis HTTP ${res.status}: ${res.statusText}`)
  }

  const json = await res.json()
  if (!json.success) {
    throw new Error(`api-tennis error: ${json.error ?? JSON.stringify(json)}`)
  }
  return json.result ?? []
}

// ── Route ───────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.TENNIS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'TENNIS_API_KEY not configured' }, { status: 500 })
  }

  // ── 1. Fetch from api-tennis.com ─────────────────────────────────────────
  let apiTournaments: any[]
  try {
    apiTournaments = await fetchApiTournaments(apiKey)
  } catch (err) {
    return NextResponse.json({
      error: 'Failed to fetch tournaments from api-tennis.com',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  // ── 2. Load all existing DB rows ─────────────────────────────────────────
  const supabase = createAdminClient()
  const { data: dbTournaments, error: dbError } = await supabase
    .from('tournaments')
    .select('id, name, external_id, starts_at')

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  // Primary map: "external_id::year" → DB row
  //   Used to check if we already have this year's entry — if so, skip entirely.
  //   api-tennis.com uses a stable key per tournament; tournament_date is always
  //   the CURRENT year's occurrence. So Australian Open 2025 and 2026 both have
  //   the same external_id but different years in starts_at.
  const dbByExternalIdYear = new Map<string, { id: string; external_id: string }>()

  // Secondary map: normalizedName → DB row
  //   Used to migrate legacy rows that have a null or stale external_id.
  //   First match wins (keeps whichever row was inserted first).
  const dbByName = new Map<string, { id: string; external_id: string | null }>()

  for (const t of dbTournaments ?? []) {
    const nameKey = normalizeName(t.name)
    if (!dbByName.has(nameKey)) {
      dbByName.set(nameKey, { id: t.id, external_id: t.external_id })
    }
    if (t.external_id && t.starts_at) {
      const year = new Date(t.starts_at).getUTCFullYear()
      dbByExternalIdYear.set(`${t.external_id}::${year}`, { id: t.id, external_id: t.external_id })
    }
  }

  // ── 3. Classify each API entry as migrate / insert / skip ────────────────
  const toMigrate: Array<{ id: string; newExternalId: string; name: string }> = []
  const toInsert: any[] = []
  const skipped: string[] = []

  // Track yearKeys queued for insert in this run to deduplicate API duplicates
  const insertedByYearKey = new Set<string>()

  for (const raw of apiTournaments) {
    const tour = normalizeTour(raw.event_type_type ?? '')
    if (!tour) {
      // Skip ITF, Challenger, Doubles, team events, etc.
      skipped.push(raw.tournament_name ?? String(raw.tournament_key))
      continue
    }

    const name: string = raw.tournament_name ?? 'Unknown'
    const externalId    = String(raw.tournament_key)
    const normalizedName = normalizeName(name)

    // tournament_date is the CURRENT year's occurrence date for this tournament
    const startsAt = raw.tournament_date
      ? new Date(raw.tournament_date).toISOString()
      : null
    const year = startsAt ? new Date(startsAt).getUTCFullYear() : null
    const yearKey = year ? `${externalId}::${year}` : null

    // ── Skip if this (external_id, year) already exists in DB ──
    if (yearKey && dbByExternalIdYear.has(yearKey)) continue

    // ── Skip if we already queued this yearKey in this run (API duplicates) ──
    if (yearKey && insertedByYearKey.has(yearKey)) continue

    // ── Migrate external_id on the name-matched row if it's stale ──
    // (Handles legacy rows seeded with old RapidAPI external_ids or null)
    const nameMatch = dbByName.get(normalizedName)
    if (nameMatch && nameMatch.external_id !== externalId) {
      toMigrate.push({ id: nameMatch.id, newExternalId: externalId, name })
    }

    // ── Queue new row for insertion ──
    // When yearKey is present: always insert — this is a genuinely new year entry
    //   (Australian Open 2026 when DB only has Australian Open 2025, for example).
    // When tournament_date is missing (yearKey null): only insert if there's no
    //   name-matched row at all, to avoid creating a duplicate of an unknown year.
    if (yearKey || !nameMatch) {
      toInsert.push({
        external_id:   externalId,
        name,
        tour,
        category:      normalizeCategory(name),
        surface:       null,        // No surface from API — set manually in admin
        starts_at:     startsAt,
        ends_at:       startsAt,   // Correct ends_at must be set manually
        draw_close_at: startsAt,   // Update manually before the draw opens
        status:        'upcoming',
      })
      if (yearKey) insertedByYearKey.add(yearKey)
    }
  }

  // ── 4. Run migrations (update external_id for name-matched existing rows) ─
  const migrated: string[] = []
  const errors: string[] = []

  for (const { id, newExternalId, name } of toMigrate) {
    const { error } = await supabase
      .from('tournaments')
      .update({ external_id: newExternalId })
      .eq('id', id)

    if (error) {
      errors.push(`Migration failed for "${name}": ${error.message}`)
    } else {
      migrated.push(name)
    }
  }

  // ── 5. Insert genuinely new year entries ─────────────────────────────────
  // We use plain insert (not upsert) because the year-aware map check above
  // already filtered out all entries that exist in the DB.
  // Unique constraint: (external_id, date_trunc('year', starts_at)) — see migration 008.
  let insertedCount = 0
  if (toInsert.length) {
    const { error: insertError } = await supabase
      .from('tournaments')
      .insert(toInsert)

    if (insertError) {
      errors.push(`Insert error: ${insertError.message}`)
    } else {
      insertedCount = toInsert.length
    }
  }

  return NextResponse.json({
    message:        'Tournaments synced',
    api_total:      apiTournaments.length,
    migrated_count: migrated.length,
    migrated,
    inserted:       insertedCount,
    skipped_count:  skipped.length,
    ...(errors.length ? { errors } : {}),
  })
}
