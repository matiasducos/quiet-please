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
  // Every key with a threshold must appear here. double_digits was missing, so
  // once a user held the other three the whole block short-circuited and that
  // badge could never be granted — which is how 8 users came to hold On Fire
  // (15 correct) without Double Digits (10).
  const accuracyThresholds = [
    { min: 5,  key: 'sharp_eye' },
    { min: 10, key: 'double_digits' },
    { min: 15, key: 'on_fire' },
    { min: 25, key: 'crystal_ball' },
  ]
  const needsAccuracy = accuracyThresholds.some(t => !existing.has(t.key))

  if (needsAccuracy) {
    const correctPicks = await countCorrectPicks(admin, userId, tournamentId)
    for (const t of accuracyThresholds) {
      if (correctPicks >= t.min && !existing.has(t.key)) {
        const res = await awardAchievement(admin, userId, t.key)
        results.push(res)
      }
    }
  }

  // ── Sharpshooter: 5+ correct picks in 3 different tournaments ─
  // Scoped to the user's own predictions. Unscoped, a friends challenge is a
  // separate bracket with its own ledger rows, so entering challenges alone
  // could carry a tournament past the 5-correct bar.
  //
  // Uses the ledger rather than countCorrectPicks because this spans every
  // tournament the user has entered — one query instead of two per tournament.
  // A ledger row can outlive an edited pick (~2% of rows), which is immaterial
  // against a threshold of 5 but would matter for an exact figure.
  if (!existing.has('sharpshooter')) {
    const { data: ownPredictions } = await admin
      .from('predictions')
      .select('id')
      .eq('user_id', userId)
      .is('challenge_id', null)

    const ownIds = (ownPredictions ?? []).map(p => p.id)
    const { data: byTournament } = ownIds.length
      ? await admin
          .from('point_ledger')
          .select('tournament_id')
          .eq('user_id', userId)
          .gt('points', 0)
          .in('prediction_id', ownIds)
      : { data: [] as { tournament_id: string }[] }

    if (byTournament) {
      const countsByTournament = new Map<string, number>()
      for (const r of byTournament) {
        countsByTournament.set(r.tournament_id, (countsByTournament.get(r.tournament_id) ?? 0) + 1)
      }
      const qualifyingTournaments = Array.from(countsByTournament.values()).filter(c => c >= 5).length
      if (qualifyingTournaments >= 3) {
        results.push(await awardAchievement(admin, userId, 'sharpshooter'))
      }
    }
  }

  // ── Streaks: max streak multiplier in this tournament ─────────
  const streakKeys = ['hot_streak', 'unstoppable', 'perfectionist']
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
    const streakThresholds = [
      { min: 3, key: 'hot_streak' },
      { min: 5, key: 'unstoppable' },
      { min: 7, key: 'perfectionist' },
    ]
    for (const t of streakThresholds) {
      if (maxStreak >= t.min && !existing.has(t.key)) {
        results.push(await awardAchievement(admin, userId, t.key))
      }
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

  // ── Lifetime ranking points: points_vault, legend, hall_of_fame
  const lifetimeKeys = ['points_vault', 'legend', 'hall_of_fame']
  const needsLifetime = lifetimeKeys.some(k => !existing.has(k))
  if (needsLifetime) {
    const { data: u } = await admin
      .from('users')
      .select('ranking_points')
      .eq('id', userId)
      .maybeSingle()
    const lifetime = u?.ranking_points ?? 0
    const lifetimeThresholds = [
      { min: 10000, key: 'points_vault' },
      { min: 25000, key: 'legend' },
      { min: 50000, key: 'hall_of_fame' },
    ]
    for (const t of lifetimeThresholds) {
      if (lifetime >= t.min && !existing.has(t.key)) {
        results.push(await awardAchievement(admin, userId, t.key))
      }
    }
  }

  return results
}

/**
 * Correct picks in one tournament, from the user's own bracket.
 *
 * Not a count of point_ledger rows. The ledger holds a row per
 * (match, prediction), and a friends challenge is a separate full bracket, so
 * counting rows added a whole bracket's worth of correct picks for every
 * challenge entered — a user in three challenges cleared a 15-correct bar at
 * five correct each. Challenge brackets affect neither ranking nor leagues and
 * should not earn profile badges.
 *
 * BYEs and admin-locked matches are excluded for the same reason they are in
 * checkPerfectPrediction: neither can be picked, so neither can be correct.
 */
async function countCorrectPicks(
  admin: AdminClient,
  userId: string,
  tournamentId: string,
): Promise<number> {
  const { data: results } = await admin
    .from('match_results')
    .select('external_match_id, winner_external_id')
    .eq('tournament_id', tournamentId)
    .or('score.neq.BYE,score.is.null')
    .not('winner_external_id', 'is', null)

  if (!results?.length) return 0

  const { data: prediction } = await admin
    .from('predictions')
    .select('picks, locked_picks')
    .eq('user_id', userId)
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)
    .maybeSingle()

  if (!prediction) return 0

  const picks  = (prediction.picks ?? {}) as Record<string, string>
  const locked = new Set((prediction.locked_picks ?? []) as string[])

  return results.filter(r =>
    !locked.has(r.external_match_id) &&
    picks[r.external_match_id] === r.winner_external_id,
  ).length
}

// ── 3b. The Perfect Prediction (special, tournament-specific) ──
// Awarded when a user's global bracket called every played match in the
// tournament. Repeatable per tournament (like trophies).
//
// Compared against the picks themselves rather than against point_ledger. The
// ledger cannot answer this question:
//   - it holds a row per (match, prediction), and a friends challenge is a
//     separate full bracket, so summing a user's ledger rows added one
//     bracket's worth of correct picks per challenge entered. Three challenges
//     at a grand slam cleared a 127-match bar at ~49% accuracy;
//   - a row can outlive the pick that earned it, since brackets stay editable
//     while a tournament runs.
// Both made the achievement measure volume rather than accuracy.
export async function checkPerfectPrediction(
  admin: AdminClient,
  userId: string,
  tournamentId: string,
): Promise<AwardResult[]> {
  // Played matches that could actually be predicted. BYEs carry a winner but
  // are never picked, so counting them made this unreachable on any draw with
  // byes — every 250-level event needed 31 of 27 possible.
  const { data: results } = await admin
    .from('match_results')
    .select('external_match_id, winner_external_id')
    .eq('tournament_id', tournamentId)
    .or('score.neq.BYE,score.is.null')
    .not('winner_external_id', 'is', null)

  const totalMatches = results?.length ?? 0
  if (totalMatches === 0) return []

  // The user's own bracket — challenge picks are excluded deliberately: they do
  // not affect ranking or leagues, so they should not earn a profile trophy.
  const { data: prediction } = await admin
    .from('predictions')
    .select('picks, locked_picks')
    .eq('user_id', userId)
    .eq('tournament_id', tournamentId)
    .is('challenge_id', null)
    .maybeSingle()

  if (!prediction) return []

  const picks = (prediction.picks ?? {}) as Record<string, string>
  const locked = new Set((prediction.locked_picks ?? []) as string[])

  // Admin-locked matches leave both sides of the comparison, for the same reason
  // BYEs do: the award-points cron skips them, so no pick on a locked match can
  // ever score. Counting them in the denominator would permanently bar anyone
  // who was locked out of a single match — 20 predictions today, up to 32
  // matches each. The achievement measures every match that was theirs to call.
  const scoreable = results!.filter(r => !locked.has(r.external_match_id))
  if (scoreable.length === 0) return []

  const correctPicks = scoreable.filter(
    r => picks[r.external_match_id] === r.winner_external_id,
  ).length

  if (correctPicks < scoreable.length) return []

  // Fetch tournament meta for the notification / display
  const { data: tournament } = await admin
    .from('tournaments')
    .select('name, location, flag_emoji, tour, starts_at')
    .eq('id', tournamentId)
    .single()

  const year = tournament?.starts_at ? new Date(tournament.starts_at).getFullYear() : null
  const meta = {
    tournament_name: tournament?.location || tournament?.name || 'Tournament',
    tournament_flag_emoji: tournament?.flag_emoji ?? null,
    tournament_tour: tournament?.tour ?? null,
    tournament_year: year,
    // What the badge claims: the matches actually called, not the tournament's
    // raw total, so a bracket with admin-locked matches does not overstate.
    total_matches: scoreable.length,
  }

  const res = await awardAchievement(admin, userId, 'perfect_prediction', tournamentId, meta)
  return [res]
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

  // ── Season Pass / Anniversary: calendar-based ─────────────────
  if (!existing.has('season_pass') || !existing.has('anniversary')) {
    const { data: preds } = await admin
      .from('predictions')
      .select('submitted_at')
      .eq('user_id', userId)
      .is('challenge_id', null)

    const dates = (preds ?? []).map(p => new Date(p.submitted_at))
    const months = new Set(
      dates.map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    )
    if (months.size >= 4 && !existing.has('season_pass')) {
      results.push(await awardAchievement(admin, userId, 'season_pass'))
    }

    if (dates.length >= 2 && !existing.has('anniversary')) {
      const times = dates.map(d => d.getTime())
      const span = Math.max(...times) - Math.min(...times)
      if (span >= 365 * 24 * 3600 * 1000) {
        results.push(await awardAchievement(admin, userId, 'anniversary'))
      }
    }
  }

  // ── Full Schedule: all 4 tournament types ─────────────────────
  if (!existing.has('full_schedule')) {
    const { data: cats } = await admin
      .from('predictions')
      .select('tournaments(category)')
      .eq('user_id', userId)
      .is('challenge_id', null)

    const catSet = new Set((cats ?? []).map((p: any) => p.tournaments?.category).filter(Boolean))
    if (['grand_slam', 'masters_1000', '500', '250'].every(c => catSet.has(c))) {
      results.push(await awardAchievement(admin, userId, 'full_schedule'))
    }
  }

  // ── Slam Collector: 3+ different Grand Slams ──────────────────
  if (!existing.has('tour_grand_slam')) {
    const { data: slams } = await admin
      .from('predictions')
      .select('tournaments(name, category)')
      .eq('user_id', userId)
      .is('challenge_id', null)

    const slamNames = new Set(
      (slams ?? [])
        .filter((p: any) => p.tournaments?.category === 'grand_slam')
        .map((p: any) => p.tournaments?.name)
        .filter(Boolean)
    )
    if (slamNames.size >= 3) {
      results.push(await awardAchievement(admin, userId, 'tour_grand_slam'))
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

  const friendKeys = ['social_starter', 'friend_circle', 'squad_up', 'popular']
  if (friendKeys.some(k => !existing.has(k))) {
    const { count } = await admin
      .from('friendships')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)

    const friendCount = count ?? 0
    const friendThresholds = [
      { min: 1, key: 'social_starter' },
      { min: 5, key: 'friend_circle' },
      { min: 10, key: 'squad_up' },
      { min: 25, key: 'popular' },
    ]
    for (const t of friendThresholds) {
      if (friendCount >= t.min && !existing.has(t.key)) {
        results.push(await awardAchievement(admin, userId, t.key))
      }
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

  // Challenger / Challenge Master: count challenges created
  if (!existing.has('challenger') || !existing.has('challenge_master')) {
    const { count } = await admin
      .from('challenges')
      .select('id', { count: 'exact', head: true })
      .eq('challenger_id', userId)
      .eq('is_anonymous', false)

    const created = count ?? 0
    if (created >= 1 && !existing.has('challenger')) {
      results.push(await awardAchievement(admin, userId, 'challenger'))
    }
    if (created >= 10 && !existing.has('challenge_master')) {
      results.push(await awardAchievement(admin, userId, 'challenge_master'))
    }
  }

  // Rival (5 vs same opp) + Social Butterfly (10 total participated)
  if (!existing.has('rival') || !existing.has('social_butterfly')) {
    const { data: completed } = await admin
      .from('challenges')
      .select('challenger_id, challenged_id')
      .eq('status', 'completed')
      .eq('is_anonymous', false)
      .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)

    if (completed) {
      const total = completed.length
      if (total >= 10 && !existing.has('social_butterfly')) {
        results.push(await awardAchievement(admin, userId, 'social_butterfly'))
      }

      const opponentCounts: Record<string, number> = {}
      for (const c of completed) {
        const opponentId = c.challenger_id === userId ? c.challenged_id : c.challenger_id
        opponentCounts[opponentId] = (opponentCounts[opponentId] || 0) + 1
      }
      const maxVsSameOpponent = Math.max(0, ...Object.values(opponentCounts))
      if (maxVsSameOpponent >= 5 && !existing.has('rival')) {
        results.push(await awardAchievement(admin, userId, 'rival'))
      }
    }
  }

  return results
}

// ── 7. League achievements ──────────────────────────────────────

export async function checkLeagueAchievements(
  admin: AdminClient,
  userId: string,
): Promise<AwardResult[]> {
  const existing = await getExistingKeys(admin, userId)
  const results: AwardResult[] = []

  if (existing.has('league_starter') && existing.has('league_veteran')) return results

  const { count } = await admin
    .from('league_members')
    .select('league_id', { count: 'exact', head: true })
    .eq('user_id', userId)

  const leagueCount = count ?? 0
  if (leagueCount >= 1 && !existing.has('league_starter')) {
    results.push(await awardAchievement(admin, userId, 'league_starter'))
  }
  if (leagueCount >= 5 && !existing.has('league_veteran')) {
    results.push(await awardAchievement(admin, userId, 'league_veteran'))
  }
  return results
}
