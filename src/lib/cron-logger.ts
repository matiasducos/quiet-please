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
