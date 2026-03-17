import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const RAPIDAPI_KEY = process.env.TENNIS_API_KEY!
const BASE = 'https://tennis-api-atp-wta-itf.p.rapidapi.com/tennis'

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function fetchCalendar(type: 'atp' | 'wta', year: number): Promise<any[]> {
  const url = `${BASE}/v2/${type}/tournament/calendar/${year}`
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': 'tennis-api-atp-wta-itf.p.rapidapi.com',
    },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`API error ${res.status} for ${type} ${year}`)
  const json = await res.json()
  return (json.data ?? []) as any[]
}

function normalizeCategory(rankId: number): string | null {
  if (rankId === 1) return 'grand_slam'
  if (rankId === 3) return 'masters_1000'
  if (rankId === 5) return '500'
  if (rankId === 7) return null  // Tour Finals — round-robin format, skip
  return '250'
}

function normalizeSurface(courtName: string): string {
  const c = (courtName ?? '').toLowerCase()
  if (c.includes('clay')) return 'clay'
  if (c.includes('grass')) return 'grass'
  return 'hard'
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const currentYear = new Date().getFullYear()
  const yearsToSync = [currentYear - 1, currentYear, currentYear + 1]

  const allRows: any[] = []
  const seen = new Set<string>() // dedup external_ids across years
  const errors: string[] = []

  for (const year of yearsToSync) {
    for (const type of ['atp', 'wta'] as const) {
      await new Promise(r => setTimeout(r, 500)) // rate limit

      let tournaments: any[]
      try {
        tournaments = await fetchCalendar(type, year)
      } catch (err) {
        const msg = `Failed to fetch ${type.toUpperCase()} ${year}: ${err instanceof Error ? err.message : err}`
        console.error(`[sync-tournaments] ${msg}`)
        errors.push(msg)
        continue // don't abort — keep syncing other years/tours
      }

      for (const t of tournaments) {
        const externalId = String(t.id)
        if (seen.has(externalId)) continue
        seen.add(externalId)

        const category = normalizeCategory(t.rankId ?? 2)
        if (!category) continue  // skip unsupported formats (e.g. Tour Finals)

        // startsAt may be null — store the event anyway so it appears once confirmed
        const startsAt = t.date ? new Date(t.date).toISOString() : null

        allRows.push({
          external_id:   externalId,
          name:          t.name,
          tour:          type.toUpperCase(),
          category,
          surface:       normalizeSurface(t.court?.name ?? ''),
          starts_at:     startsAt,
          ends_at:       startsAt, // API doesn't return end date on calendar
          draw_close_at: startsAt, // default to start date, update manually
          status:        'upcoming',
        })
      }
    }
  }

  if (!allRows.length && errors.length) {
    return NextResponse.json({ error: 'All API calls failed', errors }, { status: 500 })
  }

  // Pass 1: INSERT new tournaments only.
  // ignoreDuplicates: true preserves status, location, flag_emoji, ends_at, draw_close_at
  // that may have been set manually or by other crons.
  const { error: insertError, count: insertCount } = await supabase
    .from('tournaments')
    .upsert(allRows, { onConflict: 'external_id', ignoreDuplicates: true })
    .select('id', { count: 'exact' })

  if (insertError) {
    console.error('[sync-tournaments] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Pass 2: backfill confirmed dates for events that were previously stored with null starts_at.
  // Only update starts_at / ends_at / draw_close_at — never touch status, location, or flag_emoji.
  const rowsWithDates = allRows.filter(r => r.starts_at !== null)
  let backfilledCount = 0

  if (rowsWithDates.length) {
    const { data: nullDateRows } = await supabase
      .from('tournaments')
      .select('external_id')
      .in('external_id', rowsWithDates.map(r => r.external_id))
      .is('starts_at', null)

    if (nullDateRows?.length) {
      const toUpdate = new Map(rowsWithDates.map(r => [r.external_id, r]))

      for (const { external_id } of nullDateRows) {
        const row = toUpdate.get(external_id)
        if (!row) continue

        const { error: updateError } = await supabase
          .from('tournaments')
          .update({
            starts_at:     row.starts_at,
            ends_at:       row.ends_at,
            draw_close_at: row.draw_close_at,
          })
          .eq('external_id', external_id)

        if (updateError) {
          console.error(`[sync-tournaments] Failed to backfill ${external_id}:`, updateError)
        } else {
          backfilledCount++
        }
      }
    }
  }

  return NextResponse.json({
    message: 'Tournaments synced',
    years: yearsToSync,
    total_from_api: allRows.length,
    inserted: insertCount,
    backfilled: backfilledCount,
    ...(errors.length ? { partial_errors: errors } : {}),
  })
}
