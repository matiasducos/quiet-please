import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

const BASE_URL = 'https://api.api-tennis.com/tennis/'

async function callApi(apiKey: string, params: Record<string, string>, timeoutMs = 12_000) {
  const url = new URL(BASE_URL)
  url.searchParams.set('APIkey', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (Number(json.success) !== 1) throw new Error(json.error ?? 'API error')
  return json.result ?? []
}

async function requireAdmin() {
  if (process.env.NODE_ENV === 'development') return
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Unauthorized')
    const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (!adminIds.includes(user.id)) throw new Error('Forbidden')
  } catch (err) {
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Progressive import — split into two actions so each request is fast:
//
//   POST { action: "init" }
//     → Deletes all players, fetches tournament list from Tennis API,
//       returns { tournaments: [{ key, tour }...] } for the client to chunk.
//
//   POST { action: "batch", tournaments: [{ key, tour }...] }
//     → Fetches get_players for each tournament (max ~10), upserts into DB,
//       returns { imported: N }.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    await requireAdmin()

    const apiKey = process.env.TENNIS_API_KEY
    if (!apiKey) return NextResponse.json({ ok: false, error: 'TENNIS_API_KEY not configured' })

    const body = await request.json().catch(() => ({}))
    const action = body.action ?? 'init'

    if (action === 'init') {
      return await handleInit(apiKey)
    } else if (action === 'batch') {
      return await handleBatch(apiKey, body.tournaments ?? [])
    } else {
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Unauthorized') return NextResponse.json({ ok: false, error: msg }, { status: 401 })
    if (msg === 'Forbidden') return NextResponse.json({ ok: false, error: msg }, { status: 403 })
    return NextResponse.json({ ok: false, error: `Unexpected error: ${msg}` }, { status: 500 })
  }
}

// ── Phase 1: Delete players + return tournament list ─────────────────────────
async function handleInit(apiKey: string) {
  const admin = createAdminClient()

  // Delete all existing players
  const { count: deleted, error: delError } = await admin
    .from('players')
    .delete({ count: 'exact' })
    .gte('created_at', '1970-01-01')
  if (delError) {
    return NextResponse.json({ ok: false, error: `Delete failed: ${delError.message}` })
  }

  // Fetch tournament list from Tennis API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allTournaments: any[]
  try {
    allTournaments = await callApi(apiKey, { method: 'get_tournaments' }, 20_000)
  } catch (err) {
    return NextResponse.json({ ok: false, deleted, error: `get_tournaments failed: ${String(err)}` })
  }

  // Classify ATP / WTA (excluding challengers and doubles)
  const tournaments: { key: string; tour: 'ATP' | 'WTA' }[] = []
  for (const t of allTournaments) {
    const type = ((t.event_type_type ?? '') as string).toUpperCase()
    if (type.includes('ATP') && !type.includes('CHALLENGER') && !type.includes('DOUBLES')) {
      tournaments.push({ key: String(t.tournament_key), tour: 'ATP' })
    } else if (type.includes('WTA') && !type.includes('DOUBLES')) {
      tournaments.push({ key: String(t.tournament_key), tour: 'WTA' })
    }
  }

  return NextResponse.json({ ok: true, action: 'init', deleted, tournaments })
}

// ── Phase 2: Fetch + upsert players for a batch of tournaments ───────────────
async function handleBatch(apiKey: string, tournaments: { key: string; tour: 'ATP' | 'WTA' }[]) {
  if (!tournaments.length) {
    return NextResponse.json({ ok: true, action: 'batch', imported: 0, scanned: 0, errors: 0 })
  }

  const admin = createAdminClient()
  const players = new Map<string, { name: string; country: string; tour: 'ATP' | 'WTA' }>()
  let apiErrors = 0

  // Fetch all tournaments in this batch in parallel (max ~10 at a time)
  const results = await Promise.allSettled(
    tournaments.map(async ({ key, tour }) => {
      const result = await callApi(apiKey, { method: 'get_players', tournament_key: key })
      return { result, tour }
    }),
  )

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

  // Upsert — ignore duplicates from other batches
  let imported = 0
  if (players.size > 0) {
    const rows = [...players.entries()].map(([externalId, p]) => ({
      external_id: externalId,
      name: p.name,
      country: p.country,
      tour: p.tour,
    }))

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500)
      const { data: inserted, error } = await admin
        .from('players')
        .upsert(chunk, { onConflict: 'external_id', ignoreDuplicates: true })
        .select('id')
      if (error) {
        return NextResponse.json({
          ok: false, action: 'batch', imported, scanned: tournaments.length,
          error: `Insert failed: ${error.message}`,
        })
      }
      imported += inserted?.length ?? 0
    }
  }

  return NextResponse.json({
    ok: true, action: 'batch', imported, scanned: tournaments.length, errors: apiErrors,
  })
}
