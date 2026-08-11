import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { withCronLogging } from '@/lib/cron-logger'

export const maxDuration = 60

/**
 * Applies the rolling 52-week window to the derived ranking columns.
 *
 * This is the time-driven half of the ranking system. `predictions.expires_at`
 * has always been stamped correctly, but the only thing that ever recalculated
 * a user's `ranking_points` was earning NEW points — so a user who stopped
 * playing kept their total forever and the window was enforced only against
 * people still active.
 *
 * It is deliberately its own cron rather than a step inside award-points:
 *   - award-points is not on a schedule at all (vercel.json carries only
 *     process-deletions); it runs when an admin triggers it
 *   - it early-returns on `!allResults.length` and `!predictions.length` long
 *     before its recalculation step, so a sweep bolted on there would be
 *     skipped exactly when there is nothing to score
 *   - the off-season is the worst case: November tournaments expire in
 *     November, during the ~6-week gap when no results exist to trigger anything
 *
 * "A year has passed" is a fact about the clock, so it needs a clock.
 *
 * Nothing here deletes anything. point_ledger and predictions.points_earned are
 * never touched — only the derived aggregates on users and league_members.
 */

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

// Leaves ~15s of headroom under maxDuration for the final response.
const TIME_BUDGET_MS = 45_000
const BATCH_SIZE = 5000

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const dryRun = params.get('dry') === '1'
  const asOfParam = params.get('as_of')

  // `as_of` exists to answer "what will the board look like after Roland Garros
  // 2026 drops off?" before it happens. Applying a FUTURE as_of for real would
  // expire points early and mark them applied, so it is dry-run only. Without
  // this guard a stray `?as_of=2030-01-01` would retire the entire leaderboard.
  if (asOfParam && !dryRun) {
    return NextResponse.json(
      { error: 'as_of is only permitted with dry=1 — a real run always uses now()' },
      { status: 400 },
    )
  }

  const asOf = asOfParam ? new Date(asOfParam) : new Date()
  if (Number.isNaN(asOf.getTime())) {
    return NextResponse.json({ error: `Invalid as_of: ${asOfParam}` }, { status: 400 })
  }

  return withCronLogging('expire-points', async () => {
    const admin = createAdminClient()

    const startedAt = Date.now()
    let usersUpdated = 0
    let predictionsMarked = 0
    let batches = 0
    let drained = false
    let firstSample: unknown = null

    // Loop so a very large sweep (a Slam's worth of entrants expiring on one
    // day) drains across several batches instead of timing out mid-way and
    // leaving the board half-decayed. expiry_applied_at makes resuming free —
    // whatever this run marks, the next run skips.
    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data, error } = await admin.rpc('apply_point_expiry', {
        p_as_of: asOf.toISOString(),
        p_dry_run: dryRun,
        p_limit: BATCH_SIZE,
      })
      if (error) throw new Error(`apply_point_expiry failed: ${error.message}`)

      // The function RETURNS TABLE, so PostgREST hands back an array of one row.
      const row = (Array.isArray(data) ? data[0] : data) as
        | { users_updated: number; predictions_marked: number; sample: unknown }
        | undefined

      const marked = row?.predictions_marked ?? 0
      batches++
      usersUpdated += row?.users_updated ?? 0
      predictionsMarked += marked
      if (batches === 1) firstSample = row?.sample ?? null

      if (marked === 0) { drained = true; break }

      // A dry run marks nothing, so the next call would return the identical
      // batch forever. One pass is the whole answer.
      if (dryRun) { drained = true; break }
    }

    return {
      status: 200,
      body: {
        message: dryRun ? 'Dry run — nothing written' : 'Expiry applied',
        dry_run: dryRun,
        as_of: asOf.toISOString(),
        users_updated: usersUpdated,
        predictions_marked: predictionsMarked,
        batches,
        // false means the time budget ran out with work still pending; the next
        // scheduled run picks it up. Worth watching in the Cron Runs tab.
        drained,
        sample: firstSample,
      },
    }
  })
}
