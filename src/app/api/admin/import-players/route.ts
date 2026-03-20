import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// Allow up to 2 minutes — parallel get_players calls across 100+ tournaments
export const maxDuration = 120

const BASE_URL = 'https://api.api-tennis.com/tennis/'

async function callApi(apiKey: string, params: Record<string, string>) {
  const url = new URL(BASE_URL)
  url.searchParams.set('APIkey', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (Number(json.success) !== 1) throw new Error(json.error ?? 'API error')
  return json.result ?? []
}

export async function POST() {
  // ── Auth guard ────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'development') {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminIds = (process.env.ADMIN_USER_IDS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean)
    if (!adminIds.includes(user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const apiKey = process.env.TENNIS_API_KEY
  if (!apiKey) return NextResponse.json({ ok: false, error: 'TENNIS_API_KEY not configured' })

  const admin = createAdminClient()

  // ── 1. Delete all existing players ──────────────────────────────────────
  const { count: deleted, error: delError } = await admin
    .from('players')
    .delete({ count: 'exact' })
    .gte('created_at', '1970-01-01')   // Supabase requires a WHERE for deletes
  if (delError) {
    return NextResponse.json({ ok: false, error: `Delete failed: ${delError.message}` })
  }

  // ── 2. Fetch all tournaments and classify ATP / WTA ─────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allTournaments: any[]
  try {
    allTournaments = await callApi(apiKey, { method: 'get_tournaments' })
  } catch (err) {
    return NextResponse.json({ ok: false, deleted, error: `get_tournaments failed: ${String(err)}` })
  }

  const tourMap: Record<string, 'ATP' | 'WTA'> = {}
  for (const t of allTournaments) {
    const type = ((t.event_type_type ?? '') as string).toUpperCase()
    if (type.includes('ATP') && !type.includes('CHALLENGER') && !type.includes('DOUBLES')) {
      tourMap[String(t.tournament_key)] = 'ATP'
    } else if (type.includes('WTA') && !type.includes('DOUBLES')) {
      tourMap[String(t.tournament_key)] = 'WTA'
    }
  }

  const entries = Object.entries(tourMap)
  if (entries.length === 0) {
    return NextResponse.json({ ok: false, deleted, imported: 0, tournamentsScanned: 0, error: 'No ATP/WTA tournaments found' })
  }

  // ── 3. Fetch players per tournament in parallel batches ─────────────────
  const players = new Map<string, { name: string; country: string; tour: 'ATP' | 'WTA' }>()
  const BATCH_SIZE = 10
  let scanned = 0
  let apiErrors = 0

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async ([key, tour]) => {
        const result = await callApi(apiKey, { method: 'get_players', tournament_key: key })
        return { result, tour }
      }),
    )

    scanned += batch.length

    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value.result)) {
        for (const p of r.value.result) {
          const pk = String(p.player_key ?? '').trim()
          if (pk && !players.has(pk)) {
            players.set(pk, {
              name: String(p.player_name ?? '').trim(),
              country: String(p.player_country ?? '').trim(),
              tour: r.value.tour,
            })
          }
        }
      } else {
        apiErrors++
      }
    }

    // If many errors and no players yet, bail early
    if (apiErrors >= 20 && players.size === 0) {
      return NextResponse.json({
        ok: false, deleted, imported: 0, tournamentsScanned: scanned,
        error: `Too many API errors (${apiErrors}) with zero players found`,
      })
    }
  }

  if (players.size === 0) {
    return NextResponse.json({
      ok: false, deleted, imported: 0, tournamentsScanned: scanned,
      error: 'No players found from any tournament',
    })
  }

  // ── 4. Bulk insert into players table ───────────────────────────────────
  const rows = [...players.entries()].map(([externalId, p]) => ({
    external_id: externalId,
    name: p.name,
    country: p.country,
    tour: p.tour,
  }))

  let imported = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { data: inserted, error } = await admin
      .from('players')
      .insert(chunk)
      .select('id')
    if (error) {
      return NextResponse.json({
        ok: false, deleted, imported, tournamentsScanned: scanned,
        error: `Insert batch ${Math.floor(i / 500) + 1} failed: ${error.message}`,
      })
    }
    imported += inserted?.length ?? 0
  }

  return NextResponse.json({ ok: true, deleted, imported, tournamentsScanned: scanned, apiErrors })
}
