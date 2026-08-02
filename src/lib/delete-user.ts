import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'

export interface DeleteUserResult {
  ok: boolean
  /** Leagues handed to their longest-standing remaining member. */
  transferredLeagues: number
  /** Leagues the user was the only member of — deactivated, not handed on. */
  deactivatedLeagues: number
  error?: string
}

/**
 * Delete one account and everything it owns.
 *
 * Shared by the nightly process-deletions cron (self-serve deletion, after its
 * 7-day grace period) and the admin panel (immediate). One implementation on
 * purpose: the ordering below is load-bearing and a second copy would drift
 * from it. In particular `challenges.winner_id` is the one user reference in
 * the schema with no ON DELETE clause — it defaults to NO ACTION, so deleting
 * anyone who has ever *won* a challenge raises a foreign key violation unless
 * it is nulled first. Everything else cascades from public.users, which in turn
 * cascades from auth.users.
 *
 * Deleting the auth row rather than the profile row is also deliberate: the
 * on_auth_user_created trigger only fires AFTER INSERT on auth.users, so an
 * account whose profile was deleted but whose auth row survived could sign back
 * in and hold a session pointing at a profile that no longer exists.
 */
export async function deleteUserAccount(userId: string): Promise<DeleteUserResult> {
  const admin = createAdminClient()
  const result: DeleteUserResult = { ok: false, transferredLeagues: 0, deactivatedLeagues: 0 }

  try {
    // ── 1. Snapshot league memberships before the cascade removes them ────────
    // Needed after the delete to rescore the leagues they were in; once the row
    // is gone there is no way to find out which leagues those were.
    const { data: memberships, error: memberErr } = await admin
      .from('league_members')
      .select('league_id')
      .eq('user_id', userId)
    if (memberErr) throw new Error(`membership lookup failed: ${memberErr.message}`)

    const affectedLeagueIds = (memberships ?? []).map(m => m.league_id)

    // ── 2. Hand on the leagues they own ──────────────────────────────────────
    // leagues.owner_id cascades, so without this the league and every other
    // member's row would be deleted along with the owner.
    const { data: ownedLeagues, error: ownedErr } = await admin
      .from('leagues')
      .select('id, name')
      .eq('owner_id', userId)
    if (ownedErr) throw new Error(`owned league lookup failed: ${ownedErr.message}`)

    for (const league of ownedLeagues ?? []) {
      // user_id breaks ties on joined_at. Leagues seeded in one insert give
      // every member the same timestamp, so joined_at alone is not a total
      // order and Postgres may return a different member each time it runs —
      // which would let the admin panel's preview name one successor and this
      // delete pick another.
      const { data: nextOwner } = await admin
        .from('league_members')
        .select('user_id')
        .eq('league_id', league.id)
        .neq('user_id', userId)
        .order('joined_at', { ascending: true })
        .order('user_id', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (nextOwner) {
        await admin.from('leagues').update({ owner_id: nextOwner.user_id }).eq('id', league.id)
        console.log(`[deleteUserAccount] transferred league "${league.name}" to ${nextOwner.user_id}`)
        result.transferredLeagues++
      } else {
        // Sole member: nobody to hand it to, so retire it rather than cascade.
        await admin.from('leagues').update({ is_active: false }).eq('id', league.id)
        console.log(`[deleteUserAccount] deactivated league "${league.name}" (sole member)`)
        result.deactivatedLeagues++
      }
    }

    // ── 3. Null out challenge wins ───────────────────────────────────────────
    // challenges.winner_id references users(id) with no ON DELETE clause, so
    // this is what stops step 4 failing for anyone who has won a challenge.
    const { error: winnerErr } = await admin
      .from('challenges')
      .update({ winner_id: null })
      .eq('winner_id', userId)
    if (winnerErr) throw new Error(`clearing challenge wins failed: ${winnerErr.message}`)

    // ── 4. Delete the auth row — cascades to public.users and every child ────
    const { error: authErr } = await admin.auth.admin.deleteUser(userId)
    if (authErr) throw new Error(`auth deletion failed: ${authErr.message}`)

    // ── 5. Rescore the leagues they were in ──────────────────────────────────
    // Targeted per member rather than the global recalculate_league_points():
    // only these leagues changed, and the global variant is O(all leagues).
    for (const leagueId of affectedLeagueIds) {
      const { data: remaining } = await admin
        .from('league_members')
        .select('user_id')
        .eq('league_id', leagueId)
      for (const m of remaining ?? []) {
        await admin.rpc('recalculate_member_points', { p_league_id: leagueId, p_user_id: m.user_id })
      }
    }

    result.ok = true
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[deleteUserAccount] ${userId}:`, message)
    Sentry.captureException(err)
    return { ...result, ok: false, error: message }
  }
}
