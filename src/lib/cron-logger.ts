import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'

interface CronResult {
  status: number
  body: Record<string, unknown>
}

/**
 * Wraps a cron handler with run logging.
 *
 * - Inserts a `cron_runs` row at start (status = 'running')
 * - On success: updates to 'success' with duration + summary
 * - On error: updates to 'error' with duration + error message, reports to Sentry
 *
 * Usage:
 * ```ts
 * export async function GET(request: Request) {
 *   if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 *   return withCronLogging('award-points', async () => {
 *     // ... your logic ...
 *     return { status: 200, body: { message: 'Done', count: 42 } }
 *   })
 * }
 * ```
 */
export async function withCronLogging(
  jobName: string,
  handler: () => Promise<CronResult>,
): Promise<NextResponse> {
  const startTime = performance.now()
  const supabase = createAdminClient()

  // ── Concurrency guard ──────────────────────────────────────────────
  // Skip this run if the same job is already running (prevents overlap).
  // A 10-minute staleness timeout catches runs that crashed without cleanup.
  const STALE_TIMEOUT_MS = 10 * 60 * 1000
  const staleThreshold = new Date(Date.now() - STALE_TIMEOUT_MS).toISOString()

  // NOTE: the column is started_at, not created_at. This query previously
  // selected created_at and its error was swallowed (no error destructuring),
  // so the guard silently never ran — overlapping runs were never skipped and
  // stale 'running' rows were never marked as errors.
  const { data: alreadyRunning, error: guardError } = await supabase
    .from('cron_runs')
    .select('id, started_at')
    .eq('job_name', jobName)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
  if (guardError) console.error(`[${jobName}] concurrency guard query failed:`, guardError.message)

  if (alreadyRunning && alreadyRunning.length > 0) {
    const staleRun = alreadyRunning[0]
    if (staleRun.started_at > staleThreshold) {
      // A recent run is still active — skip this invocation
      console.log(`[${jobName}] Skipped: another instance is still running (id=${staleRun.id})`)
      return NextResponse.json(
        { message: `Skipped: ${jobName} is already running` },
        { status: 200 },
      )
    }
    // The running row is stale — mark it as failed and proceed
    await supabase
      .from('cron_runs')
      .update({ status: 'error', finished_at: new Date().toISOString(), error: 'Stale: timed out after 10 minutes' })
      .eq('id', staleRun.id)
    console.log(`[${jobName}] Marked stale run ${staleRun.id} as error, proceeding with new run`)
  }

  // Insert initial "running" row
  const { data: run } = await supabase
    .from('cron_runs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single()

  const runId = run?.id

  try {
    const result = await handler()
    const durationMs = Math.round(performance.now() - startTime)

    // Update row to success
    if (runId) {
      await supabase
        .from('cron_runs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          summary: result.body,
        })
        .eq('id', runId)
    }

    return NextResponse.json(result.body, { status: result.status })
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime)
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    console.error(`[${jobName}] Unhandled error:`, err)
    Sentry.captureException(err)

    // Update row to error
    if (runId) {
      await supabase
        .from('cron_runs')
        .update({
          status: 'error',
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          error: errorMessage,
        })
        .eq('id', runId)
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
