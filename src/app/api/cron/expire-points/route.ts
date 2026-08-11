import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
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
/** PostgREST caps a response at 1000 rows — page rather than trust one query. */
const READ_PAGE = 1000
/** Notification rows per insert, matching announceDrawOpen. */
const NOTIF_CHUNK = 1000

type MarkedRow = {
  user_id: string
  points_earned: number
  tournaments: { name: string | null; location: string | null; flag_emoji: string | null } | null
}

/** How far ahead to warn that next year's edition is missing. */
const CALENDAR_WARN_DAYS = 90
/** Don't re-nag more than once a week while the gap is open. */
const CALENDAR_RENAG_DAYS = 7

type CalendarGap = {
  series_name: string
  tour: string
  edition_year: number
  flat_expiry: string
  affected_predictions: number
}

/**
 * Warns admins that a tournament's points are about to expire on the flat
 * 52-week fallback because next year's edition has not been entered.
 *
 * Edition-based expiry is only as good as the calendar behind it. With no later
 * edition, the derived rule retires the points at starts_at + 364 days — right
 * for an event that genuinely is not held again, wrong for one we simply have
 * not loaded. The database cannot tell those apart, so the only defence is
 * telling a human in time.
 *
 * Lives here rather than in its own cron because the Vercel Hobby plan allows
 * exactly two, and both are already in use (process-deletions, this). It is a
 * natural fit regardless — this job is already the one that reasons about
 * expiry dates.
 *
 * Never throws: a missed reminder must not fail the sweep.
 */
async function remindAdminsOfCalendarGaps(
  admin: ReturnType<typeof createAdminClient>,
  asOf: string,
): Promise<{ reminded: number; gaps: number; error?: string }> {
  try {
    const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (adminIds.length === 0) return { reminded: 0, gaps: 0 }

    const { data, error } = await admin.rpc('calendar_gaps', {
      p_as_of: asOf,
      p_within_days: CALENDAR_WARN_DAYS,
    })
    if (error) return { reminded: 0, gaps: 0, error: error.message }

    const gaps = (data ?? []) as CalendarGap[]
    if (gaps.length === 0) return { reminded: 0, gaps: 0 }

    // Already nagged recently? The gap stays open for weeks by nature — it is
    // closed by a human entering a calendar — so a daily notification would
    // train them to ignore it.
    const since = new Date(Date.parse(asOf) - CALENDAR_RENAG_DAYS * 86_400_000).toISOString()
    const { data: recent } = await admin
      .from('notifications')
      .select('user_id')
      .eq('type', 'admin_calendar_gap')
      .in('user_id', adminIds)
      .gte('created_at', since)
    const alreadyWarned = new Set((recent ?? []).map(r => r.user_id))

    const targets = adminIds.filter(id => !alreadyWarned.has(id))
    if (targets.length === 0) return { reminded: 0, gaps: gaps.length }

    const soonest = gaps[0] // calendar_gaps orders by flat_expiry asc
    const rows = targets.map(userId => ({
      user_id: userId,
      type: 'admin_calendar_gap',
      meta: {
        gap_count: gaps.length,
        soonest_series: soonest.series_name,
        soonest_tour: soonest.tour,
        soonest_year: soonest.edition_year,
        soonest_expiry: soonest.flat_expiry,
        affected_predictions: gaps.reduce((n, g) => n + (g.affected_predictions ?? 0), 0),
      },
    }))

    const { error: insErr } = await admin.from('notifications').insert(rows)
    if (insErr) return { reminded: 0, gaps: gaps.length, error: insErr.message }
    return { reminded: rows.length, gaps: gaps.length }
  } catch (err) {
    return { reminded: 0, gaps: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Tells the affected users their points expired. In-app only — no email.
 *
 * The rows this run touched are identified by `expiry_applied_at = as_of`:
 * apply_point_expiry stamps that column with the exact p_as_of it was given, so
 * the timestamp doubles as a precise run key. That is why this needs no extra
 * plumbing out of the SQL function.
 *
 * ONE notification per user, not per expired tournament — a Slam dropping off
 * touches everyone who entered it, and nobody wants seven rows about the same
 * event.
 *
 * Never throws. By the time this runs the points are already applied and the
 * rows already marked, so a retry would not re-notify anyway; failing the whole
 * cron here would just make the summary lie about work that genuinely happened.
 */
async function notifyExpired(
  admin: ReturnType<typeof createAdminClient>,
  asOf: string,
): Promise<{ notified: number; error?: string }> {
  try {
    const marked: MarkedRow[] = []
    for (let from = 0; ; from += READ_PAGE) {
      const { data, error } = await admin
        .from('predictions')
        .select('user_id, points_earned, tournaments(name, location, flag_emoji)')
        .eq('expiry_applied_at', asOf)
        .range(from, from + READ_PAGE - 1)
      if (error) return { notified: 0, error: error.message }
      if (!data?.length) break
      marked.push(...(data as unknown as MarkedRow[]))
      if (data.length < READ_PAGE) break
    }
    if (marked.length === 0) return { notified: 0 }

    // Group per user: total points lost, and the tournaments they came from.
    const byUser = new Map<string, { points: number; tournaments: MarkedRow['tournaments'][] }>()
    for (const row of marked) {
      const entry = byUser.get(row.user_id) ?? { points: 0, tournaments: [] }
      entry.points += row.points_earned ?? 0
      if (row.tournaments) entry.tournaments.push(row.tournaments)
      byUser.set(row.user_id, entry)
    }

    // What each user has left, for the "you still have N" half of the message.
    const userIds = [...byUser.keys()]
    const remaining = new Map<string, number>()
    for (let i = 0; i < userIds.length; i += READ_PAGE) {
      const { data } = await admin
        .from('users')
        .select('id, ranking_points')
        .in('id', userIds.slice(i, i + READ_PAGE))
      for (const u of data ?? []) remaining.set(u.id, u.ranking_points ?? 0)
    }

    const rows = [...byUser.entries()].map(([userId, entry]) => {
      // Name the tournament when there is exactly one; otherwise just count them.
      // Tournament references always carry the flag emoji.
      const only = entry.tournaments.length === 1 ? entry.tournaments[0] : null
      return {
        user_id: userId,
        type: 'points_expired',
        meta: {
          points_expired: entry.points,
          points_remaining: remaining.get(userId) ?? 0,
          tournament_count: entry.tournaments.length,
          tournament_name: only?.name ?? null,
          tournament_location: only?.location ?? null,
          tournament_flag_emoji: only?.flag_emoji ?? null,
        },
      }
    })

    let notified = 0
    for (let i = 0; i < rows.length; i += NOTIF_CHUNK) {
      const { error } = await admin.from('notifications').insert(rows.slice(i, i + NOTIF_CHUNK))
      if (error) return { notified, error: error.message }
      notified += Math.min(NOTIF_CHUNK, rows.length - i)
    }
    return { notified }
  } catch (err) {
    return { notified: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

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

    // ── 1. Recompute expires_at from the calendar, before sweeping ──────────
    // Edition-based expiry (migration 081) DERIVES the date rather than storing
    // a stamp: points die when the next edition of the same tournament is
    // played, falling back to 52 weeks when there is no next edition. Deriving
    // it daily is what makes a cancelled or rescheduled tournament need no
    // manual signal, and it can move a date LATER — which resurrects points a
    // previous sweep already retired. That has to happen before the sweep, or
    // the sweep would act on yesterday's calendar.
    const { data: refreshData, error: refreshError } = await admin.rpc('refresh_point_expiry', {
      p_as_of: asOf.toISOString(),
      p_dry_run: dryRun,
    })
    // Note for anyone reading a dry-run summary: because the refresh writes
    // nothing in that mode, the sweep numbers below are computed against the
    // expires_at values CURRENTLY stored, not the ones the refresh would have
    // written. The two halves of a dry run therefore describe slightly
    // different states. That is a reporting nuance, not a bug — a real run
    // applies the refresh first, so the sweep always sees fresh dates.
    if (refreshError) throw new Error(`refresh_point_expiry failed: ${refreshError.message}`)
    const refresh = (Array.isArray(refreshData) ? refreshData[0] : refreshData) as
      | { rows_updated: number; resurrected: number; newly_due: number; sample: unknown }
      | undefined

    // ── 2. Sweep whatever is now past its expiry ────────────────────────────
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

    // Notify only for real runs that actually retired something. A dry run
    // marks nothing, so there is nothing to tell anyone about.
    let notified = 0
    let notifyError: string | undefined
    if (!dryRun && predictionsMarked > 0) {
      const res = await notifyExpired(admin, asOf.toISOString())
      notified = res.notified
      notifyError = res.error
      if (res.error) {
        console.error('[expire-points] notification insert failed:', res.error)
        Sentry.captureMessage(`[expire-points] notifications failed: ${res.error}`, 'warning')
      }
    }

    // ── 4. Warn admins about missing next-year editions ─────────────────────
    // Independent of whether anything expired today: the whole point is to warn
    // BEFORE the anniversary arrives.
    let calendarReminded = 0
    let calendarGaps = 0
    let calendarError: string | undefined
    if (!dryRun) {
      const res = await remindAdminsOfCalendarGaps(admin, asOf.toISOString())
      calendarReminded = res.reminded
      calendarGaps = res.gaps
      calendarError = res.error
      if (res.error) {
        console.error('[expire-points] calendar reminder failed:', res.error)
        Sentry.captureMessage(`[expire-points] calendar reminder failed: ${res.error}`, 'warning')
      }
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
        // Calendar-driven changes to expires_at. `resurrected` is points coming
        // BACK because a new edition runs later than the old anniversary —
        // worth watching, since it is the one direction that surprises people.
        expiry_refreshed: refresh?.rows_updated ?? 0,
        resurrected: refresh?.resurrected ?? 0,
        newly_due: refresh?.newly_due ?? 0,
        notified,
        ...(notifyError ? { notify_error: notifyError } : {}),
        // Series whose next edition is missing within the warning window, and
        // how many admins were told. gaps > 0 with reminded = 0 means the weekly
        // re-nag guard is holding, not that nothing is wrong.
        calendar_gaps: calendarGaps,
        calendar_reminded: calendarReminded,
        ...(calendarError ? { calendar_error: calendarError } : {}),
        // false means the time budget ran out with work still pending; the next
        // scheduled run picks it up. Worth watching in the Cron Runs tab.
        drained,
        sample: firstSample,
      },
    }
  })
}
