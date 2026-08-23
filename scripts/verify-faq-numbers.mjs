/**
 * FAQ number checker — "does the published points table match the scoring code?"
 *
 * The FAQ states what every round pays. Prose does not fail a typecheck, so the
 * day somebody retunes POINTS_TABLE this page starts lying to users about their
 * own score, silently and indefinitely. This re-reads the real scoring module
 * and compares it cell by cell against the table in the FAQ.
 *
 * Note the final. `award-points` passes `isWinner: true` for every 'F' result,
 * so `getPointsForRound` returns WINNER_POINTS and the 'F' entries in
 * POINTS_TABLE are never reached. The FAQ documents what is actually paid, so
 * that is what this asserts — and it is why the check calls the real function
 * rather than reading the table directly.
 *
 *   node scripts/verify-faq-numbers.mjs
 */

import { execFileSync } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { resolve, join } from 'path'
import { createRequire } from 'module'

const root = resolve(import.meta.dirname, '..')
const out = mkdtempSync(join(tmpdir(), 'faq-numbers-'))

execFileSync('npx', [
  'tsc', 'src/lib/tennis/points.ts', 'src/lib/tennis/bracket.ts', 'src/lib/tennis/types.ts',
  'src/lib/faq/content.ts',
  '--outDir', out, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck',
  '--rootDir', 'src',
], { cwd: root, stdio: 'inherit' })

const req = createRequire(import.meta.url)
const { getPointsForRound } = req(join(out, 'lib/tennis/points.js'))
const { FAQ_SECTIONS } = req(join(out, 'lib/faq/content.js'))

const ROUND_BY_LABEL = {
  'Round of 128': 'R128', 'Round of 64': 'R64', 'Round of 32': 'R32',
  'Round of 16': 'R16', 'Quarterfinal': 'QF', 'Semifinal': 'SF', 'Final': 'F',
}
const TIER_BY_COLUMN = {
  'Grand Slam': 'grand_slam',
  'Masters 1000 / WTA 1000': 'masters_1000',
  '500': '500',
  '250': '250',
}

const table = FAQ_SECTIONS
  .flatMap(s => s.questions)
  .find(q => q.id === 'points-table')
  ?.answer.find(b => b.type === 'table')

if (!table) { console.error('FAIL: no points table found in the FAQ (id "points-table")'); process.exit(1) }

const columns = table.head.slice(1)
let failures = 0, checked = 0

for (const row of table.rows) {
  const round = ROUND_BY_LABEL[row[0]]
  if (!round) { console.log(` FAIL  unknown round label "${row[0]}"`); failures++; continue }

  for (let i = 0; i < columns.length; i++) {
    const category = TIER_BY_COLUMN[columns[i]]
    if (!category) { console.log(` FAIL  unknown tier column "${columns[i]}"`); failures++; continue }

    const published = row[i + 1]
    // award-points treats every 'F' result as the title match.
    const actual = getPointsForRound(category, round, round === 'F')
    const expected = actual > 0 ? actual.toLocaleString('en-US') : '—'
    checked++

    if (published !== expected) {
      failures++
      console.log(` FAIL  ${row[0]} / ${columns[i]}: FAQ says "${published}", scoring pays "${expected}"`)
    }
  }
}

console.log(`\nchecked ${checked} published values against src/lib/tennis/points.ts`)
if (failures) { console.log(`${failures} mismatch(es) — the FAQ is lying to users.`); process.exit(1) }
console.log('PASS: every number on the FAQ matches what the scoring code pays.')
