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

async function fetchCalendar(type: 'atp' | 'wta', year: number) {
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

  try {
    const supabase = createAdminClient()
    const year = new Date().getFullYear()
    const rows: any[] = []

    for (const type of ['atp', 'wta'] as const) {
      await new Promise(r => setTimeout(r, 500)) // rate limit
      const tournaments = await fetchCalendar(type, year)

      for (const t of tournaments) {
        const startsAt = t.date ? new Date(t.date).toISOString() : null
        if (!startsAt) continue

        const category = normalizeCategory(t.rankId ?? 2)
        if (!category) continue  // skip unsupported formats (e.g. Tour Finals)

        rows.push({
          external_id:   String(t.id),
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

    if (!rows.length) {
      return NextResponse.json({ message: 'No tournaments found', synced: 0 })
    }

    const { error, count } = await supabase
      .from('tournaments')
      .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id', { count: 'exact' })

    if (error) throw error

    return NextResponse.json({
      message: 'Tournaments synced successfully',
      synced: count,
      total_from_api: rows.length,
      year,
    })
  } catch (err) {
    console.error('[sync-tournaments] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
