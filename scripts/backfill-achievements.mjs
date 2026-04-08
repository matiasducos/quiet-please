/**
 * Retroactive achievement backfill — run ONCE after deploying migration 043.
 * Awards all achievements users have already earned based on existing data.
 * Does NOT send notifications or emails (no flooding).
 *
 * Usage: node scripts/backfill-achievements.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local
const envPath = resolve(import.meta.dirname, '..', '.env.local')
const envFile = readFileSync(envPath, 'utf-8')
const env = Object.fromEntries(
  envFile.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const [k, ...rest] = l.split('=')
    return [k.trim(), rest.join('=').trim()]
  })
)

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let awarded = 0
let skipped = 0

async function award(userId, key, tournamentId = null, meta = {}) {
  // Check if already exists
  let query = admin.from('user_achievements').select('id').eq('user_id', userId).eq('achievement_key', key)
  if (tournamentId) query = query.eq('tournament_id', tournamentId)
  else query = query.is('tournament_id', null)
  const { data: existing } = await query.maybeSingle()
  if (existing) { skipped++; return }

  const { error } = await admin.from('user_achievements').insert({
    user_id: userId, achievement_key: key, tournament_id: tournamentId, meta,
  })
  if (error && error.code !== '23505') {
    console.error(`  ✗ ${key} for ${userId}: ${error.message}`)
  } else {
    awarded++
  }
}

// ── 1. Tournament Trophies ──────────────────────────────────────
async function backfillTrophies() {
  console.log('\n🏆 Backfilling tournament trophies...')
  const { data: tournaments } = await admin
    .from('tournaments')
    .select('id, name, location, flag_emoji, tour, starts_at')
    .eq('status', 'completed')

  for (const t of tournaments ?? []) {
    const { data: preds } = await admin
      .from('predictions')
      .select('user_id, points_earned')
      .eq('tournament_id', t.id)
      .is('challenge_id', null)
      .gt('points_earned', 0)
      .order('points_earned', { ascending: false })
      .limit(50)

    if (!preds?.length) continue

    let currentRank = 0, lastPoints = -1
    const RANK_TO_KEY = { 1: 'tournament_champion', 2: 'runner_up', 3: 'on_the_podium' }
    const year = new Date(t.starts_at).getFullYear()
    const meta = {
      tournament_name: t.location || t.name,
      tournament_flag_emoji: t.flag_emoji,
      tournament_tour: t.tour,
      tournament_year: year,
    }

    for (const p of preds) {
      if (p.points_earned !== lastPoints) { currentRank++; lastPoints = p.points_earned }
      if (currentRank > 3) break
      const key = RANK_TO_KEY[currentRank]
      if (key) await award(p.user_id, key, t.id, { ...meta, points_earned: p.points_earned })
    }
  }
}

// ── 2. Prediction Milestones ────────────────────────────────────
async function backfillPredictionMilestones() {
  console.log('\n🎯 Backfilling prediction milestones...')
  const { data: preds } = await admin.from('predictions').select('user_id').is('challenge_id', null)
  const counts = {}
  for (const p of preds ?? []) counts[p.user_id] = (counts[p.user_id] || 0) + 1

  const thresholds = [
    { min: 1, key: 'first_pick' }, { min: 5, key: 'getting_started' },
    { min: 10, key: 'committed' }, { min: 25, key: 'veteran' }, { min: 100, key: 'centurion' },
  ]
  for (const [userId, count] of Object.entries(counts)) {
    for (const t of thresholds) {
      if (count >= t.min) await award(userId, t.key)
    }
  }
}

// ── 3. Accuracy & Streaks ───────────────────────────────────────
async function backfillAccuracyStreaks() {
  console.log('\n🔥 Backfilling accuracy & streaks...')
  const { data: ledger } = await admin.from('point_ledger').select('user_id, tournament_id, streak_multiplier')

  const pickCounts = {} // userId:tournamentId → count
  const maxStreak = {}  // userId → max streak

  for (const l of ledger ?? []) {
    const key = `${l.user_id}:${l.tournament_id}`
    pickCounts[key] = (pickCounts[key] || 0) + 1
    maxStreak[l.user_id] = Math.max(maxStreak[l.user_id] || 1, l.streak_multiplier || 1)
  }

  // Max correct picks per user
  const maxPicks = {}
  for (const [key, count] of Object.entries(pickCounts)) {
    const userId = key.split(':')[0]
    maxPicks[userId] = Math.max(maxPicks[userId] || 0, count)
  }

  for (const [userId, count] of Object.entries(maxPicks)) {
    if (count >= 5) await award(userId, 'sharp_eye')
    if (count >= 10) await award(userId, 'on_fire')
    if (count >= 15) await award(userId, 'crystal_ball')
  }

  for (const [userId, streak] of Object.entries(maxStreak)) {
    if (streak >= 3) await award(userId, 'hot_streak')
    if (streak >= 5) await award(userId, 'unstoppable')
  }
}

// ── 4. Points Milestones ────────────────────────────────────────
async function backfillPointsMilestones() {
  console.log('\n💎 Backfilling points milestones...')
  const { data: preds } = await admin
    .from('predictions')
    .select('user_id, points_earned')
    .is('challenge_id', null)
    .gt('points_earned', 0)

  const maxByUser = {}
  for (const p of preds ?? []) {
    maxByUser[p.user_id] = Math.max(maxByUser[p.user_id] || 0, p.points_earned)
  }

  for (const [userId, max] of Object.entries(maxByUser)) {
    if (max >= 1) await award(userId, 'first_points')
    if (max >= 100) await award(userId, 'century_club')
    if (max >= 500) await award(userId, 'high_roller')
    if (max >= 1000) await award(userId, 'grand_master')
  }
}

// ── 5. Social ───────────────────────────────────────────────────
async function backfillSocial() {
  console.log('\n🤝 Backfilling social...')
  const { data: friendships } = await admin.from('friendships').select('requester_id, addressee_id').eq('status', 'accepted')
  const friendCounts = {}
  for (const f of friendships ?? []) {
    friendCounts[f.requester_id] = (friendCounts[f.requester_id] || 0) + 1
    friendCounts[f.addressee_id] = (friendCounts[f.addressee_id] || 0) + 1
  }
  for (const [userId, count] of Object.entries(friendCounts)) {
    if (count >= 1) await award(userId, 'social_starter')
    if (count >= 5) await award(userId, 'squad_up')
  }

  // Challenger
  const { data: challenges } = await admin.from('challenges').select('challenger_id').eq('is_anonymous', false)
  const creators = new Set((challenges ?? []).map(c => c.challenger_id))
  for (const userId of creators) await award(userId, 'challenger')

  // Rival
  const { data: completed } = await admin
    .from('challenges')
    .select('challenger_id, challenged_id')
    .eq('status', 'completed')
    .eq('is_anonymous', false)

  const pairCounts = {}
  for (const c of completed ?? []) {
    const pair = [c.challenger_id, c.challenged_id].sort().join(':')
    if (!pairCounts[pair]) pairCounts[pair] = { ids: [c.challenger_id, c.challenged_id], count: 0 }
    pairCounts[pair].count++
  }
  for (const p of Object.values(pairCounts)) {
    if (p.count >= 5) {
      for (const uid of p.ids) await award(uid, 'rival')
    }
  }
}

// ── 6. Engagement ───────────────────────────────────────────────
async function backfillEngagement() {
  console.log('\n🌍 Backfilling engagement...')
  const { data: preds } = await admin
    .from('predictions')
    .select('user_id, submitted_at, tournaments(tour, surface)')
    .is('challenge_id', null)

  const userTours = {}, userSurfaces = {}, userMonths = {}
  for (const p of preds ?? []) {
    const uid = p.user_id
    if (!userTours[uid]) userTours[uid] = new Set()
    if (!userSurfaces[uid]) userSurfaces[uid] = new Set()
    if (!userMonths[uid]) userMonths[uid] = new Set()
    if (p.tournaments?.tour) userTours[uid].add(p.tournaments.tour)
    if (p.tournaments?.surface) userSurfaces[uid].add(p.tournaments.surface)
    const d = new Date(p.submitted_at)
    userMonths[uid].add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  for (const [uid, tours] of Object.entries(userTours)) {
    if (tours.has('ATP') && tours.has('WTA')) await award(uid, 'globe_trotter')
  }
  for (const [uid, surfaces] of Object.entries(userSurfaces)) {
    if (surfaces.has('Clay') && surfaces.has('Grass') && surfaces.has('Hard')) await award(uid, 'surface_master')
  }
  for (const [uid, months] of Object.entries(userMonths)) {
    if (months.size >= 4) await award(uid, 'season_pass')
  }
  // Early Bird: skip — draw_published_at not populated yet
}

// ── Run ─────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  ACHIEVEMENT BACKFILL (no notifications)')
  console.log('═══════════════════════════════════════════════')

  await backfillTrophies()
  await backfillPredictionMilestones()
  await backfillAccuracyStreaks()
  await backfillPointsMilestones()
  await backfillSocial()
  await backfillEngagement()

  console.log('\n═══════════════════════════════════════════════')
  console.log(`  Done. Awarded: ${awarded}, Skipped (already earned): ${skipped}`)
  console.log('═══════════════════════════════════════════════\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
