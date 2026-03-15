import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'
import type { Json } from '@/types/database'

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
    const { data: tournaments, error: fetchError } = await supabase
      .from('tournaments')
      .select('id, external_id, name, status')
      .in('status', ['upcoming', 'accepting_predictions'])
      .order('starts_at', { ascending: true })
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
    if (!tournaments || tournaments.length === 0) {
      return NextResponse.json({ message: 'No tournaments to sync', synced: 0 })
    }
    console.log(`[sync-draws] Syncing ${tournaments.length} tournaments`)
    const results = []
    for (const tournament of tournaments) {
      try {
        const draw = await tennisAdapter.getDraw(tournament.external_id)
        if (!draw.matches || draw.matches.length === 0) {
          results.push({ name: tournament.name, status: 'no_draw' })
          continue
        }
        const { error: drawError } = await supabase
          .from('draws')
          .upsert({ tournament_id: tournament.id, bracket_data: draw as unknown as Json, synced_at: new Date().toISOString() }, { onConflict: 'tournament_id' })
        if (drawError) { results.push({ name: tournament.name, status: 'error', error: drawError.message }); continue }
        if (tournament.status === 'upcoming') {
          await supabase.from('tournaments').update({ status: 'accepting_predictions' }).eq('id', tournament.id)
        }
        results.push({ name: tournament.name, status: 'synced', matches: draw.matches.length })
      } catch (err) {
        results.push({ name: tournament.name, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      }
    }
    return NextResponse.json({ message: 'Draw sync complete', results })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
