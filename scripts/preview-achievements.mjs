/**
 * Preview which users would earn achievements on retroactive backfill.
 * Run: node scripts/preview-achievements.mjs
 * Read-only — does NOT write anything to the database.
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

// ── Helpers ──────────────────────────────────────────────────────
function section(title) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

// ── 1. Tournament Trophies (top 3 per completed tournament) ─────
async function previewTournamentTrophies() {
  section('🏆 TOURNAMENT TROPHIES (1st / 2nd / 3rd)')

  const { data: tournaments, error: tErr } = await admin
    .from('tournaments')
    .select('id, name, location, flag_emoji, tour, starts_at')
    .eq('status', 'completed')
    .order('starts_at', { ascending: false })

  if (tErr) { console.error('  Error fetching tournaments:', tErr.message); return }
  if (!tournaments?.length) { console.log('  No completed tournaments found.'); return }

  let totalGold = 0, totalSilver = 0, totalBronze = 0

  for (const t of tournaments) {
    const { data: preds, error: pErr } = await admin
      .from('predictions')
      .select('user_id, points_earned, users(username)')
      .eq('tournament_id', t.id)
      .is('challenge_id', null)
      .gt('points_earned', 0)
      .order('points_earned', { ascending: false })
      .limit(10)

    if (pErr || !preds?.length) continue

    // DENSE_RANK: group by points_earned
    const ranked = []
    let currentRank = 0, lastPoints = -1
    for (const p of preds) {
      if (p.points_earned !== lastPoints) {
        currentRank++
        lastPoints = p.points_earned
      }
      if (currentRank > 3) break
      ranked.push({ ...p, rank: currentRank })
    }

    if (!ranked.length) continue

    const year = new Date(t.starts_at).getFullYear()
    const label = `${t.flag_emoji || ''} ${t.location || t.name} ${year} (${t.tour})`
    console.log(`\n  ${label}`)

    for (const r of ranked) {
      const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'
      const username = r.users?.username || 'unknown'
      console.log(`    ${medal} #${r.rank}  ${username.padEnd(20)} ${r.points_earned} pts`)
      if (r.rank === 1) totalGold++
      else if (r.rank === 2) totalSilver++
      else totalBronze++
    }
  }

  console.log(`\n  Totals: ${totalGold} gold, ${totalSilver} silver, ${totalBronze} bronze`)
}

// ── 2. Prediction Milestones ────────────────────────────────────
async function previewPredictionMilestones() {
  section('🎯 PREDICTION MILESTONES')

  // Count global predictions per user
  const { data: counts, error: cErr } = await admin
    .from('predictions')
    .select('user_id, users(username)')
    .is('challenge_id', null)

  if (cErr) { console.error('  Error:', cErr.message); return }

  const userCounts = {}
  for (const p of counts || []) {
    if (!userCounts[p.user_id]) userCounts[p.user_id] = { username: p.users?.username || 'unknown', count: 0 }
    userCounts[p.user_id].count++
  }

  const thresholds = [
    { key: 'first_pick', name: 'First Pick', min: 1 },
    { key: 'getting_started', name: 'Getting Started', min: 5 },
    { key: 'committed', name: 'Committed', min: 10 },
    { key: 'veteran', name: 'Veteran', min: 25 },
    { key: 'centurion', name: 'Centurion', min: 100 },
  ]

  for (const t of thresholds) {
    const earners = Object.values(userCounts).filter(u => u.count >= t.min)
    console.log(`\n  ${t.name} (${t.min}+ predictions): ${earners.length} users`)
    if (earners.length <= 15) {
      for (const u of earners.sort((a, b) => b.count - a.count)) {
        console.log(`    ✓ ${u.username.padEnd(20)} ${u.count} predictions`)
      }
    } else {
      const top = earners.sort((a, b) => b.count - a.count).slice(0, 10)
      for (const u of top) console.log(`    ✓ ${u.username.padEnd(20)} ${u.count} predictions`)
      console.log(`    ... and ${earners.length - 10} more`)
    }
  }
}

// ── 3. Accuracy & Streaks ───────────────────────────────────────
async function previewAccuracyStreaks() {
  section('🔥 ACCURACY & STREAKS')

  // Correct picks per user per tournament from point_ledger
  const { data: ledger, error: lErr } = await admin
    .from('point_ledger')
    .select('user_id, tournament_id, streak_multiplier')

  if (lErr) { console.error('  Error:', lErr.message); return }

  // Get usernames
  const userIds = [...new Set((ledger || []).map(l => l.user_id))]
  const { data: users } = await admin.from('users').select('id, username').in('id', userIds)
  const usernameMap = Object.fromEntries((users || []).map(u => [u.id, u.username]))

  // Count correct picks per user per tournament
  const pickCounts = {} // { `${user_id}:${tournament_id}`: count }
  let maxStreakByUser = {} // { user_id: max_streak_multiplier }

  for (const l of ledger || []) {
    const key = `${l.user_id}:${l.tournament_id}`
    pickCounts[key] = (pickCounts[key] || 0) + 1

    const currentMax = maxStreakByUser[l.user_id] || 0
    if ((l.streak_multiplier || 1) > currentMax) {
      maxStreakByUser[l.user_id] = l.streak_multiplier || 1
    }
  }

  // Max correct picks per user across all tournaments
  const maxPicksByUser = {}
  for (const [key, count] of Object.entries(pickCounts)) {
    const userId = key.split(':')[0]
    if (!maxPicksByUser[userId] || count > maxPicksByUser[userId]) {
      maxPicksByUser[userId] = count
    }
  }

  const accuracyThresholds = [
    { name: 'Sharp Eye', emoji: '👁️', min: 5 },
    { name: 'On Fire', emoji: '🔥', min: 10 },
    { name: 'Crystal Ball', emoji: '🔮', min: 15 },
  ]

  for (const t of accuracyThresholds) {
    const earners = Object.entries(maxPicksByUser)
      .filter(([_, count]) => count >= t.min)
      .map(([uid, count]) => ({ username: usernameMap[uid] || 'unknown', count }))
      .sort((a, b) => b.count - a.count)

    console.log(`\n  ${t.emoji} ${t.name} (${t.min}+ correct in 1 tournament): ${earners.length} users`)
    for (const u of earners.slice(0, 15)) {
      console.log(`    ✓ ${u.username.padEnd(20)} ${u.count} correct (best tournament)`)
    }
    if (earners.length > 15) console.log(`    ... and ${earners.length - 15} more`)
  }

  const streakThresholds = [
    { name: 'Hot Streak', emoji: '⚡', min: 3 },
    { name: 'Unstoppable', emoji: '🌊', min: 5 },
  ]

  for (const t of streakThresholds) {
    const earners = Object.entries(maxStreakByUser)
      .filter(([_, streak]) => streak >= t.min)
      .map(([uid, streak]) => ({ username: usernameMap[uid] || 'unknown', streak }))
      .sort((a, b) => b.streak - a.streak)

    console.log(`\n  ${t.emoji} ${t.name} (${t.min}× multiplier): ${earners.length} users`)
    for (const u of earners.slice(0, 15)) {
      console.log(`    ✓ ${u.username.padEnd(20)} ${u.streak}× streak`)
    }
    if (earners.length > 15) console.log(`    ... and ${earners.length - 15} more`)
  }
}

// ── 4. Points Milestones ────────────────────────────────────────
async function previewPointsMilestones() {
  section('💎 POINTS MILESTONES')

  const { data: preds, error } = await admin
    .from('predictions')
    .select('user_id, points_earned, users(username)')
    .is('challenge_id', null)
    .gt('points_earned', 0)

  if (error) { console.error('  Error:', error.message); return }

  // Max points in a single tournament per user
  const maxByUser = {}
  for (const p of preds || []) {
    const username = p.users?.username || 'unknown'
    if (!maxByUser[p.user_id] || p.points_earned > maxByUser[p.user_id].max) {
      maxByUser[p.user_id] = { username, max: p.points_earned }
    }
  }

  // Any points at all
  const firstPoints = Object.values(maxByUser)
  console.log(`\n  ⭐ First Points (any pts): ${firstPoints.length} users`)

  const thresholds = [
    { name: 'Century Club', emoji: '💎', min: 100 },
    { name: 'High Roller', emoji: '🚀', min: 500 },
    { name: 'Grand Master', emoji: '👑', min: 1000 },
  ]

  for (const t of thresholds) {
    const earners = Object.values(maxByUser)
      .filter(u => u.max >= t.min)
      .sort((a, b) => b.max - a.max)

    console.log(`\n  ${t.emoji} ${t.name} (${t.min}+ pts in 1 tournament): ${earners.length} users`)
    for (const u of earners.slice(0, 15)) {
      console.log(`    ✓ ${u.username.padEnd(20)} ${u.max} pts (best tournament)`)
    }
    if (earners.length > 15) console.log(`    ... and ${earners.length - 15} more`)
  }
}

// ── 5. Social ───────────────────────────────────────────────────
async function previewSocial() {
  section('🤝 SOCIAL')

  // Count accepted friendships per user
  const { data: friendships, error } = await admin
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')

  if (error) { console.error('  Error:', error.message); return }

  const friendCounts = {}
  for (const f of friendships || []) {
    friendCounts[f.requester_id] = (friendCounts[f.requester_id] || 0) + 1
    friendCounts[f.addressee_id] = (friendCounts[f.addressee_id] || 0) + 1
  }

  const userIds = Object.keys(friendCounts)
  const { data: users } = await admin.from('users').select('id, username').in('id', userIds)
  const usernameMap = Object.fromEntries((users || []).map(u => [u.id, u.username]))

  const socialStarter = Object.entries(friendCounts).filter(([_, c]) => c >= 1)
  const squadUp = Object.entries(friendCounts).filter(([_, c]) => c >= 5)

  console.log(`\n  🤝 Social Starter (1+ friend): ${socialStarter.length} users`)
  console.log(`\n  👥 Squad Up (5+ friends): ${squadUp.length} users`)
  for (const [uid, count] of squadUp.sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`    ✓ ${(usernameMap[uid] || 'unknown').padEnd(20)} ${count} friends`)
  }

  // Challenger: users who created at least 1 challenge
  const { data: challenges, error: chErr } = await admin
    .from('challenges')
    .select('challenger_id')
    .eq('is_anonymous', false)

  if (!chErr && challenges) {
    const creators = [...new Set(challenges.map(c => c.challenger_id))]
    console.log(`\n  ⚔️ Challenger (created 1+ challenge): ${creators.length} users`)
  }

  // Rival: 5 completed challenges vs same opponent
  const { data: completed, error: rErr } = await admin
    .from('challenges')
    .select('challenger_id, challenged_id')
    .eq('status', 'completed')
    .eq('is_anonymous', false)

  if (!rErr && completed) {
    const pairCounts = {}
    for (const c of completed) {
      const pair = [c.challenger_id, c.challenged_id].sort().join(':')
      if (!pairCounts[pair]) pairCounts[pair] = { ids: [c.challenger_id, c.challenged_id], count: 0 }
      pairCounts[pair].count++
    }
    const rivals = Object.values(pairCounts).filter(p => p.count >= 5)
    console.log(`\n  🏴 Rival (5+ vs same opponent): ${rivals.length} pairs`)
    for (const r of rivals) {
      const names = r.ids.map(id => usernameMap[id] || id.slice(0, 8))
      console.log(`    ✓ ${names[0]} vs ${names[1]}: ${r.count} matches`)
    }
  }
}

// ── 6. Engagement ───────────────────────────────────────────────
async function previewEngagement() {
  section('🌍 ENGAGEMENT')

  // Globe Trotter: predicted on both ATP and WTA
  const { data: preds, error } = await admin
    .from('predictions')
    .select('user_id, tournaments(tour), users(username)')
    .is('challenge_id', null)

  if (error) { console.error('  Error:', error.message); return }

  const userTours = {} // { user_id: Set<tour> }
  const userSurfaces = {} // filled below
  const userMonths = {} // { user_id: Set<month> }
  const usernameMap = {}

  for (const p of preds || []) {
    const uid = p.user_id
    usernameMap[uid] = p.users?.username || 'unknown'
    if (!userTours[uid]) userTours[uid] = new Set()
    if (p.tournaments?.tour) userTours[uid].add(p.tournaments.tour)
  }

  const globeTrotters = Object.entries(userTours)
    .filter(([_, tours]) => tours.has('ATP') && tours.has('WTA'))
  console.log(`\n  🌍 Globe Trotter (ATP + WTA): ${globeTrotters.length} users`)
  for (const [uid] of globeTrotters.slice(0, 15)) {
    console.log(`    ✓ ${usernameMap[uid]}`)
  }

  // Surface Master: predicted on Clay, Grass, Hard
  const { data: predsSurface, error: sErr } = await admin
    .from('predictions')
    .select('user_id, tournaments(surface)')
    .is('challenge_id', null)

  if (!sErr && predsSurface) {
    for (const p of predsSurface) {
      const uid = p.user_id
      if (!userSurfaces[uid]) userSurfaces[uid] = new Set()
      if (p.tournaments?.surface) userSurfaces[uid].add(p.tournaments.surface)
    }

    const surfaceMasters = Object.entries(userSurfaces)
      .filter(([_, surfaces]) => surfaces.has('Clay') && surfaces.has('Grass') && surfaces.has('Hard'))
    console.log(`\n  🎾 Surface Master (all 3 surfaces): ${surfaceMasters.length} users`)
    for (const [uid] of surfaceMasters.slice(0, 15)) {
      console.log(`    ✓ ${usernameMap[uid]}`)
    }

    // Show who's close
    const almostSurface = Object.entries(userSurfaces)
      .filter(([_, s]) => s.size === 2)
      .map(([uid, s]) => ({ username: usernameMap[uid], has: [...s].join(', '), missing: ['Clay', 'Grass', 'Hard'].find(x => !s.has(x)) }))
    if (almostSurface.length) {
      console.log(`    Close (2/3 surfaces): ${almostSurface.length} users`)
      for (const u of almostSurface.slice(0, 10)) {
        console.log(`      ~ ${u.username.padEnd(20)} has ${u.has}, missing ${u.missing}`)
      }
    }
  }

  // Season Pass: predicted in 4+ different calendar months
  const { data: predsMonths, error: mErr } = await admin
    .from('predictions')
    .select('user_id, submitted_at')
    .is('challenge_id', null)

  if (!mErr && predsMonths) {
    for (const p of predsMonths) {
      const uid = p.user_id
      if (!userMonths[uid]) userMonths[uid] = new Set()
      const d = new Date(p.submitted_at)
      userMonths[uid].add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const seasonPassers = Object.entries(userMonths)
      .filter(([_, months]) => months.size >= 4)
    console.log(`\n  📅 Season Pass (4+ months): ${seasonPassers.length} users`)
    for (const [uid, months] of seasonPassers.sort((a, b) => b[1].size - a[1].size).slice(0, 15)) {
      console.log(`    ✓ ${(usernameMap[uid] || 'unknown').padEnd(20)} ${months.size} months`)
    }
  }

  // Early Bird: skip for now since draw_published_at doesn't exist yet
  console.log(`\n  🐦 Early Bird: skipped (draw_published_at column not yet added)`)
}

// ── Run all ─────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║  ACHIEVEMENTS PREVIEW — READ-ONLY (no DB writes)         ║')
  console.log('╚════════════════════════════════════════════════════════════╝')

  await previewTournamentTrophies()
  await previewPredictionMilestones()
  await previewAccuracyStreaks()
  await previewPointsMilestones()
  await previewSocial()
  await previewEngagement()

  console.log('\n' + '═'.repeat(60))
  console.log('  Done. No data was written to the database.')
  console.log('═'.repeat(60) + '\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
