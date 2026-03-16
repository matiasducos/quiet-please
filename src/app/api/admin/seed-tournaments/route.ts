import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

// Known 2026 ATP + WTA major events not returned by the API calendar endpoint
// (API only returns the last 11 events of the year, so it misses the spring/summer season)
// Dates are start-of-tournament; external_id prefix "manual-" distinguishes from API-synced rows
const SEED_TOURNAMENTS = [
  // ── ATP ──────────────────────────────────────────────────────────
  { external_id: 'manual-atp-miami-2026',      name: 'Miami Open',                      tour: 'ATP', category: 'masters_1000', surface: 'hard',  starts_at: '2026-03-25' },
  { external_id: 'manual-atp-monte-carlo-2026', name: 'Monte-Carlo Masters',             tour: 'ATP', category: 'masters_1000', surface: 'clay',  starts_at: '2026-04-06' },
  { external_id: 'manual-atp-barcelona-2026',  name: 'Barcelona Open',                  tour: 'ATP', category: '500',           surface: 'clay',  starts_at: '2026-04-20' },
  { external_id: 'manual-atp-madrid-2026',     name: 'Madrid Open',                     tour: 'ATP', category: 'masters_1000', surface: 'clay',  starts_at: '2026-04-27' },
  { external_id: 'manual-atp-rome-2026',       name: 'Internazionali BNL d\'Italia',    tour: 'ATP', category: 'masters_1000', surface: 'clay',  starts_at: '2026-05-11' },
  { external_id: 'manual-atp-rg-2026',         name: 'Roland Garros',                   tour: 'ATP', category: 'grand_slam',   surface: 'clay',  starts_at: '2026-05-24' },
  { external_id: 'manual-atp-stuttgart-2026',  name: 'Stuttgart Open',                  tour: 'ATP', category: '500',           surface: 'grass', starts_at: '2026-06-08' },
  { external_id: 'manual-atp-queens-2026',     name: 'Cinch Championships (Queen\'s)',  tour: 'ATP', category: '500',           surface: 'grass', starts_at: '2026-06-15' },
  { external_id: 'manual-atp-halle-2026',      name: 'Terra Wortmann Open (Halle)',     tour: 'ATP', category: '500',           surface: 'grass', starts_at: '2026-06-15' },
  { external_id: 'manual-atp-wimbledon-2026',  name: 'Wimbledon',                       tour: 'ATP', category: 'grand_slam',   surface: 'grass', starts_at: '2026-06-29' },
  { external_id: 'manual-atp-hamburg-2026',    name: 'Hamburg Open',                    tour: 'ATP', category: '500',           surface: 'clay',  starts_at: '2026-07-20' },
  { external_id: 'manual-atp-washington-2026', name: 'Mubadala Citi DC Open',           tour: 'ATP', category: '500',           surface: 'hard',  starts_at: '2026-07-27' },
  { external_id: 'manual-atp-canada-2026',     name: 'National Bank Open (Toronto)',    tour: 'ATP', category: 'masters_1000', surface: 'hard',  starts_at: '2026-08-03' },
  { external_id: 'manual-atp-cincinnati-2026', name: 'Cincinnati Masters',              tour: 'ATP', category: 'masters_1000', surface: 'hard',  starts_at: '2026-08-10' },
  { external_id: 'manual-atp-usopen-2026',     name: 'US Open',                         tour: 'ATP', category: 'grand_slam',   surface: 'hard',  starts_at: '2026-08-31' },

  // ── WTA ──────────────────────────────────────────────────────────
  { external_id: 'manual-wta-miami-2026',      name: 'Miami Open',                      tour: 'WTA', category: 'masters_1000', surface: 'hard',  starts_at: '2026-03-25' },
  { external_id: 'manual-wta-charleston-2026', name: 'Charleston Open',                 tour: 'WTA', category: '500',           surface: 'clay',  starts_at: '2026-04-06' },
  { external_id: 'manual-wta-stuttgart-2026',  name: 'Porsche Tennis Grand Prix',       tour: 'WTA', category: '500',           surface: 'clay',  starts_at: '2026-04-20' },
  { external_id: 'manual-wta-madrid-2026',     name: 'Madrid Open',                     tour: 'WTA', category: 'masters_1000', surface: 'clay',  starts_at: '2026-04-27' },
  { external_id: 'manual-wta-rome-2026',       name: 'Internazionali BNL d\'Italia',    tour: 'WTA', category: 'masters_1000', surface: 'clay',  starts_at: '2026-05-11' },
  { external_id: 'manual-wta-rg-2026',         name: 'Roland Garros',                   tour: 'WTA', category: 'grand_slam',   surface: 'clay',  starts_at: '2026-05-24' },
  { external_id: 'manual-wta-berlin-2026',     name: 'bett1open (Berlin)',              tour: 'WTA', category: '500',           surface: 'grass', starts_at: '2026-06-15' },
  { external_id: 'manual-wta-eastbourne-2026', name: 'Rothesay International Eastbourne', tour: 'WTA', category: '500',         surface: 'grass', starts_at: '2026-06-22' },
  { external_id: 'manual-wta-wimbledon-2026',  name: 'Wimbledon',                       tour: 'WTA', category: 'grand_slam',   surface: 'grass', starts_at: '2026-06-29' },
  { external_id: 'manual-wta-canada-2026',     name: 'National Bank Open (Montréal)',   tour: 'WTA', category: 'masters_1000', surface: 'hard',  starts_at: '2026-08-03' },
  { external_id: 'manual-wta-cincinnati-2026', name: 'Cincinnati Open',                 tour: 'WTA', category: '500',           surface: 'hard',  starts_at: '2026-08-10' },
  { external_id: 'manual-wta-usopen-2026',     name: 'US Open',                         tour: 'WTA', category: 'grand_slam',   surface: 'hard',  starts_at: '2026-08-31' },
]

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    const rows = SEED_TOURNAMENTS.map(t => ({
      external_id:   t.external_id,
      name:          t.name,
      tour:          t.tour,
      category:      t.category,
      surface:       t.surface,
      starts_at:     new Date(t.starts_at).toISOString(),
      ends_at:       new Date(t.starts_at).toISOString(),
      draw_close_at: new Date(t.starts_at).toISOString(),
      status:        'upcoming' as const,
    }))

    const { error } = await supabase
      .from('tournaments')
      .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false })

    if (error) throw error

    return NextResponse.json({
      message: 'Seed complete',
      inserted: rows.length,
      tournaments: rows.map(r => `${r.tour} | ${r.starts_at.slice(0, 10)} | ${r.name}`),
    })
  } catch (err) {
    console.error('[seed-tournaments] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
