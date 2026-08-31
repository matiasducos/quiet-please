import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { revalidateTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPointsForRound, calculateStreakMultiplier, committedPicks, buildFeedMap } from '@/lib/tennis'
import type { DrawMatch, Round, TournamentCategory } from '@/lib/tennis'
import { sendPointsAwardedEmail, sendTournamentCompleteEmails, isBotEmail } from '@/lib/email'
import type { PointsAwardedTournament } from '@/lib/email'
import { isEmailEnabled, type EmailPreferences } from '@/lib/email-preferences'
import { ROUND_LABEL, ROUND_ORDER } from '@/lib/tennis/my-tournament'
import { checkTournamentTrophies, checkCronAchievements, checkChallengeAchievements, checkPerfectPrediction } from '@/lib/achievements/check'
import { notifyAchievements } from '@/lib/achievements/notify'
import { withCronLogging } from '@/lib/cron-logger'
import { buildAndStoreRecap, getRecap, playerLabel } from '@/lib/tournaments/recap'

// Allow up to 60 s — heavy scoring + ranking recalculation needs headroom.
export const maxDuration = 60

/** Recaps built per cron run — see step 14 for why this is capped. */
const RECAPS_PER_RUN = 3

/**
 * Absolute base for links inside emails. Same fallback as `@/lib/email` — a
 * relative href is meaningless in an inbox, and `.env.local` carries
 * BASE_URL=localhost, so a script run from a dev machine must not be able to
 * mail production users a localhost link.
 */
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://quietplease.app'

/**
 * One row of `tournament_result_email_batch` (migration 090).
 *
 * Typed by hand for the reason `src/lib/tournaments/recap.ts` gives:
 * `src/types/database.ts` is a `Record<string, any>` placeholder because the
 * project is not linked locally and `supabase gen types` cannot run, so every
 * Supabase call returns `any`. Declaring the shape at the boundary is what
 * keeps the code consuming it typed.
 */
interface ResultEmailRow {
  prediction_id: string
  user_id: string
  username: string | null
  email: string | null
  points: number | null
  finish_rank: number | null
  field_size: number | null
  email_notifications: boolean | null
  email_preferences: Partial<EmailPreferences> | null
  unsubscribe_token: string | null
}

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false  // Fail closed — never open if secret is missing
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Silent mode (?silent=1): score everything as usual but send NO
  // notifications or emails — used by the admin "re-run tournament points"
  // repair flow, where re-notifying users about corrected points is noise.
  const silent = new URL(request.url).searchParams.get('silent') === '1'

  return withCronLogging('award-points', async () => {
    const supabase = createAdminClient()

    // ── Time budget ───────────────────────────────────────────────────────
    // The run must end on its own terms. When Vercel kills the function at
    // maxDuration instead, three things happen and none of them are visible
    // from the response: the cron_runs row is orphaned in 'running' (the next
    // invocation is what writes "Stale: timed out after 10 minutes", so the
    // error is always dated a day late), any statement still in flight is cut
    // off mid-transaction, and — the expensive one — a transaction abandoned
    // on a pooled connection keeps the database's xmin horizon pinned, which
    // stops autovacuum reclaiming dead tuples in EVERY table until it is
    // cleaned up. Bloat then drives disk reads that have nothing to do with
    // how much data the app actually holds.
    //
    // So: stop early, deliberately, and say so. Everything guarded by this
    // budget is best-effort work that runs after points, ledger rows,
    // rankings and league totals are already committed, and every piece of it
    // is idempotent — whatever is skipped is simply picked up by the next run.
    const runStart = Date.now()
    const SOFT_DEADLINE_MS = 45_000 // maxDuration is 60s; leave room to log and respond
    const msLeft = () => SOFT_DEADLINE_MS - (Date.now() - runStart)
    /** Enough budget left to start a phase that typically needs `needMs`? */
    const hasBudget = (needMs: number) => msLeft() > needMs
    const skippedForTime: string[] = []

    // ── 1. Get all match results (paginated to avoid PostgREST row limit) ─
    // Exclude BYE auto-advances — they don't award points
    const allResults: any[] = []
    {
      let from = 0
      const RESULT_PAGE = 1000
      while (true) {
        const { data: page, error: pageErr } = await supabase
          .from('match_results')
          // status/ends_at ride along on the join the query already does: the
          // achievement phase below needs them, and fetching them per result
          // was costing one sequential round trip per match result.
          .select('id, tournament_id, round, external_match_id, winner_external_id, scored_at, tournaments(id, category, starts_at, status, ends_at)')
          .or('score.neq.BYE,score.is.null')
          .order('played_at', { ascending: true })
          .range(from, from + RESULT_PAGE - 1)
        if (pageErr) throw new Error(`match_results query failed: ${pageErr.message}`)
        if (!page?.length) break
        allResults.push(...page)
        if (page.length < RESULT_PAGE) break
        from += RESULT_PAGE
      }
    }

    if (!allResults.length) {
      return { status: 200, body: { message: 'No match results found', awarded: 0 } }
    }

    // ── 2. Get already scored (match_result_id, prediction_id) pairs ──────
    // We now track per-prediction scoring, so the same match_result can be
    // scored for multiple predictions (global + challenge predictions).
    // Paginated to avoid PostgREST default row limit truncation.
    const alreadyScored: any[] = []
    {
      let from = 0
      const SCORED_PAGE = 1000
      while (true) {
        const { data: page, error: pageErr } = await supabase
          .from('point_ledger')
          .select('match_result_id, prediction_id')
          .range(from, from + SCORED_PAGE - 1)
        if (pageErr) throw new Error(`point_ledger query failed: ${pageErr.message}`)
        if (!page?.length) break
        alreadyScored.push(...page)
        if (page.length < SCORED_PAGE) break
        from += SCORED_PAGE
      }
    }

    const scoredPairs = new Set(
      alreadyScored.map(r => `${r.match_result_id}:${r.prediction_id}`)
    )

    // Get tournament IDs that have results
    const tournamentIds = Array.from(new Set(allResults.map((r: any) => r.tournament_id)))

    // ── 3. Get predictions for those tournaments (paginated) ──────────────
    // Fetched by tournament CHUNK, not one tournament at a time. The previous
    // shape ran a separate paginated query per tournament — 35 sequential
    // round trips to fetch ~1.3k rows, every one of them latency, and the
    // count grows with every tournament ever played. Chunking keeps the same
    // memory ceiling while collapsing that to a couple of round trips.
    //
    // Chunked rather than one big `.in()` because a few hundred UUIDs overflow
    // the request URL, and PostgREST's failure mode there is a truncated
    // result set with no error — the same trap 076 documents for recap ids.
    //
    // ORDER BY id is load-bearing: `range()` pagination without a stable sort
    // can repeat or skip rows between pages, which would silently drop
    // brackets from scoring.
    const PAGE_SIZE = 1000
    const TOURNAMENT_CHUNK = 40
    const predictions: any[] = []
    for (let c = 0; c < tournamentIds.length; c += TOURNAMENT_CHUNK) {
      const chunk = tournamentIds.slice(c, c + TOURNAMENT_CHUNK) as string[]
      let from = 0
      while (true) {
        const { data: page, error: pageErr } = await supabase
          .from('predictions')
          .select('id, user_id, tournament_id, challenge_id, picks, pick_locks, pick_lock_times, locked_picks, points_earned, expires_at')
          .in('tournament_id', chunk)
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1)
        if (pageErr) throw new Error(`predictions query failed: ${pageErr.message}`)
        if (!page?.length) break
        predictions.push(...page)
        if (page.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
    }

    if (!predictions.length) {
      return { status: 200, body: { message: 'No predictions found', awarded: 0 } }
    }

    console.log(`[award-points] ${predictions.length} predictions to check across ${tournamentIds.length} tournaments`)

    // ── Circuit breaker: warn on high volume ────────────────────────────
    if (predictions.length > 500) {
      Sentry.captureMessage(
        `[award-points] High volume: ${predictions.length} predictions across ${tournamentIds.length} tournaments`,
        'warning',
      )
    }

    // ── 4. Load bracket data for streak calculation ───────────────────────
    const { data: draws, error: drawsErr } = await supabase
      .from('draws')
      .select('tournament_id, bracket_data, locked_matches')
      .in('tournament_id', tournamentIds as string[])
    if (drawsErr) throw new Error(`draws query failed: ${drawsErr.message}`)

    const bracketByTournament: Record<string, { matches: DrawMatch[]; feedMap: ReturnType<typeof buildFeedMap> }> = {}
    // When the organiser froze each match. Already an ISO timestamp per match
    // id, so it needs no new storage — it is the other half of the stacking
    // boundary, and usually the earlier half, since results are entered by hand
    // some time after the match they describe.
    const adminLockedAtByTournament: Record<string, Record<string, string>> = {}
    for (const d of draws ?? []) {
      const bracket = d.bracket_data as any
      if (bracket?.matches) {
        bracketByTournament[d.tournament_id] = {
          matches: bracket.matches,
          feedMap: buildFeedMap(bracket.matches),
        }
      }
      adminLockedAtByTournament[d.tournament_id] =
        (d.locked_matches as Record<string, string> | null) ?? {}
    }

    // When each match was decided, for the stacking rule in the multiplier.
    //
    // Deliberately NOT taken from the workset above: that holds only results
    // this run still has to score, while the feeder a streak traces back
    // through was almost always scored on an earlier run and is absent from it.
    // Asking for the whole tournament is one small query — a draw is at most
    // 127 matches — and getting it wrong would silently deny every multiplier.
    const playedAtByTournament: Record<string, Record<string, string>> = {}
    {
      const { data: allResults, error: paErr } = await supabase
        .from('match_results')
        .select('tournament_id, external_match_id, played_at')
        .in('tournament_id', tournamentIds as string[])
      if (paErr) throw new Error(`played_at query failed: ${paErr.message}`)
      for (const r of allResults ?? []) {
        if (!r.played_at) continue
        ;(playedAtByTournament[r.tournament_id] ??= {})[r.external_match_id] = r.played_at
      }
    }

    // Fetch tournament names + location + starts_at + category for notifications, expires_at, and league filtering
    const { data: tournamentData, error: tournamentDataErr } = await supabase
      .from('tournaments')
      .select('id, name, location, flag_emoji, starts_at, category')
      .in('id', tournamentIds as string[])
    if (tournamentDataErr) throw new Error(`tournament data query failed: ${tournamentDataErr.message}`)
    const tournamentNames: Record<string, string> = {}
    const tournamentLocations: Record<string, string | null> = {}
    const tournamentFlags: Record<string, string | null> = {}
    const tournamentStartsAt: Record<string, string> = {}
    const tournamentCategories: Record<string, string> = {}
    for (const t of tournamentData ?? []) {
      tournamentNames[t.id] = t.name
      tournamentLocations[t.id] = t.location
      tournamentFlags[t.id] = t.flag_emoji
      tournamentStartsAt[t.id] = t.starts_at
      tournamentCategories[t.id] = t.category
    }

    // ── 5. Score predictions ──────────────────────────────────────────────
    const ledgerRows: any[] = []
    // Track deltas per global-prediction user (for total_points, leagues, rankings)
    const globalUserPointsDelta: Record<string, number> = {}
    const predictionPointsDelta: Record<string, number> = {}
    // Track per-user per-tournament points for notifications (global only)
    const userTournamentPoints: Record<string, Record<string, number>> = {}
    // Track per-user per-tournament per-round breakdown for the points email
    // (global only — same scope as userTournamentPoints, see the comment below).
    // `matches` = predicted matches processed for the FIRST time in this run
    // (win or loss), `wins` = how many of those were correct; only wins add
    // `points`. Scoped by match_results.scored_at — see newResultIds below.
    const userTournamentRounds: Record<string, Record<string, Record<string, { points: number; matches: number; wins: number }>>> = {}
    // Match results this run is processing for the first time. Losing picks
    // leave no trace in point_ledger, so without this marker every past loss
    // would be re-counted into the email breakdown on every single run.
    const newResultIds: string[] = []
    // Track auto-locks to apply
    const autoLocks: Map<string, Record<string, string>> = new Map() // predictionId → { matchId: "auto" }

    // Index predictions by tournament_id for O(1) lookup instead of O(n) scan
    const predsByTournament: Record<string, typeof predictions> = {}
    for (const p of predictions) {
      if (!predsByTournament[p.tournament_id]) predsByTournament[p.tournament_id] = []
      predsByTournament[p.tournament_id].push(p)
    }

    for (const result of allResults as any[]) {
      const tournament = result.tournaments as any
      if (!tournament?.category) continue

      // First time award-points sees this result? Only then do its losing picks
      // belong in the email breakdown — on later runs they're old news.
      // Hoisted above the basePoints guard so zero-point rounds (a 250's R64 has
      // no POINTS_TABLE entry) get stamped too and don't pile up in the index.
      // scored_at never gates SCORING — point_ledger still does — so a category
      // correction that turns a 0-point round into a real one still awards.
      const isNewResult = !result.scored_at
      if (isNewResult) newResultIds.push(result.id)

      const isWinner = result.round === 'F'
      const basePoints = getPointsForRound(
        tournament.category,
        result.round as any,
        isWinner
      )
      if (basePoints <= 0) continue

      const bracket = bracketByTournament[result.tournament_id]
      const tournamentPredictions = predsByTournament[result.tournament_id] ?? []

      for (const prediction of tournamentPredictions) {

        const picks = prediction.picks as Record<string, string>
        const lockedPicksSet = new Set((prediction.locked_picks as string[]) ?? [])

        // Which of this bracket's picks were locked before their match was
        // decided. Gates the streak multiplier: base points are unconditional,
        // the multiplier is what locking buys. Read from the row as fetched at
        // the top of the run, so the 'auto' locks this same run is about to
        // write in step 6 cannot back-date a commitment.
        const committed = committedPicks(prediction.pick_locks as Record<string, string> | null)

        // Auto-lock: if this prediction has a pick for this match, mark it as auto-locked
        if (picks[result.external_match_id]) {
          if (!autoLocks.has(prediction.id)) autoLocks.set(prediction.id, {})
          autoLocks.get(prediction.id)![result.external_match_id] = 'auto'
        }

        // Skip if this (match_result, prediction) pair is already scored
        if (scoredPairs.has(`${result.id}:${prediction.id}`)) continue

        // Skip locked picks — made after match started, no points / no streak / no ledger
        if (lockedPicksSet.has(result.external_match_id)) continue

        // A genuine prediction must exist for this match — matches the user
        // left blank don't count as "played" either way.
        const userPick = picks[result.external_match_id]
        if (!userPick) continue

        // Per-match check: the pick for THIS specific match must match the winner
        const didPickWinnerForThisMatch = userPick === result.winner_external_id

        // Record the win/loss outcome for the email breakdown regardless of
        // correctness — only wins earn points (below), but both count as a
        // match "played and predicted" this run.
        //
        // A win reaching this line is always new (the scoredPairs guard above
        // filters out already-scored pairs), so it's recorded unconditionally —
        // the points line below relies on the bucket existing. A LOSS has no
        // ledger row to dedupe against, so it only counts on the run that first
        // processes the result. Both conditions can hold at once: a pick added
        // to an existing bracket after the match played still scores, and still
        // needs its round line.
        if (!prediction.challenge_id && (isNewResult || didPickWinnerForThisMatch)) {
          if (!userTournamentRounds[prediction.user_id]) userTournamentRounds[prediction.user_id] = {}
          if (!userTournamentRounds[prediction.user_id][result.tournament_id]) userTournamentRounds[prediction.user_id][result.tournament_id] = {}
          const roundBucket = userTournamentRounds[prediction.user_id][result.tournament_id]
          if (!roundBucket[result.round]) roundBucket[result.round] = { points: 0, matches: 0, wins: 0 }
          roundBucket[result.round].matches += 1
          if (didPickWinnerForThisMatch) roundBucket[result.round].wins += 1
        }

        if (!didPickWinnerForThisMatch) continue

        // Calculate streak multiplier using bracket data
        let streakMultiplier = 1
        if (bracket) {
          streakMultiplier = calculateStreakMultiplier(
            result.external_match_id,
            result.winner_external_id,
            picks,
            bracket.feedMap,
            bracket.matches,
            lockedPicksSet,
            committed,
            (prediction.pick_lock_times as Record<string, string> | null) ?? undefined,
            playedAtByTournament[result.tournament_id],
            adminLockedAtByTournament[result.tournament_id],
          )
        }

        const totalPoints = basePoints * streakMultiplier

        console.log(
          `[award-points] ${prediction.user_id} pred=${prediction.id} ` +
          `gets ${basePoints}x${streakMultiplier}=${totalPoints} pts for ${result.round}` +
          (prediction.challenge_id ? ` (challenge ${prediction.challenge_id})` : ' (global)')
        )

        ledgerRows.push({
          user_id:           prediction.user_id,
          tournament_id:     result.tournament_id,
          match_result_id:   result.id,
          prediction_id:     prediction.id,
          round:             result.round,
          points:            totalPoints,
          streak_multiplier: streakMultiplier,
        })

        predictionPointsDelta[prediction.id] = (predictionPointsDelta[prediction.id] ?? 0) + totalPoints

        // Only global predictions affect user total_points / leagues / rankings
        if (!prediction.challenge_id) {
          globalUserPointsDelta[prediction.user_id] = (globalUserPointsDelta[prediction.user_id] ?? 0) + totalPoints

          if (!userTournamentPoints[prediction.user_id]) userTournamentPoints[prediction.user_id] = {}
          userTournamentPoints[prediction.user_id][result.tournament_id] =
            (userTournamentPoints[prediction.user_id][result.tournament_id] ?? 0) + totalPoints

          // Bucket already exists — created above when this match's win/loss was recorded.
          userTournamentRounds[prediction.user_id][result.tournament_id][result.round].points += totalPoints
        }
      }
    }

    // ── 6. Apply auto-locks to predictions (batched) ──────────────────────
    let autoLocksApplied = 0
    const predMap = new Map((predictions ?? []).map(p => [p.id, p]))
    const autoLockUpdates: Array<PromiseLike<any>> = []
    for (const [predId, newLocks] of autoLocks) {
      const pred = predMap.get(predId)
      if (!pred) continue

      const existingLocks = (pred.pick_locks as Record<string, string>) ?? {}
      const merged = { ...existingLocks }
      let hasNew = false
      for (const [matchId, lockType] of Object.entries(newLocks)) {
        if (!merged[matchId]) {
          merged[matchId] = lockType
          hasNew = true
        }
      }
      if (hasNew) {
        autoLockUpdates.push(
          supabase.from('predictions').update({ pick_locks: merged }).eq('id', predId)
        )
        autoLocksApplied++
      }
    }
    // Run auto-lock updates in parallel batches of 50
    for (let i = 0; i < autoLockUpdates.length; i += 50) {
      await Promise.all(autoLockUpdates.slice(i, i + 50))
    }

    if (autoLocksApplied > 0) {
      console.log(`[award-points] Auto-locked picks on ${autoLocksApplied} predictions`)
    }

    // ── 7. Insert point ledger + update predictions ────────────────────────
    // Hoisted out of the `if` below so step 10 (email rank/movement) can read
    // post-run totals for predictions scored this run, falling back to the
    // pre-run predMap value for everyone else.
    const predPointsTotals: Record<string, number> = {}
    if (ledgerRows.length > 0) {
      // Use upsert with ignoreDuplicates to safely handle concurrent cron runs.
      // The DB unique constraint on (match_result_id, prediction_id) ensures
      // no double-awards even if the application-level scoredPairs check races.
      const { error: ledgerError } = await supabase
        .from('point_ledger')
        .upsert(ledgerRows, { onConflict: 'match_result_id,prediction_id', ignoreDuplicates: true })
      if (ledgerError) throw ledgerError

      // ── 8. Update prediction points_earned + expires_at ──────────────────
      // Must run BEFORE ranking recalculation (which reads predictions.points_earned)
      // Idempotent: recalculate points_earned from point_ledger SUM instead of
      // incrementally adding deltas (prevents inflation from stale scoredPairs).
      const affectedPredIds = Object.keys(predictionPointsDelta)

      // Fetch actual ledger totals per prediction (avoids row limit issues)
      for (let i = 0; i < affectedPredIds.length; i += 50) {
        await Promise.all(
          affectedPredIds.slice(i, i + 50).map(async predId => {
            const { data } = await supabase
              .from('point_ledger')
              .select('points')
              .eq('prediction_id', predId)
            predPointsTotals[predId] = (data ?? []).reduce((acc, r) => acc + r.points, 0)
          })
        )
      }

      const predictionUpdates = affectedPredIds.map(predId => {
        const pred = predMap.get(predId)
        const updateRow: Record<string, any> = {
          points_earned: predPointsTotals[predId] ?? 0,
        }
        if (!pred?.expires_at && pred?.tournament_id) {
          const startsAt = tournamentStartsAt[pred.tournament_id]
          if (startsAt) {
            const expiresAt = new Date(new Date(startsAt).getTime() + 364 * 24 * 60 * 60 * 1000)
            updateRow.expires_at = expiresAt.toISOString()
          }
        }
        return supabase.from('predictions').update(updateRow).eq('id', predId)
      })
      for (let i = 0; i < predictionUpdates.length; i += 50) {
        await Promise.all(predictionUpdates.slice(i, i + 50))
      }
    }

    // ── 8b. Stamp newly processed match results ──────────────────────────
    // Runs AFTER the ledger insert: if that throws, these stay NULL and the
    // next run reprocesses them rather than silently swallowing a round.
    // Stamped by explicit id — a blanket `where scored_at is null` would also
    // catch results inserted by sync-results while this run was in flight.
    if (newResultIds.length > 0) {
      // Chunked: a single .in() with hundreds of uuids overflows the request URL.
      for (let i = 0; i < newResultIds.length; i += 200) {
        const { error: stampErr } = await supabase
          .from('match_results')
          .update({ scored_at: new Date().toISOString() })
          .in('id', newResultIds.slice(i, i + 200))
        if (stampErr) throw new Error(`match_results scored_at update failed: ${stampErr.message}`)
      }
      console.log(`[award-points] Marked ${newResultIds.length} match results as scored`)
    }

    // ── 9. Update global user totals + leagues + rankings ───────────────
    const userIds = Object.keys(globalUserPointsDelta)

    // 9a. Targeted league recalculation — only for users who got new points
    // Instead of the global recalculate_league_points() which scans ALL leagues,
    // find which leagues the affected users belong to and recalculate only those.
    if (userIds.length > 0) {
      const { data: memberships, error: memberError } = await supabase
        .from('league_members')
        .select('league_id, user_id')
        .in('user_id', userIds)
      if (memberError) {
        console.error('[award-points] league membership lookup error:', memberError)
        Sentry.captureException(memberError)
      } else if (memberships && memberships.length > 0) {
        for (let i = 0; i < memberships.length; i += 50) {
          await Promise.all(
            memberships.slice(i, i + 50).map(m =>
              supabase.rpc('recalculate_member_points', { p_league_id: m.league_id, p_user_id: m.user_id })
            )
          )
        }
        console.log(`[award-points] Recalculated league points for ${memberships.length} (user, league) pairs`)
      }
    }

    // 9b. Recalculate rankings only for users who got new points this run
    // (targeted instead of scanning all users with points)
    //
    // One set-based call rather than one RPC per user. The per-user function
    // was the heaviest workload in the database — 3,452 calls and 56.6s of
    // lifetime execution time, most of it this loop — because scoring 18
    // users meant 18 round trips and 36 statements to touch 18 rows. 084 does
    // the same work in a single statement; see it for why the semantics are
    // identical and why users with no qualifying predictions still get
    // written rather than skipped.
    //
    // Chunked so one enormous run cannot build a single unbounded UPDATE. The
    // ids travel in the POST body, not the URL, so this is about bounding the
    // transaction, not the `.in()` overflow that constrains the reads above.
    for (let i = 0; i < userIds.length; i += 1000) {
      const { error: rankErr } = await supabase.rpc('recalculate_ranking_points_bulk', {
        p_user_ids: userIds.slice(i, i + 1000),
      })
      if (rankErr) {
        // Loud, but not fatal: the ledger rows are already written, so the
        // next run recomputes from them. Swallowing this would leave every
        // affected user's public ranking silently stale instead.
        console.error('[award-points] bulk ranking recalculation failed:', rankErr)
        Sentry.captureException(rankErr)
      }
    }

    // ── 9c. Worldwide rank + movement per tournament, for the points email ──
    // Reuses predsByTournament (already in memory from step 5) — no extra
    // queries. "Before" ranks use the points_earned each prediction had when
    // loaded at the top of this run; "after" ranks use predPointsTotals where
    // this run touched the prediction, falling back to the pre-run value
    // otherwise. Scoped to global predictions only, matching the public
    // tournament leaderboard (`challenge_id is null`).
    const rankByTournament: Record<string, { total: number; byUser: Record<string, { position: number; previousPosition: number }> }> = {}
    {
      const tournamentIdsNeedingRank = new Set<string>()
      for (const tPoints of Object.values(userTournamentPoints)) {
        for (const tId of Object.keys(tPoints)) tournamentIdsNeedingRank.add(tId)
      }
      for (const tId of tournamentIdsNeedingRank) {
        const globalPreds = (predsByTournament[tId] ?? []).filter(p => !p.challenge_id)
        if (globalPreds.length === 0) continue

        const previousPositionByUser: Record<string, number> = {}
        globalPreds
          .map(p => ({ userId: p.user_id, pts: p.points_earned ?? 0 }))
          .sort((a, b) => b.pts - a.pts)
          .forEach((row, idx) => { previousPositionByUser[row.userId] = idx + 1 })

        const byUser: Record<string, { position: number; previousPosition: number }> = {}
        globalPreds
          .map(p => ({ userId: p.user_id, pts: predPointsTotals[p.id] ?? p.points_earned ?? 0 }))
          .sort((a, b) => b.pts - a.pts)
          .forEach((row, idx) => {
            byUser[row.userId] = { position: idx + 1, previousPosition: previousPositionByUser[row.userId] ?? idx + 1 }
          })

        rankByTournament[tId] = { total: globalPreds.length, byUser }
      }
    }

    // ── 10. Notifications (blocking) + emails (fire-and-forget) ──────────
    if (silent) {
      console.log('[award-points] silent mode — skipping points notifications and emails')
    } else try {
      const notifRows: Array<{ user_id: string; type: string; tournament_id: string; meta: any }> = []

      // One email per user per cron run — aggregates every tournament they
      // scored in this run, each broken down by round.
      const emailJobs: Array<{ userId: string; correctPicks: number; totalPoints: number; tournaments: PointsAwardedTournament[] }> = []

      for (const [userId, tPoints] of Object.entries(userTournamentPoints)) {
        const tournaments: PointsAwardedTournament[] = []
        let correctPicks = 0
        for (const [tId, pts] of Object.entries(tPoints)) {
          const tName = tournamentNames[tId] ?? 'a tournament'
          notifRows.push({
            user_id: userId,
            type: 'points_awarded',
            tournament_id: tId,
            meta: { points: pts, tournament_name: tName, tournament_location: tournamentLocations[tId] ?? null, tournament_flag_emoji: tournamentFlags[tId] ?? null },
          })

          const roundBucket = userTournamentRounds[userId]?.[tId] ?? {}
          const roundOrder: readonly string[] = ROUND_ORDER
          const rounds = Object.entries(roundBucket)
            .sort(([a], [b]) => roundOrder.indexOf(a) - roundOrder.indexOf(b))
            .map(([round, { points, matches, wins }]) => ({
              round,
              label: ROUND_LABEL[round] ?? round,
              matches,
              wins,
              points,
            }))
          correctPicks += rounds.reduce((acc, r) => acc + r.wins, 0)

          const rank = rankByTournament[tId]?.byUser[userId]
          tournaments.push({
            tournamentId: tId,
            tournamentName: tName,
            flagEmoji: tournamentFlags[tId] ?? null,
            points: pts,
            rank: rank
              ? { position: rank.position, total: rankByTournament[tId].total, movement: rank.previousPosition - rank.position }
              : null,
            rounds,
          })
        }
        const totalPoints = Object.values(tPoints).reduce((a, b) => a + b, 0)
        emailJobs.push({ userId, correctPicks, totalPoints, tournaments })
      }

      // Batch insert all notifications at once (await — these are fast DB inserts)
      if (notifRows.length > 0) {
        await (supabase as any).from('notifications').insert(notifRows)
      }

      // Fire-and-forget emails — don't block the cron response on slow SMTP calls.
      // Errors are logged but won't fail the cron run.
      if (emailJobs.length > 0) {
        // Fetch email preferences for all users in this batch
        const emailUserIds = [...new Set(emailJobs.map(j => j.userId))]
        // `email` rides along on the prefs query. It used to come from a
        // per-recipient supabase.auth.admin.getUserById() call inside the send
        // loop below — one GoTrue round trip per user, serialised behind the
        // batch, for a value public.users already stores. 083 documents why
        // that column is `text not null` and safe to read here: the signup
        // trigger copies auth.users.email into it and refuses any provider
        // sign-in that arrives without one.
        const { data: emailPrefs, error: prefsErr } = await supabase
          .from('users')
          .select('id, email, email_notifications, email_preferences, unsubscribe_token')
          .in('id', emailUserIds)
        if (prefsErr) {
          // Destructured deliberately: falling through with an empty list would
          // silently send nobody their points email and look like success.
          console.error('[award-points] email prefs lookup failed:', prefsErr)
          Sentry.captureException(prefsErr)
        }
        const prefsMap = new Map((emailPrefs ?? []).map((p: any) => [p.id, p]))

        const sendEmails = async () => {
          for (let i = 0; i < emailJobs.length; i += 10) {
            await Promise.all(
              emailJobs.slice(i, i + 10).map(async (job) => {
                try {
                  const prefs = prefsMap.get(job.userId)
                  if (!isEmailEnabled(prefs?.email_notifications, prefs?.email_preferences, 'points_awarded')) return
                  if (prefs?.email && !isBotEmail(prefs.email)) {
                    await sendPointsAwardedEmail({
                      to: prefs.email,
                      totalPoints: job.totalPoints,
                      correctPicks: job.correctPicks,
                      tournaments: job.tournaments,
                      unsubscribeToken: prefs?.unsubscribe_token ?? '',
                    })
                  }
                } catch (emailErr) {
                  console.error(`[award-points] email error for ${job.userId}:`, emailErr)
                  Sentry.captureException(emailErr)
                }
              })
            )
          }
        }
        // Await emails — Vercel freezes the runtime after response, so fire-and-forget would drop them.
        // Individual emails are already wrapped in try/catch so one failure won't kill the batch.
        await sendEmails()
      }
    } catch (notifyErr) {
      console.error('[award-points] notification error:', notifyErr)
      Sentry.captureException(notifyErr)
    }

    // ── 11. Score and finalize completed challenges ───────────────────────
    let challengesScored = 0
    let challengesExpired = 0
    try {
      // 11a. Expire pending challenges for completed tournaments only.
      // in_progress is intentionally excluded — friends challenges allow
      // predictions during in_progress tournaments, so the invite stays open.
      const { data: pendingChallenges } = await supabase
        .from('challenges')
        .select('id, tournament_id')
        .eq('status', 'pending')

      if (pendingChallenges?.length) {
        const pendingTournamentIds = Array.from(new Set(pendingChallenges.map(c => c.tournament_id)))
        const { data: startedTournaments } = await supabase
          .from('tournaments')
          .select('id')
          .in('id', pendingTournamentIds as string[])
          .in('status', ['completed'])

        const startedIds = new Set((startedTournaments ?? []).map(t => t.id))
        const toExpire = pendingChallenges.filter(c => startedIds.has(c.tournament_id))

        if (toExpire.length > 0) {
          const expireIds = toExpire.map(c => c.id)
          await supabase
            .from('challenges')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .in('id', expireIds)
          challengesExpired = toExpire.length
        }
      }

      // 11b. Score accepted challenges for completed tournaments
      // Now uses challenge-specific predictions (challenge_id = challenge.id)
      const { data: acceptedChallenges } = await supabase
        .from('challenges')
        .select('id, challenger_id, challenged_id, tournament_id')
        .eq('status', 'accepted')

      if (acceptedChallenges?.length) {
        const acceptedTournamentIds = Array.from(new Set(acceptedChallenges.map(c => c.tournament_id)))
        const { data: completedTournaments } = await supabase
          .from('tournaments')
          .select('id')
          .in('id', acceptedTournamentIds as string[])
          .eq('status', 'completed')

        const completedIds = new Set((completedTournaments ?? []).map(t => t.id))
        const toScore = acceptedChallenges.filter(c => completedIds.has(c.tournament_id))

        for (const challenge of toScore) {
          // Fetch challenge-specific predictions for both players
          const { data: preds } = await supabase
            .from('predictions')
            .select('user_id, points_earned, picks')
            .eq('challenge_id', challenge.id)
            .eq('tournament_id', challenge.tournament_id)

          const challengerPred = (preds ?? []).find(p => p.user_id === challenge.challenger_id)
          const challengedPred = (preds ?? []).find(p => p.user_id === challenge.challenged_id)

          const challengerPts   = challengerPred?.points_earned ?? 0
          const challengedPts   = challengedPred?.points_earned ?? 0
          const challengerCount = Object.keys((challengerPred?.picks as Record<string, string> | null) ?? {}).length
          const challengedCount = Object.keys((challengedPred?.picks as Record<string, string> | null) ?? {}).length

          let winner_id: string | null = null
          if (challengerPts > challengedPts)       winner_id = challenge.challenger_id
          else if (challengedPts > challengerPts)  winner_id = challenge.challenged_id
          else if (challengerCount > challengedCount) winner_id = challenge.challenger_id
          else if (challengedCount > challengerCount) winner_id = challenge.challenged_id
          // else draw: winner_id stays null

          await supabase
            .from('challenges')
            .update({
              status:                          'completed',
              challenger_points:               challengerPts,
              challenged_points:               challengedPts,
              challenger_predictions_count:    challengerCount,
              challenged_predictions_count:    challengedCount,
              winner_id,
              updated_at:                      new Date().toISOString(),
            })
            .eq('id', challenge.id)

          challengesScored++
        }
      }
    } catch (challengeErr) {
      console.error('[award-points] challenge scoring error:', challengeErr)
      Sentry.captureException(challengeErr)
    }

    // ── 12. Score anonymous challenges ────────────────────────────────────
    let anonChallengesScored = 0
    try {
      const { data: anonChallenges } = await supabase
        .from('challenges')
        .select('id, tournament_id, creator_picks, opponent_picks, creator_locked_picks, opponent_locked_picks, challenger_points, challenged_points, status')
        .eq('is_anonymous', true)
        .eq('status', 'active')

      if (anonChallenges?.length) {
        const { scoreAnonymousPicks } = await import('@/lib/tennis/anonymous-scoring')

        for (const ac of anonChallenges) {
          const bracket = bracketByTournament[ac.tournament_id]
          if (!bracket) continue

          const category = tournamentCategories[ac.tournament_id] as TournamentCategory | undefined
          if (!category) continue

          // Get match results for this tournament
          const tournamentResults = allResults.filter(r => r.tournament_id === ac.tournament_id)
          if (tournamentResults.length === 0) continue

          const typedResults = tournamentResults
            .filter((r: any) => r.score !== 'BYE')
            .map((r: any) => ({
              external_match_id: r.external_match_id,
              round: r.round as Round,
              winner_external_id: r.winner_external_id,
              score: r.score,
            }))

          const creatorScore = scoreAnonymousPicks(
            (ac.creator_picks as Record<string, string>) ?? {},
            typedResults,
            category,
            bracket.matches,
            (ac.creator_locked_picks as string[]) ?? [],
          )
          const opponentScore = scoreAnonymousPicks(
            (ac.opponent_picks as Record<string, string>) ?? {},
            typedResults,
            category,
            bracket.matches,
            (ac.opponent_locked_picks as string[]) ?? [],
          )

          // Build auto-locks for played matches
          const creatorLocks: Record<string, string> = {}
          const opponentLocks: Record<string, string> = {}
          for (const r of typedResults) {
            if ((ac.creator_picks as any)?.[r.external_match_id]) creatorLocks[r.external_match_id] = 'auto'
            if ((ac.opponent_picks as any)?.[r.external_match_id]) opponentLocks[r.external_match_id] = 'auto'
          }

          const updateData: Record<string, any> = {
            challenger_points: creatorScore.totalPoints,
            challenged_points: opponentScore.totalPoints,
            creator_pick_locks: creatorLocks,
            opponent_pick_locks: opponentLocks,
            updated_at: new Date().toISOString(),
          }

          // Check if tournament is completed → finalize challenge
          const { data: tStatus } = await supabase
            .from('tournaments')
            .select('status')
            .eq('id', ac.tournament_id)
            .single()

          if (tStatus?.status === 'completed') {
            updateData.status = 'completed'
            // winner_id stays null for anonymous — UI uses points comparison
          }

          await supabase.from('challenges').update(updateData).eq('id', ac.id)
          anonChallengesScored++
        }
      }
    } catch (anonErr) {
      console.error('[award-points] anonymous challenge scoring error:', anonErr)
      Sentry.captureException(anonErr)
    }

    // ── 12b. Tell anonymous players how their challenge finished ──────────
    //
    // Deliberately a separate pass rather than a send inside the loop above.
    // That loop only sees `status = 'active'` challenges and flips them to
    // 'completed' — so a send wired into it would get exactly one attempt, and
    // a Resend blip or a timeout would lose the email permanently with the row
    // already marked finished.
    //
    // Driving it off "completed, has an address, not yet emailed" instead makes
    // the send idempotent and self-healing: a failure simply leaves the guard
    // NULL and the next run picks it up again.
    let anonResultEmails = 0
    if (!silent) {
      try {
        const { data: pendingEmails, error: pendingErr } = await supabase
          .from('challenges')
          .select('id, tournament_id, share_code, creator_name, opponent_name, challenger_points, challenged_points, creator_email, opponent_email, creator_email_token, opponent_email_token, creator_result_emailed_at, opponent_result_emailed_at')
          .eq('is_anonymous', true)
          .eq('status', 'completed')
          .or('and(creator_email.not.is.null,creator_result_emailed_at.is.null),and(opponent_email.not.is.null,opponent_result_emailed_at.is.null)')
          .limit(200)

        if (pendingErr) throw pendingErr

        if (pendingEmails?.length) {
          const { sendAnonymousChallengeResultEmail, isBotEmail } = await import('@/lib/email')

          // One lookup for the whole batch. The id set is bounded by the LIMIT
          // above and is normally a handful of tournaments, so this stays well
          // clear of the URL length that .in() starts to overflow at.
          const tournamentIds = [...new Set(pendingEmails.map(c => c.tournament_id))]
          const { data: tRows } = await supabase
            .from('tournaments')
            .select('id, name, location, flag_emoji')
            .in('id', tournamentIds)
          const tById = new Map((tRows ?? []).map(t => [t.id, t]))

          for (const c of pendingEmails) {
            const t = tById.get(c.tournament_id)
            if (!t) continue

            const sides = [
              {
                key: 'creator' as const,
                email: c.creator_email,
                token: c.creator_email_token,
                sent: c.creator_result_emailed_at,
                yourName: c.creator_name ?? 'You',
                opponentName: c.opponent_name ?? 'Your opponent',
                yourPoints: c.challenger_points ?? 0,
                opponentPoints: c.challenged_points ?? 0,
              },
              {
                key: 'opponent' as const,
                email: c.opponent_email,
                token: c.opponent_email_token,
                sent: c.opponent_result_emailed_at,
                yourName: c.opponent_name ?? 'You',
                opponentName: c.creator_name ?? 'Your opponent',
                yourPoints: c.challenged_points ?? 0,
                opponentPoints: c.challenger_points ?? 0,
              },
            ]

            for (const side of sides) {
              if (!side.email || side.sent) continue
              if (isBotEmail(side.email)) continue

              try {
                await sendAnonymousChallengeResultEmail({
                  to: side.email,
                  yourName: side.yourName,
                  opponentName: side.opponentName,
                  yourPoints: side.yourPoints,
                  opponentPoints: side.opponentPoints,
                  tournamentName: t.location ?? t.name,
                  tournamentFlagEmoji: t.flag_emoji,
                  shareCode: c.share_code,
                  emailToken: side.token ?? '',
                })

                // Only claimed after the send returns. Claiming first would
                // turn a transient Resend failure into a permanently missing
                // email, which is the exact outcome this pass exists to avoid.
                //
                // The address is erased in the same write. It was collected for
                // this one message, that message has now gone, and the
                // timestamp alone is enough to stop a second one — so there is
                // nothing left for it to do but sit in the database being a
                // liability.
                await supabase
                  .from('challenges')
                  .update({
                    [`${side.key}_result_emailed_at`]: new Date().toISOString(),
                    [`${side.key}_email`]: null,
                    [`${side.key}_email_token`]: null,
                  })
                  .eq('id', c.id)

                anonResultEmails++
              } catch (sendErr) {
                // Left unclaimed on purpose so the next run retries this one.
                console.error(`[award-points] anon result email failed (${c.id}/${side.key}):`, sendErr)
                Sentry.captureException(sendErr)
              }
            }
          }
        }
      } catch (emailErr) {
        console.error('[award-points] anonymous result email error:', emailErr)
        Sentry.captureException(emailErr)
      }
    }

    // ── 12c. Tell signed-out solo bracket players how they finished ───────
    //
    // The /play entry point's counterpart to 12b. Same self-healing shape:
    // driven off "has an address, not yet emailed", the guard is only stamped
    // after the send returns, so a Resend failure is retried next run instead
    // of vanishing.
    //
    // The pending set is tiny by construction — it is only people who left an
    // address and have not been mailed yet — and is backed by the partial
    // index in 085, so this stays cheap however large the table grows.
    let anonBracketEmails = 0
    if (!silent) {
      try {
        const { data: pendingBrackets, error: pendingBracketErr } = await supabase
          .from('anonymous_predictions')
          .select('id, tournament_id, share_code, display_name, picks, locked_picks, email, email_token, claimed_by')
          .not('email', 'is', null)
          .is('result_emailed_at', null)
          .limit(200)

        if (pendingBracketErr) throw pendingBracketErr

        if (pendingBrackets?.length) {
          const { sendAnonymousBracketResultEmail, isBotEmail } = await import('@/lib/email')
          const { scoreAnonymousPicks } = await import('@/lib/tennis/anonymous-scoring')

          // Only completed tournaments owe anyone a result. Resolved from the
          // maps this run already built rather than re-queried per row.
          for (const bracketRow of pendingBrackets) {
            const tournamentId = bracketRow.tournament_id

            // Claimed brackets are somebody's real prediction now. They get the
            // normal signed-in points mail, and pitching "create a free
            // account" at someone who just made one is worse than saying
            // nothing — so the address is retired without a send.
            if (bracketRow.claimed_by) {
              await supabase
                .from('anonymous_predictions')
                .update({
                  result_emailed_at: new Date().toISOString(),
                  email: null,
                  email_token: null,
                })
                .eq('id', bracketRow.id)
              continue
            }

            const { data: tRow } = await supabase
              .from('tournaments')
              .select('status, name, location, flag_emoji, category')
              .eq('id', tournamentId)
              .single()

            if (tRow?.status !== 'completed') continue
            if (isBotEmail(bracketRow.email!)) continue

            const bracket = bracketByTournament[tournamentId]
            if (!bracket) continue

            const typedResults = allResults
              .filter((r: any) => r.tournament_id === tournamentId && r.score !== 'BYE')
              .map((r: any) => ({
                external_match_id: r.external_match_id,
                round: r.round as Round,
                winner_external_id: r.winner_external_id,
                score: r.score,
              }))
            if (typedResults.length === 0) continue

            const score = scoreAnonymousPicks(
              (bracketRow.picks as Record<string, string>) ?? {},
              typedResults,
              tRow.category as TournamentCategory,
              bracket.matches,
              (bracketRow.locked_picks as string[]) ?? [],
            )

            try {
              await sendAnonymousBracketResultEmail({
                to: bracketRow.email!,
                name: bracketRow.display_name ?? 'Your bracket',
                points: score.totalPoints,
                correctPicks: score.correctPicks,
                matchesScored: score.totalResults,
                tournamentName: tRow.location ?? tRow.name,
                tournamentFlagEmoji: tRow.flag_emoji,
                shareCode: bracketRow.share_code,
                emailToken: bracketRow.email_token ?? '',
              })

              // Claimed only after the send returns, and the address is erased
              // in the same write — it was collected for this one message and
              // the timestamp alone prevents a second.
              await supabase
                .from('anonymous_predictions')
                .update({
                  result_emailed_at: new Date().toISOString(),
                  email: null,
                  email_token: null,
                })
                .eq('id', bracketRow.id)

              anonBracketEmails++
            } catch (sendErr) {
              // Left unclaimed on purpose so the next run retries this one.
              console.error(`[award-points] anon bracket email failed (${bracketRow.id}):`, sendErr)
              Sentry.captureException(sendErr)
            }
          }
        }
      } catch (bracketEmailErr) {
        console.error('[award-points] anonymous bracket email error:', bracketEmailErr)
        Sentry.captureException(bracketEmailErr)
      }
    }

    // ── 13. Achievement checks ─────────────────────────────────────────
    let achievementsAwarded = 0
    // Silent mode still AWARDS achievements (data correctness) but skips the
    // notification + email for each.
    const maybeNotifyAchievements = async (results: Parameters<typeof notifyAchievements>[1]) => {
      if (!silent) await notifyAchievements(supabase, results)
    }
    try {
      // 13a. Tournament trophies — for completed tournaments still in scope.
      //
      // This used to fetch tournaments.status once per match result: one
      // sequential round trip per row of allResults, for a handful of distinct
      // tournaments, on every run including ones that awarded nothing. status
      // now rides along on the join above, so the set costs no queries at all.
      //
      // Scope matters as much as cost. Every completed tournament stayed in
      // this set forever, so the achievement loops below re-checked the entire
      // back catalogue on every run and the job grew slower with each event
      // ever played. A tournament is in scope when either:
      //   (a) it was scored this run — covers reruns and backfills, or
      //   (b) it finished recently — covers a tournament completing in a run
      //       that happened to score nothing new.
      // (b) is a window rather than a one-shot flag so a missed or killed run
      // self-heals on the next one.
      const ACHIEVEMENT_WINDOW_DAYS = 30
      const windowStart = Date.now() - ACHIEVEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
      const scoredThisRun = new Set(ledgerRows.map(r => r.tournament_id))

      const completedTournamentIds = new Set<string>()
      for (const r of allResults as any[]) {
        const t = r.tournaments
        if (t?.status !== 'completed') continue
        if (scoredThisRun.has(r.tournament_id)) {
          completedTournamentIds.add(r.tournament_id)
          continue
        }
        // No ends_at means we cannot age it out — keep it rather than risk
        // silently dropping a tournament's achievements.
        const endsAt = t.ends_at ? new Date(t.ends_at).getTime() : null
        if (endsAt === null || endsAt >= windowStart) completedTournamentIds.add(r.tournament_id)
      }
      console.log(`[award-points] achievement scope: ${completedTournamentIds.size} completed tournaments`)

      // Each of the achievement loops below is one sequential round trip per
      // item and every one of them is an idempotent re-check — the `isNew`
      // flag is what makes a second pass cheap and harmless. That is exactly
      // the property that makes them safe to cut short: an achievement the
      // budget defers is awarded by the next run, whereas a run killed here
      // strands the transaction (see the time budget at the top).
      let trophiesChecked = 0
      for (const tId of completedTournamentIds) {
        if (!hasBudget(3_000)) {
          skippedForTime.push(`trophies(${completedTournamentIds.size - trophiesChecked} remaining)`)
          break
        }
        const trophyResults = await checkTournamentTrophies(supabase, tId)
        await maybeNotifyAchievements(trophyResults)
        achievementsAwarded += trophyResults.filter(r => r.isNew).length
        trophiesChecked++
      }

      // 13b. Per-user cron achievements (accuracy, streaks, points milestones)
      const cronAchievementUsers = Object.keys(globalUserPointsDelta)
      let usersChecked = 0
      for (const userId of cronAchievementUsers) {
        if (!hasBudget(3_000)) {
          skippedForTime.push(`user_achievements(${cronAchievementUsers.length - usersChecked} remaining)`)
          break
        }
        const userTournaments = Object.keys(userTournamentPoints[userId] ?? {})
        for (const tId of userTournaments) {
          const cronResults = await checkCronAchievements(supabase, userId, tId)
          await maybeNotifyAchievements(cronResults)
          achievementsAwarded += cronResults.filter(r => r.isNew).length
        }
        usersChecked++
      }

      // 13b-bis. Perfect Prediction — only check for completed tournaments
      // (a player can earn this only once the tournament is over)
      for (const tId of completedTournamentIds) {
        const { data: tournamentPickers } = await supabase
          .from('predictions')
          .select('user_id')
          .eq('tournament_id', tId)
          .is('challenge_id', null)

        // Batched rather than sequential: checkPerfectPrediction runs two
        // queries of its own, so a popular draw (97 pickers on one tournament
        // here) cost ~200 sequential round trips on its own. Each picker
        // touches a different user's achievement rows, so they do not contend.
        const pickerIds = [...new Set((tournamentPickers ?? []).map(p => p.user_id))]
        for (let i = 0; i < pickerIds.length; i += 50) {
          const batch = await Promise.all(
            pickerIds.slice(i, i + 50).map(uid => checkPerfectPrediction(supabase, uid, tId))
          )
          for (const perfectResults of batch) {
            await maybeNotifyAchievements(perfectResults)
            achievementsAwarded += perfectResults.filter(r => r.isNew).length
          }
        }
      }

      // 13c. Challenge achievements: check rival for users whose challenges were completed
      for (const tId of completedTournamentIds) {
        const { data: justCompleted } = await supabase
          .from('challenges')
          .select('challenger_id, challenged_id')
          .eq('tournament_id', tId)
          .eq('status', 'completed')
          .eq('is_anonymous', false)

        if (justCompleted) {
          const userIds = new Set<string>()
          for (const c of justCompleted) {
            userIds.add(c.challenger_id)
            userIds.add(c.challenged_id)
          }
          for (const uid of userIds) {
            const rivalResults = await checkChallengeAchievements(supabase, uid)
            await maybeNotifyAchievements(rivalResults)
            achievementsAwarded += rivalResults.filter(r => r.isNew).length
          }
        }
      }
    } catch (achErr) {
      console.error('[award-points] achievement checking error:', achErr)
      Sentry.captureException(achErr)
    }

    // ── 14. Build end-of-tournament recaps ────────────────────────────────
    //
    // Last, and in the cron rather than at the moment an admin flips the
    // status, because the recap reports settled numbers: points_machine, the
    // podium and points_awarded all read predictions.points_earned and the
    // ledger. An admin marking a tournament completed seconds after entering
    // the final result would produce a recap whose podium predates the final's
    // own points. Building here means every point this run could award has
    // already been written.
    //
    // Capped per run. A recap expands every global bracket's picks, so a
    // backlog — the first run after this ships sees every completed tournament
    // at once — would blow through maxDuration and get killed mid-flight,
    // leaving the "Stale: timed out" row that makes every later run look
    // broken. Three per run drains the backlog over a few minutes instead.
    let recapsBuilt = 0
    try {
      // Newest first, and only a window of them. Two reasons for the cap:
      // every id here goes into an `.in()` filter below, and a few hundred
      // UUIDs overflow the request URL — the failure mode is a truncated
      // result set with no error. A season is ~120 events across both tours,
      // so 50 comfortably covers everything that could plausibly be missing a
      // recap, and the homepage only ever shows the newest three.
      const { data: completedRows, error: completedErr } = await supabase
        .from('tournaments')
        .select('id, name')
        .eq('status', 'completed')
        .order('ends_at', { ascending: false, nullsFirst: false })
        .limit(50)
      if (completedErr) throw new Error(completedErr.message)

      const completedIds = (completedRows ?? []).map(t => t.id)
      if (completedIds.length > 0) {
        // Which already have one. Destructured and checked: a failure here
        // returning an empty list would look like "none are built" and send the
        // run off to rebuild every recap in the database.
        const { data: existing, error: existingErr } = await supabase
          .from('tournament_recaps')
          .select('tournament_id')
          .in('tournament_id', completedIds)
        if (existingErr) throw new Error(existingErr.message)

        const have = new Set((existing ?? []).map(r => r.tournament_id))
        const missing = (completedRows ?? []).filter(t => !have.has(t.id)).slice(0, RECAPS_PER_RUN)

        for (const t of missing) {
          // Measured at ~7s each (the runs that built three took ~20s longer
          // than the runs that built none), so this is checked per recap
          // rather than once for the batch — one recap's worth of budget is
          // the granularity that matters.
          if (!hasBudget(9_000)) {
            skippedForTime.push(`recaps(${missing.length - recapsBuilt} remaining)`)
            console.log(`[award-points] recap build stopped: ${msLeft()}ms of budget left`)
            break
          }
          const { ok, error } = await buildAndStoreRecap(t.id, supabase)
          if (ok) {
            recapsBuilt++
            console.log(`[award-points] recap built for ${t.name}`)
          } else {
            // A tournament completed with no results entered has nothing to
            // summarise. Expected, not an error — log and move on, but do not
            // count it, so the next run tries again if results arrive later.
            console.log(`[award-points] recap skipped for ${t.name}: ${error}`)
          }
        }
      }
    } catch (recapErr) {
      // Never fails the run. Points, rankings and achievements are all already
      // written by this point, and a broken recap must not roll back or mask a
      // successful scoring pass.
      console.error('[award-points] recap build error:', recapErr)
      Sentry.captureException(recapErr)
    }

    // ── 15. Tell every participant their tournament is over ───────────────
    //
    // Last, and after the recap, because the recap IS the payload: the podium,
    // the champion and the CTA all come out of it. A completed tournament with
    // no recap yet is skipped rather than mailed with a thin body — step 14
    // caps itself at three per run, so the next run picks it up.
    //
    // Self-healing in the same shape as 12b/12c: driven off "completed, has a
    // recap, bracket not yet stamped", with the stamp written only for the
    // addresses Resend accepted. A failed chunk stays pending instead of
    // vanishing.
    //
    // TWO independent guards against a mass send, because there is no undo on
    // an email:
    //   1. 090's backfill stamped every pre-existing completed bracket, so
    //      history starts out already-mailed.
    //   2. The window below, in case a bracket ever slips past guard 1 — a
    //      re-completed tournament, a migration applied out of order, a row
    //      inserted after the backfill ran. Without it, one such row would
    //      re-mail the entire field of a tournament from April.
    let resultEmailsSent = 0
    if (!silent) {
      try {
        const RESULT_EMAIL_WINDOW_DAYS = 14
        const windowStart = new Date(Date.now() - RESULT_EMAIL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

        // Completed recently, by completion time rather than by the calendar
        // end date — the two disagree by days, because completing is a manual
        // step (Cincinnati 2026 ends_at 08-20, completed_at 08-24).
        const { data: freshlyCompleted, error: freshErr } = await supabase
          .from('tournaments')
          .select('id, name, location, flag_emoji, starts_year, completed_at, tournament_series(slug)')
          .eq('status', 'completed')
          .gte('completed_at', windowStart)
          .order('completed_at', { ascending: false })
          .limit(20)
        if (freshErr) throw new Error(freshErr.message)

        for (const t of freshlyCompleted ?? []) {
          if (!hasBudget(5_000)) {
            skippedForTime.push('result_emails')
            break
          }

          const recap = await getRecap(t.id)
          if (!recap) continue // no recap yet — next run

          const flag = t.flag_emoji ?? null
          const tName = t.location ?? t.name
          const series = Array.isArray(t.tournament_series) ? t.tournament_series[0] : t.tournament_series
          const recapHref = series?.slug && t.starts_year != null
            ? `${BASE_URL}/tournaments/${series.slug}/${t.starts_year}/recap`
            : `${BASE_URL}/tournaments/${t.id}`
          const ctaLabel = series?.slug && t.starts_year != null ? 'Read the recap' : 'See the results'
          const champion = recap.payload.champion_callers?.player
          const podium = recap.payload.podium ?? []

          // Drained in pages rather than one capped batch. The RPC returns at
          // most PAGE rows, and a field larger than that would otherwise need
          // one manual award-points run per page to finish mailing — and this
          // cron has no schedule, so "the next run" is whenever someone
          // remembers. Each pass stamps what it sent, so the next query
          // naturally returns the following page.
          //
          // Bounded by the same time budget as everything else in this run: the
          // loop stops on an exhausted page, on a budget check, or on an error.
          const PAGE = 200
          let drained = 0
          while (hasBudget(5_000)) {
            const { data: pending, error: batchErr } = await supabase
              .rpc('tournament_result_email_batch', { p_tournament_id: t.id, p_limit: PAGE })
            if (batchErr) {
              // Destructured and checked: an error here returning an empty list
              // looks exactly like "everyone has been mailed" and would retire
              // the tournament silently.
              console.error(`[award-points] result email batch failed for ${t.name}:`, batchErr.message)
              break
            }
            if (!pending?.length) break
            // Narrowed once, here, rather than an `any` on every callback below.
            const rows = pending as ResultEmailRow[]

            // Bots are stamped, never mailed. They are excluded here rather than
            // in the SQL so they leave the pending set — at 101 bots in a field
            // of 111, filtering them in SQL would rescan them on every run
            // forever.
            const bots = rows.filter(r => !r.email || isBotEmail(r.email))
            const humans = rows.filter(r => r.email && !isBotEmail(r.email))

            // Opted out: stamped too. Re-offering an email someone declined on
            // every subsequent run is the same waste as the bots.
            const optedOut = humans.filter(r =>
              !isEmailEnabled(r.email_notifications, r.email_preferences, 'tournament_complete'))
            const willSend = humans.filter(r =>
              isEmailEnabled(r.email_notifications, r.email_preferences, 'tournament_complete'))

            const accepted = await sendTournamentCompleteEmails(
              willSend.map(r => ({
                to: r.email!,
                unsubscribeToken: r.unsubscribe_token ?? '',
                username: r.username ?? '',
                tournamentId: t.id,
                tournamentName: tName,
                tournamentFlagEmoji: flag,
                championLabel: champion ? playerLabel(champion) : null,
                points: r.points ?? 0,
                finishRank: r.finish_rank ?? 0,
                fieldSize: r.field_size ?? 0,
                podium,
                ctaHref: recapHref,
                ctaLabel,
              })),
            )

            // Stamp the sends, plus everyone who was never going to get one.
            // Anything Resend rejected is absent from `accepted` and stays
            // pending for the next run.
            const toStamp = [
              ...bots.map(r => r.prediction_id),
              ...optedOut.map(r => r.prediction_id),
              ...willSend.filter(r => accepted.has(r.email!)).map(r => r.prediction_id),
            ]
            if (toStamp.length > 0) {
              const stampedAt = new Date().toISOString()
              for (let i = 0; i < toStamp.length; i += 200) {
                const { error: stampErr } = await supabase
                  .from('predictions')
                  .update({ result_emailed_at: stampedAt })
                  .in('id', toStamp.slice(i, i + 200))
                if (stampErr) {
                  // The send already happened. Failing to stamp means a duplicate
                  // next run, which is bad but recoverable; log loudly.
                  console.error(`[award-points] result email stamp failed for ${t.name}:`, stampErr.message)
                  Sentry.captureException(new Error(`result email stamp failed: ${stampErr.message}`))
                }
              }
            }

            // In-app notification for everyone who was actually mailed — the two
            // go together, the same way draw-open pairs them, so someone who
            // never opens email still finds the recap in the app.
            if (accepted.size > 0) {
              const notifRows = willSend
                .filter(r => accepted.has(r.email!))
                .map(r => ({
                  user_id: r.user_id,
                  type: 'tournament_completed',
                  tournament_id: t.id,
                  meta: {
                    tournament_name: tName,
                    tournament_location: t.location ?? '',
                    tournament_flag_emoji: flag ?? '',
                    finish_rank: r.finish_rank ?? 0,
                    field_size: r.field_size ?? 0,
                    points: r.points ?? 0,
                    ...(series?.slug && t.starts_year != null
                      ? { series_slug: series.slug, starts_year: t.starts_year }
                      : {}),
                  },
                }))
              if (notifRows.length > 0) {
                const { error: notifErr } = await supabase.from('notifications').insert(notifRows)
                if (notifErr) console.error('[award-points] result notification insert failed:', notifErr.message)
              }
            }

            resultEmailsSent += accepted.size
            drained += pending.length
            console.log(`[award-points] result emails for ${t.name}: ${accepted.size} sent, ${bots.length} bots + ${optedOut.length} opted out stamped`)

            // A short page means the pending set is exhausted. Also stop when
            // nothing could be stamped — every row failed to send — because
            // querying again would return the identical page forever.
            if (pending.length < PAGE || toStamp.length === 0) break
          }
          if (drained > 0 && !hasBudget(5_000)) skippedForTime.push(`result_emails(${t.name})`)
        }
      } catch (resultEmailErr) {
        // Never fails the run, for the same reason the recap step does not.
        console.error('[award-points] tournament result email error:', resultEmailErr)
        Sentry.captureException(resultEmailErr)
      }
    }

    // The public hub and edition pages render results, champions and status,
    // all of which this run can change. Bust the tags rather than leaving the
    // pages to the 5-minute ISR window — a finished final should show a
    // champion immediately, not on the next revalidation.
    //
    // Only when something actually changed: revalidating on every idle run
    // would discard warm caches for nothing.
    if (newResultIds.length > 0 || ledgerRows.length > 0) {
      revalidateTag('tournament-detail', 'default')
      revalidateTag('tournament-list', 'default')
    }

    // Separate condition: a recap is usually built on a run that scored nothing
    // new — the tournament finished, the points settled on an earlier pass, and
    // this run only noticed it was missing a recap. Folding it into the check
    // above would leave the homepage's Recent results section unaware of the
    // recap it exists to show.
    if (recapsBuilt > 0) {
      revalidateTag('tournament-recaps', 'default')
      revalidateTag('tournament-detail', 'default')
    }

    return {
      status: 200,
      body: {
        message: 'Points awarded successfully',
        // `results_scanned` is every non-BYE result in the DB (the loop re-walks
        // them all each run); `new_results_processed` is the subset this run saw
        // for the first time — the ones the points email describes.
        results_scanned: allResults.length,
        new_results_processed: newResultIds.length,
        point_entries_created: ledgerRows.length,
        users_awarded: Object.keys(globalUserPointsDelta).length,
        auto_locks_applied: autoLocksApplied,
        result_emails_sent: resultEmailsSent,
        points_by_user: globalUserPointsDelta,
        challenges_scored: challengesScored,
        challenges_expired: challengesExpired,
        anonymous_challenges_scored: anonChallengesScored,
        anonymous_result_emails: anonResultEmails,
        anonymous_bracket_emails: anonBracketEmails,
        achievements_awarded: achievementsAwarded,
        recaps_built: recapsBuilt,
        // Empty on a healthy run. Anything listed here was deferred to the
        // next run to stay inside maxDuration — the run still succeeded, and
        // this is the difference between "finished early on purpose" and the
        // orphaned 'running' row a kill leaves behind.
        skipped_for_time: skippedForTime,
        // How much of the budget was left at the finish line. Not a duplicate
        // of cron_runs.duration_ms (the wrapper's own column) — this is the
        // headroom figure, and it is what says whether SOFT_DEADLINE_MS is
        // still the right number as the tournament back catalogue grows.
        budget_ms_left: msLeft(),
      },
    }
  })
}
