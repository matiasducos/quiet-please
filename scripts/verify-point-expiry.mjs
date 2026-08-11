#!/usr/bin/env node
/**
 * Verifies migration 079's apply_point_expiry() against a hand-computed fixture
 * in a throwaway Postgres container.
 *
 * Why this exists rather than "run it and look": nothing in prod expires until
 * 2027-03-29, so the function is a no-op against real data today. A parse check
 * and a logic sim can both pass while the SQL is silently wrong — that has
 * happened on this project before. This loads the REAL migration file (never a
 * copy) into a real Postgres and asserts every total against a number worked out
 * by hand in point-expiry/fixture.sql.
 *
 * Covers: the sole-expired-prediction case (must land on 0, not be skipped),
 * mixed expired/live, users with nothing expiring (must be left alone), challenge
 * brackets (invisible to both the batch and the aggregate), the ATP/WTA split,
 * league surface/type filters, dry-run purity, idempotence, and the hard
 * permanence invariant — point_ledger and predictions.points_earned must be
 * byte-identical before and after a sweep.
 *
 * Usage:  node scripts/verify-point-expiry.mjs
 * Needs:  docker
 */
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = [
  '079_apply_point_expiry.sql',
  '081_edition_based_expiry.sql',
  '082_calendar_gap_reminders.sql',
].map(f => join(HERE, '..', 'supabase', 'migrations', f))
const CONTAINER = 'qp-expiry-test'

const sh = (cmd) => execSync(cmd, { stdio: 'pipe' }).toString()
// psql writes RAISE NOTICE to stderr, so both streams have to come back —
// the assertion results live in stderr, not stdout.
const psql = (sql) => {
  const r = spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 't', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '/dev/stdin'],
    { input: sql, encoding: 'utf8' },
  )
  const merged = (r.stdout ?? '') + (r.stderr ?? '')
  if (r.status !== 0) throw new Error(merged)
  return merged
}

function cleanup() {
  try { sh(`docker rm -f ${CONTAINER}`) } catch { /* not running */ }
}

try { sh('docker info') } catch {
  console.error('docker is not running — this harness needs it')
  process.exit(2)
}

cleanup()
console.log('· starting postgres…')
sh(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=x -e POSTGRES_DB=t postgres:16-alpine`)

let up = false
for (let i = 0; i < 60; i++) {
  try { sh(`docker exec ${CONTAINER} pg_isready -U postgres -d t`); up = true; break } catch { /* retry */ }
  execSync('sleep 0.5')
}
if (!up) { cleanup(); console.error('postgres never became ready'); process.exit(2) }

try {
  // Roles the migration's GRANT/REVOKE reference. Supabase supplies these.
  psql('create role service_role; create role anon; create role authenticated;')
  psql(readFileSync(join(HERE, 'point-expiry', 'fixture.sql'), 'utf8'))

  for (const m of MIGRATIONS) {
    console.log(`· loading ${m.split('/').pop()}…`)
    psql(readFileSync(m, 'utf8'))
  }

  console.log('· asserting…\n')
  const out = psql(readFileSync(join(HERE, 'point-expiry', 'assert.sql'), 'utf8'))

  for (const line of out.split('\n')) {
    const m = line.match(/NOTICE:\s+(PASS|FAIL)\s+(.*)$/)
    if (m) console.log(`  ${m[1] === 'PASS' ? '✓' : '✗'} ${m[2]}`)
  }

  const failed = /FAILURE\(S\)/.test(out)
  console.log(`\n${failed ? '✗ FAILURES — see above' : '✓ all assertions passed'}`)
  process.exitCode = failed ? 1 : 0
} catch (err) {
  console.error("harness error:\n", err.message)
  process.exitCode = 2
} finally {
  cleanup()
}
