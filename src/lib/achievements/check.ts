/**
 * Achievement checking & awarding logic.
 *
 * All functions are idempotent — calling them multiple times for the
 * same user / achievement is safe (UNIQUE constraint + pre-check).
 * All use the admin client (service role) since achievements are
 * inserted without an auth session context.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { ACHIEVEMENTS } from './definitions'

type AdminClient = SupabaseClient

interface AwardResult {
  userId: string
  key: string
  isNew: boolean
}

// ── Core: award a single achievement ────────────────────────────

/**
 * Award an achievement to a user. Returns { isNew: true } only when
 * the achievement was freshly inserted. Duplicate attempts (same user +
 * key + tournament) are silently ignored via the UNIQUE constraint.
 */
export async function awardAchievement(
  admin: AdminClient,
  userId: string,
  key: string,
  tournamentId: string | null = null,
  meta: Record<string, unknown> = {},
): Promise<AwardResult> {
  const result: AwardResult = { userId, key, isNew: false }

  // Pre-check: skip the insert if already earned
  let query = admin
    .from('user_achievements')
    .select('id')
    .eq('user_id', userId)
    .eq('achievement_key', key)

  if (tournamentId) {
    query = query.eq('tournament_id', tournamentId)
  } else {
    query = query.is('tournament_id', null)
  }

  const { data: existing } = await query.maybeSingle()
  if (existing) return result

  // Insert — the UNIQUE constraint is the real guard against races
  const { error } = await admin.from('user_achievements').insert({
    user_id: userId,
    achievement_key: key,
    tournament_id: tournamentId,
    meta,
  })

  if (error) {
    // 23505 = unique_violation — another concurrent insert won the race
    if (error.code === '23505') return result
    console.error(`[achievements] insert error for ${key}:`, error.message)
    return result
  }

  result.isNew = true
  return result
}

// ── Helper: load existing achievement keys for a user ───────────

async function getExistingKeys(admin: AdminClient, userId: string): Promise<Set<string>> {
  const { data } = await admin
    .from('user_achievements')
    .select('achievement_key')
    .eq('user_id', userId)
    .is('tournament_id', null)

  return new Set((data ?? []).map(r => r.achievement_key))
}

// ── 1. Tournament Trophies ──────────────────────────────────────

/**
 * Check top-3 for a completed tournament and award trophies.
 * Uses DENSE_RANK — ties share the same rank.
 */
export async function checkTournamentTrophies(
  admin: AdminClient,
  tournamentId: string,
): Promise<AwardResult[]> {
  // Fetch tournament metadata for the achievement meta field
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, name, location, flag_emoji, tour, starts_at')
    .eq('id', tournamentId)
    .single()

  if (!tournament) return []

  // Get ranked predictions (top 50 is more than enough for top-3)
  const { data: preds, error } = await admin
    .from('predictions')
    .select('user_id, points_earned')
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)
    .gt('points_earned', 0)
    .order('points_earned', { ascending: false })
    .limit(50)

  if (error || !preds?.length) return []

  // Compute DENSE_RANK in JS (matching the SQL function logic)
  const ranked: { userId: string; rank: number; points: number }[] = []
  let currentRank = 0
  let lastPoints = -1
  for (const p of preds) {
    if (p.points_earned !== lastPoints) {
      currentRank++
      lastPoints = p.points_earned
    }
    if (currentRank > 3) break
    ranked.push({ userId: p.user_id, rank: currentRank, points: p.points_earned })
  }

  const year = new Date(tournament.starts_at).getFullYear()
  const meta = {
    tournament_name: tournament.location || tournament.name,
    tournament_flag_emoji: tournament.flag_emoji,
    tournament_tour: tournament.tour,
    tournament_year: year,
  }

  const RANK_TO_KEY: Record<number, string> = {
    1: 'tournament_champion',
    2: 'runner_up',
    3: 'on_the_podium',
  }

  const results: AwardResult[] = []
  for (const r of ranked) {
    const key = RANK_TO_KEY[r.rank]
    if (!key) continue
    const res = await awardAchievement(admin, r.userId, key, tournamentId, {
      ...meta,
      points_earned: r.points,
    })
    results.push(res)
  }

  return results
}

// ── 2. Prediction Milestones ────────────────────────────────────

const PREDICTION_THRESHOLDS = [
  { min: 1, key: 'first_pick' },
  { min: 5, key: 'getting_started' },
  { min: 10, key: 'committed' },
  { min: 25, key: 'veteran' },
  { min: 50, key: 'dedicated' },
  { min: 100, key: 'centurion' },
]

export async function checkPredictionMilestones(
  admin: AdminClient,
  userId: string,
): Promise<AwardResult[]> {
  const existing = await getExistingKeys(admin, userId)

  // Find the highest unearned threshold to know if we need to count
  const unearned = PREDICTION_THRESHOLDS.filter(t => !existing.has(t.key))
  if (!unearned.length) return []

  const { count, error } = await admin
    .from('predictions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('challenge_id', null)

  if (error || count === null) return []

  const results: AwardResult[] = []
  for (const t of unearned) {
    if (count >= t.min) {
      const res = await awardAchievement(admin, userId, t.key)
      results.push(res)
    }
  }
  return results
}

// ── 3. Accuracy & Streaks (called from cron after scoring) ──────

export async function checkCronAchievements(
  admin: AdminClient,
  userId: string,
  tournamentId: string,
): Promise<AwardResult[]> {
  const existing = await getExistingKeys(admin, userId)
  const results: AwardResult[] = []

  // ── Accuracy: correct picks in this tournament ────────────────
  const accuracyKeys = ['sharp_eye', 'on_fire', 'crystal_ball']
  const needsAccuracy = accuracyKeys.some(k => !existing.has(k))

  if (needsAccuracy) {
    const { count } = await admin
      .from('point_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('tournament_id', tournamentId)

    const correctPicks = count ?? 0
    const accuracyThresholds = [
      { min: 5, key: 'sharp_eye' },
      { min: 15, key: 'on_fire' },
      { min: 25, key: 'crystal_ball' },
    ]
    for (const t of accuracyThresholds) {
      if (correctPicks >= t.min && !existing.has(t.key)) {
        const res = await awardAchievement(admin, userId, t.key)
        results.push(res)
      }
    }
  }

  // ── Streaks: max streak multiplier in this tournament ─────────
  const streakKeys = ['hot_streak', 'unstoppable']
  const needsStreak = streakKeys.some(k => !existing.has(k))

  if (needsStreak) {
    const { data: maxRow } = await admin
      .from('point_ledger')
      .select('streak_multiplier')
      .eq('user_id', userId)
      .eq('tournament_id', tournamentId)
      .order('streak_multiplier', { ascending: false })
      .limit(1)
      .maybeSingle()

    const maxStreak = maxRow?.streak_multiplier ?? 1
    if (maxStreak >= 3 && !existing.has('hot_streak')) {
      results.push(await awardAchievement(admin, userId, 'hot_streak'))
    }
    if (maxStreak >= 7 && !existing.has('unstoppable')) {
      results.push(await awardAchievement(admin, userId, 'unstoppable'))
    }
  }

  // ── Points milestones: check the prediction for this tournament ─
  const pointsKeys = ['first_points', 'century_club', 'high_roller', 'grand_master']
  const needsPoints = pointsKeys.some(k => !existing.has(k))

  if (needsPoints) {
    const { data: pred } = await admin
      .from('predictions')
      .select('points_earned')
      .eq('user_id', userId)
      .eq('tournament_id', tournamentId)
      .is('challenge_id', null)
      .maybeSingle()

    const pts = pred?.points_earned ?? 0
    const pointsThresholds = [
      { min: 1, key: 'first_points' },
      { min: 250, key: 'century_club' },
      { min: 1000, key: 'high_roller' },
      { min: 2500, key: 'grand_master' },
    ]
    for (const t of pointsThresholds) {
      if (pts >= t.min && !existing.has(t.key)) {
        results.push(await awardAchievement(admin, userId, t.key))
      }
    }
  }

  return results
}

// ── 4. Engagement achievements (called from savePrediction) ─────

export async function checkEngagementAchievements(
  admin: AdminClient,
  userId: string,
  tournamentId: string,
): Promise<AwardResult[]> {
  const existing = await getExistingKeys(admin, userId)
  const results: AwardResult[] = []

  // ── Globe Trotter: ATP + WTA ──────────────────────────────────
  if (!existing.has('globe_trotter')) {
    const { data: tours } = await admin
      .from('predictions')
      .select('tournaments(tour)')
      .eq('user_id', userId)
      .is('challenge_id', null)

    const tourSet = new Set((tours ?? []).map((p: any) => p.tournaments?.tour).filter(Boolean))
    if (tourSet.has('ATP') && tourSet.has('WTA')) {
      results.push(await awardAchievement(admin, userId, 'globe_trotter'))
    }
  }

  // ── Surface Master: Clay + Grass + Hard ───────────────────────
  if (!existing.has('surface_master')) {
    const { data: surfaces } = await admin
      .from('predictions')
      .select('tournaments(surface)')
      .eq('user_id', userId)
      .is('challenge_id', null)

    const surfaceSet = new Set((surfaces ?? []).map((p: any) => p.tournaments?.surface).filter(Boolean))
    if (surfaceSet.has('Clay') && surfaceSet.has('Grass') && surfaceSet.has('Hard')) {
      results.push(await awardAchievement(admin, userId, 'surface_master'))
    }
  }

  // ── Season Pass: 4 different calendar months ──────────────────
  if (!existing.has('season_pass')) {
    const { data: preds } = await admin
      .from('predictions')
      .select('submitted_at')
      .eq('user_id', userId)
      .is('challenge_id', null)

    const months = new Set(
      (preds ?? []).map(p => {
        const d = new Date(p.submitted_at)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      })
    )
    if (months.size >= 4) {
      results.push(await awardAchievement(admin, userId, 'season_pass'))
    }
  }

  // ── Early Bird: prediction within 1h of draw opening ──────────
  // Requires draw_published_at on the tournament — skip if not set
  if (!existing.has('early_bird')) {
    const { data: tournament } = await admin
      .from('tournaments')
      .select('draw_published_at')
      .eq('id', tournamentId)
      .maybeSingle()

    if (tournament?.draw_published_at) {
      const { data: pred } = await admin
        .from('predictions')
        .select('submitted_at')
        .eq('user_id', userId)
        .eq('tournament_id', tournamentId)
        .is('challenge_id', null)
        .maybeSingle()

      if (pred) {
        const drawTime = new Date(tournament.draw_published_at).getTime()
        const submitTime = new Date(pred.submitted_at).getTime()
        if (submitTime - drawTime <= 3600000 && submitTime >= drawTime) {
          results.push(await awardAchievement(admin, userId, 'early_bird'))
        }
      }
    }
  }

  return results
}

// ── 5. Social achievements ──────────────────────────────────────

export async function checkSocialAchievements(
  admin: AdminClient,
  userId: string,
): Promise<AwardResult[]> {
  const existing = await getExistingKeys(admin, userId)
  const results: AwardResult[] = []

  if (!existing.has('social_starter') || !existing.has('squad_up')) {
    const { count } = await admin
      .from('friendships')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)

    const friendCount = count ?? 0
    if (friendCount >= 1 && !existing.has('social_starter')) {
      results.push(await awardAchievement(admin, userId, 'social_starter'))
    }
    if (friendCount >= 10 && !existing.has('squad_up')) {
      results.push(await awardAchievement(admin, userId, 'squad_up'))
    }
  }

  return results
}

// ── 6. Challenge achievements ───────────────────────────────────

export async function checkChallengeAchievements(
  admin: AdminClient,
  userId: string,
): Promise<AwardResult[]> {
  const existing = await getExistingKeys(admin, userId)
  const results: AwardResult[] = []

  // Challenger: created at least 1 challenge
  if (!existing.has('challenger')) {
    const { count } = await admin
      .from('challenges')
      .select('id', { count: 'exact', head: true })
      .eq('challenger_id', userId)
      .eq('is_anonymous', false)

    if ((count ?? 0) >= 1) {
      results.push(await awardAchievement(admin, userId, 'challenger'))
    }
  }

  // Rival: 5 completed challenges vs same opponent
  if (!existing.has('rival')) {
    const { data: completed } = await admin
      .from('challenges')
      .select('challenger_id, challenged_id')
      .eq('status', 'completed')
      .eq('is_anonymous', false)
      .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)

    if (completed) {
      const opponentCounts: Record<string, number> = {}
      for (const c of completed) {
        const opponentId = c.challenger_id === userId ? c.challenged_id : c.challenger_id
        opponentCounts[opponentId] = (opponentCounts[opponentId] || 0) + 1
      }
      const maxVsSameOpponent = Math.max(0, ...Object.values(opponentCounts))
      if (maxVsSameOpponent >= 5) {
        results.push(await awardAchievement(admin, userId, 'rival'))
      }
    }
  }

  return results
}
