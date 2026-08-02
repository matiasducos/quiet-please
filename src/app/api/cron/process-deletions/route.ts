import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteUserAccount } from '@/lib/delete-user'
import { withCronLogging } from '@/lib/cron-logger'

export const maxDuration = 60

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronLogging('process-deletions', async () => {
    const admin = createAdminClient()
    let deletedCount = 0
    let transferredLeagues = 0

    // ── Find users whose 7-day grace period has elapsed ─────────
    const { data: usersToDelete, error: queryErr } = await admin
      .from('users')
      .select('id, username')
      .not('deletion_requested_at', 'is', null)
      .lte('deletion_requested_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

    if (queryErr) throw new Error(`Failed to query users for deletion: ${queryErr.message}`)
    if (!usersToDelete?.length) {
      return { status: 200, body: { message: 'No accounts to delete', deleted: 0 } }
    }

    // The per-user work lives in deleteUserAccount() so that the admin panel's
    // immediate delete and this grace-period sweep can't drift apart — the step
    // ordering there (transfer leagues, clear challenge wins, then delete auth)
    // is load-bearing.
    for (const userToDelete of usersToDelete) {
      console.log(`[process-deletions] Processing user ${userToDelete.id} (${userToDelete.username})`)

      const res = await deleteUserAccount(userToDelete.id)
      if (!res.ok) {
        // Already logged and reported to Sentry. Leave deletion_requested_at
        // set so tomorrow's run retries rather than silently dropping them.
        console.error(`[process-deletions] skipped ${userToDelete.id}: ${res.error}`)
        continue
      }

      console.log(`[process-deletions] Deleted user ${userToDelete.id} (${userToDelete.username})`)
      deletedCount++
      transferredLeagues += res.transferredLeagues
    }

    return {
      status: 200,
      body: {
        message: `Processed ${usersToDelete.length} deletion(s)`,
        deleted: deletedCount,
        transferred_leagues: transferredLeagues,
      },
    }
  })
}
