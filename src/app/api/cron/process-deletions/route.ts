import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'
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

    for (const userToDelete of usersToDelete) {
      const userId = userToDelete.id
      console.log(`[process-deletions] Processing user ${userId} (${userToDelete.username})`)

      try {
        // ── 1. Snapshot league memberships before cascade deletes them ──
        const { data: memberships } = await admin
          .from('league_members')
          .select('league_id')
          .eq('user_id', userId)

        const affectedLeagueIds = (memberships ?? []).map(m => m.league_id)

        // ── 2. Transfer ownership of leagues they own ──────────────
        const { data: ownedLeagues } = await admin
          .from('leagues')
          .select('id, name')
          .eq('owner_id', userId)

        for (const league of ownedLeagues ?? []) {
          // Find the longest-standing other member
          const { data: nextOwner } = await admin
            .from('league_members')
            .select('user_id')
            .eq('league_id', league.id)
            .neq('user_id', userId)
            .order('joined_at', { ascending: true })
            .limit(1)
            .maybeSingle()

          if (nextOwner) {
            // Transfer ownership
            await admin
              .from('leagues')
              .update({ owner_id: nextOwner.user_id })
              .eq('id', league.id)

            console.log(`[process-deletions] Transferred league "${league.name}" to ${nextOwner.user_id}`)
            transferredLeagues++
          } else {
            // Sole member — deactivate the league (cascade will clean up)
            await admin
              .from('leagues')
              .update({ is_active: false })
              .eq('id', league.id)

            console.log(`[process-deletions] Deactivated league "${league.name}" (sole member)`)
          }
        }

        // ── 3. Nullify winner_id references in challenges ──────────
        // (challenges.winner_id has no ON DELETE CASCADE — would break if user row is deleted)
        await admin
          .from('challenges')
          .update({ winner_id: null })
          .eq('winner_id', userId)

        // ── 4. Delete from Supabase Auth — cascades to public.users → all child rows ──
        const { error: authErr } = await admin.auth.admin.deleteUser(userId)
        if (authErr) {
          console.error(`[process-deletions] Auth deletion failed for ${userId}:`, authErr.message)
          Sentry.captureException(authErr)
          continue // Skip to next user, don't count as deleted
        }

        console.log(`[process-deletions] Deleted user ${userId} (${userToDelete.username})`)
        deletedCount++

        // ── 5. Recalculate league rankings for affected leagues ────
        for (const leagueId of affectedLeagueIds) {
          // Get remaining members
          const { data: remainingMembers } = await admin
            .from('league_members')
            .select('user_id')
            .eq('league_id', leagueId)

          for (const m of remainingMembers ?? []) {
            await admin.rpc('recalculate_member_points', {
              p_league_id: leagueId,
              p_user_id: m.user_id,
            })
          }
        }
      } catch (err) {
        console.error(`[process-deletions] Error processing user ${userId}:`, err)
        Sentry.captureException(err)
        // Continue with next user
      }
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
