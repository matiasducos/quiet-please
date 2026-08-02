'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { deleteUserAccount } from '@/lib/delete-user'
import { assertAdmin, ADMIN_IDS } from '../auth'

const USERS_PAGE_SIZE = 50

export interface AdminUser {
  id: string
  username: string | null
  email: string
  created_at: string
  ranking_points: number
  username_is_set: boolean
  deletion_requested_at: string | null
}

/** What a delete would destroy. Shown before the confirm, never guessed at. */
export interface UserDeletionImpact {
  username: string | null
  email: string
  rankingPoints: number
  predictions: number
  ledgerRows: number
  achievements: number
  friendships: number
  challenges: number
  memberships: number
  /** Leagues they own, and who each would pass to. */
  ownedLeagues: Array<{ id: string; name: string; otherMembers: number; nextOwner: string | null }>
  /** True when the id is in ADMIN_USER_IDS — the delete is refused. */
  isAdmin: boolean
}

/**
 * Paged user search, reading public.users directly.
 *
 * Deliberately not listAllUsers(): that goes through GoTrue's admin API, which
 * on this project caps out at perPage 25, so at 10k users a single page of this
 * table would cost hundreds of round trips. public.users carries everything the
 * panel shows and Postgres does the filtering.
 */
export async function listUsers(opts: { search?: string; page?: number } = {}): Promise<{
  ok: boolean
  users: AdminUser[]
  total: number
  page: number
  pageSize: number
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const page = Math.max(0, opts.page ?? 0)
  const from = page * USERS_PAGE_SIZE

  let q = admin
    .from('users')
    .select('id, username, email, created_at, ranking_points, username_is_set, deletion_requested_at',
      { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + USERS_PAGE_SIZE - 1)

  // Same escaping as listPlayers: these characters are syntax inside a
  // PostgREST `or` filter, so map them to wildcards rather than let them break
  // the query.
  const term = (opts.search ?? '').trim().replace(/[,()*\\"%]/g, '%')
  if (term) q = q.or(`username.ilike.%${term}%,email.ilike.%${term}%`)

  const { data, error, count } = await q
  if (error) {
    console.error('listUsers error:', error.message)
    return { ok: false, users: [], total: 0, page, pageSize: USERS_PAGE_SIZE }
  }

  return {
    ok: true,
    users: (data ?? []) as AdminUser[],
    total: count ?? 0,
    page,
    pageSize: USERS_PAGE_SIZE,
  }
}

export async function getUserDeletionImpact(userId: string): Promise<UserDeletionImpact | null> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data: user, error } = await admin
    .from('users')
    .select('id, username, email, ranking_points')
    .eq('id', userId)
    .maybeSingle()
  if (error || !user) return null

  // head:true asks Postgres for the count alone — no row payload — so this
  // stays cheap for a heavy user with thousands of ledger rows. All six run
  // concurrently; none depends on another.
  const counted = { count: 'exact' as const, head: true }
  const [predictions, ledgerRows, achievements, friendships, challenges, memberships] =
    await Promise.all([
      admin.from('predictions').select('id', counted).eq('user_id', userId),
      admin.from('point_ledger').select('id', counted).eq('user_id', userId),
      admin.from('user_achievements').select('id', counted).eq('user_id', userId),
      admin.from('friendships').select('id', counted)
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
      admin.from('challenges').select('id', counted)
        .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`),
      admin.from('league_members').select('league_id', counted).eq('user_id', userId),
    ])

  // Owned leagues, plus who each would actually pass to — the panel shows the
  // real successor rather than "someone else", because handing a league to the
  // wrong person is the one part of this that is invisible afterwards.
  const { data: owned, error: ownedErr } = await admin
    .from('leagues').select('id, name').eq('owner_id', userId)
  if (ownedErr) throw new Error(`owned league lookup failed: ${ownedErr.message}`)

  const ownedLeagues = await Promise.all((owned ?? []).map(async league => {
    // Deliberately the same query deleteUserAccount() uses to pick the
    // successor — same table, same neq, same joined_at + user_id ordering — so
    // the name shown here is the one that will actually receive the league.
    // The user_id tiebreak is what makes that promise hold: joined_at ties
    // across a whole league whenever its members were seeded in one insert.
    // Resolving the username with a second lookup rather than a PostgREST
    // embed: the generated types declare a to-one embed as an array while the
    // API returns a bare object, so indexing it compiles and then silently
    // yields undefined.
    const { data: others, error: othersErr } = await admin
      .from('league_members')
      .select('user_id')
      .eq('league_id', league.id)
      .neq('user_id', userId)
      .order('joined_at', { ascending: true })
      .order('user_id', { ascending: true })
    if (othersErr) throw new Error(`league member lookup failed: ${othersErr.message}`)

    const rows = others ?? []
    let nextOwner: string | null = null
    if (rows.length > 0) {
      const { data: successor } = await admin
        .from('users').select('username').eq('id', rows[0].user_id).maybeSingle()
      nextOwner = successor?.username ?? null
    }

    return { id: league.id, name: league.name, otherMembers: rows.length, nextOwner }
  }))

  return {
    username: user.username,
    email: user.email,
    rankingPoints: user.ranking_points ?? 0,
    predictions:  predictions.count ?? 0,
    ledgerRows:   ledgerRows.count ?? 0,
    achievements: achievements.count ?? 0,
    friendships:  friendships.count ?? 0,
    challenges:   challenges.count ?? 0,
    memberships:  memberships.count ?? 0,
    ownedLeagues,
    isAdmin: ADMIN_IDS.has(userId),
  }
}

/**
 * Delete an account immediately, skipping the 7-day grace period that the
 * self-serve flow gives users — an admin clearing out a spam account should not
 * have to wait a week for the nightly sweep.
 *
 * `confirmUsername` must match, mirroring requestAccountDeletion(): the whole
 * point of a typed confirmation is that it survives a misplaced click, and an
 * admin deleting somebody else's account has more to lose by getting the row
 * wrong, not less.
 */
export async function adminDeleteUser(
  userId: string,
  confirmUsername: string,
): Promise<{ ok: boolean; error?: string; transferredLeagues?: number; deactivatedLeagues?: number }> {
  await assertAdmin()

  // Refuse to delete an admin. Losing your own account here would also lose
  // the panel you would use to fix it.
  if (ADMIN_IDS.has(userId)) {
    return { ok: false, error: 'This account is in ADMIN_USER_IDS and cannot be deleted from the panel.' }
  }

  const admin = createAdminClient()
  const { data: user, error } = await admin
    .from('users')
    .select('username')
    .eq('id', userId)
    .maybeSingle()
  if (error) return { ok: false, error: `Lookup failed: ${error.message}` }
  if (!user) return { ok: false, error: 'User not found — they may already be deleted.' }

  if (confirmUsername.trim() !== (user.username ?? '')) {
    return { ok: false, error: 'Username does not match. Type it exactly to confirm.' }
  }

  const res = await deleteUserAccount(userId)
  if (!res.ok) return { ok: false, error: res.error ?? 'Deletion failed' }

  console.log(`[adminDeleteUser] deleted ${userId} (${user.username})`)
  return {
    ok: true,
    transferredLeagues: res.transferredLeagues,
    deactivatedLeagues: res.deactivatedLeagues,
  }
}
