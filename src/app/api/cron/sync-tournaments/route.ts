import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    console.log('[sync-tournaments] Fetching upcoming tournaments...')

    const tournaments = await tennisAdapter.getUpcomingTournaments()

    console.log(`[sync-tournaments] Got ${tournaments.length} tournaments from API`)

    if (tournaments.length === 0) {
      return NextResponse.json({ message: 'No tournaments found', synced: 0 })
    }

    const rows = tournaments.map(t => ({
      external_id:   t.externalId,
      name:          t.name,
      tour:          t.tour,
      category:      t.category,
      surface:       t.surface,
      draw_close_at: t.drawCloseAt,
      starts_at:     t.startsAt,
      ends_at:       t.endsAt,
      status:        'upcoming' as const,
    }))

    const { data: upserted, error } = await supabase
      .from('tournaments')
      .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id')

    const count = upserted?.length ?? 0

    if (error) {
      console.error('[sync-tournaments] DB error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log(`[sync-tournaments] Upserted ${count} tournaments`)

    return NextResponse.json({
      message: 'Tournaments synced successfully',
      synced: count,
      total_from_api: tournaments.length,
    })
  } catch (err) {
    console.error('[sync-tournaments] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}