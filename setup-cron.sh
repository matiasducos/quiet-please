#!/bin/bash
set -e
mkdir -p src/app/api/cron/sync-tournaments
mkdir -p src/app/api/cron/sync-draws

cat > src/app/api/cron/sync-tournaments/route.ts << 'EOF'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'

function isAuthorized(request: Request): boolean {
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
    const now = new Date()
    const from = now.toISOString().split('T')[0]
    const to = new Date(now.setMonth(now.getMonth() + 3)).toISOString().split('T')[0]
    console.log(`[sync-tournaments] Fetching from ${from} to ${to}`)
    const tournaments = await tennisAdapter.getTournaments(from, to)
    console.log(`[sync-tournaments] Got ${tournaments.length} tournaments`)
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
    const { error, count } = await supabase
      .from('tournaments')
      .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id', { count: 'exact' })
    if (error) {
      console.error('[sync-tournaments] DB error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ message: 'Tournaments synced', synced: count, from, to })
  } catch (err) {
    console.error('[sync-tournaments] Error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
EOF

cat > src/app/api/cron/sync-draws/route.ts << 'EOF'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'

function isAuthorized(request: Request): boolean {
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
          .upsert({ tournament_id: tournament.id, bracket_data: draw as unknown as Record<string, unknown>, synced_at: new Date().toISOString() }, { onConflict: 'tournament_id' })
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
EOF

echo "✅ Cron routes written successfully"
