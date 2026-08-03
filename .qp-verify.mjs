import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Parse the VALUES tuples straight out of the migration — verifying a
// transcription of the file would defeat the purpose.
const sql = fs.readFileSync('supabase/migrations/073_backfill_tournament_series.sql', 'utf8')
const body = sql.slice(sql.indexOf('values'), sql.indexOf('),\nnew_series'))
const rows = [...body.matchAll(/\('((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'\)/g)]
  .map(m => m.slice(1, 5).map(s => s.replace(/''/g, "'")))
  .map(([external_id, slug, name, short_name]) => ({ external_id, slug, name, short_name }))

console.log(`parsed ${rows.length} mapping rows from the migration`)
let fail = 0
const bad = (msg) => { console.log('  ✗ ' + msg); fail++ }

if (rows.length !== 34) bad(`expected 34 mapping rows, parsed ${rows.length}`)

// 1. Every external_id must match exactly one 2026 tournament.
const { data: tournaments, error } = await sb
  .from('tournaments').select('id, external_id, name, starts_year, location, flag_emoji, surface, category')
if (error) { console.error('query failed:', error.message); process.exit(1) }

const byExt = new Map(tournaments.filter(t => t.starts_year === 2026).map(t => [t.external_id, t]))
console.log(`\n1. external_id → tournament match (${byExt.size} tournaments in DB for 2026)`)
for (const r of rows) {
  const t = byExt.get(r.external_id)
  if (!t) bad(`no 2026 tournament with external_id "${r.external_id}"  (slug ${r.slug})`)
}
const mapped = new Set(rows.map(r => r.external_id))
for (const t of byExt.values()) {
  if (!mapped.has(t.external_id)) bad(`tournament "${t.name}" (external_id ${t.external_id}) is NOT in the mapping — it would get no slug`)
}

// 2. Slug uniqueness + DB CHECK constraints.
console.log('\n2. slug format + uniqueness')
const seen = new Set()
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
for (const r of rows) {
  if (seen.has(r.slug)) bad(`duplicate slug "${r.slug}"`)
  seen.add(r.slug)
  if (!KEBAB.test(r.slug)) bad(`slug "${r.slug}" fails the kebab-case CHECK`)
  if (UUID.test(r.slug)) bad(`slug "${r.slug}" is UUID-shaped and would be unreachable`)
  if (r.slug.length < 2 || r.slug.length > 60) bad(`slug "${r.slug}" fails the length CHECK (${r.slug.length})`)
}

// 3. location must split cleanly into "City, Country" — the series insert relies on it.
console.log('\n3. location parses as "City, Country"')
for (const r of rows) {
  const t = byExt.get(r.external_id)
  if (!t) continue
  const parts = (t.location ?? '').split(', ')
  if (parts.length !== 2 || !parts[0] || !parts[1]) bad(`"${t.name}" location=${JSON.stringify(t.location)} does not split into exactly City, Country`)
  if (!t.flag_emoji) bad(`"${t.name}" has no flag_emoji`)
  if (!t.surface) bad(`"${t.name}" has no surface — series.surface would be NULL`)
}

// 4. No two series would collide on (series, year, tour).
console.log('\n4. (series, year, tour) uniqueness')
const key = new Set()
for (const r of rows) {
  const t = byExt.get(r.external_id)
  if (!t) continue
  const k = `${r.slug}|2026|ATP`
  if (key.has(k)) bad(`two tournaments map to slug "${r.slug}" for 2026/ATP`)
  key.add(k)
}

console.log('\n' + (fail === 0 ? '✅ all checks passed — migration is safe to run' : `❌ ${fail} problem(s) found`))

// Show the resulting URL map for a final human read.
console.log('\n--- resulting URLs ---')
for (const r of rows.sort((a, b) => a.slug.localeCompare(b.slug))) {
  const t = byExt.get(r.external_id)
  console.log(`/tournaments/${r.slug}/2026`.padEnd(52) + ` ← ${t?.name ?? '??'}`)
}
process.exit(fail === 0 ? 0 : 1)
