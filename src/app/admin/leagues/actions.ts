'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdmin } from '../auth'

const PAGE_SIZE = 25
const ROSTER_PAGE_SIZE = 100

/**
 * The error codes that mean "this function isn't in the database yet".
 *
 * Migration 089 is applied by hand in the Supabase dashboard, so there is a
 * real window where this code is deployed and the function is not.
 * Distinguishing that from a genuine failure turns a red stack-trace string
 * into a page that says which file to run.
 *
 * Both codes are needed, and PGRST202 is the one that actually fires: PostgREST
 * resolves RPC names against its own schema cache and rejects an unknown one
 * itself, so the request never reaches Postgres and never produces Postgres's
 * own 42883. That is kept as well for the case where the function exists but is
 * called with arguments no overload matches. Confirmed against a database
 * without 089 applied on 2026-08-23 — the observed code was PGRST202.
 */
const MISSING_FUNCTION_CODES = new Set(['PGRST202', '42883'])

export type LeagueVisibility = 'all' | 'public' | 'private'
export type LeagueStatus = 'all' | 'active' | 'inactive'
export type LeagueSort = 'members' | 'newest' | 'name'

/**
 * Rows are typed by hand: `src/types/database.ts` is a placeholder, so every
 * Supabase call returns `any`. Pinning the shape at this boundary keeps the
 * components free of it — same reason as the predictions browser.
 */
export interface AdminLeagueRow {
  id: string
  name: string
  description: string | null
  inviteCode: string
  isPublic: boolean
  isActive: boolean
  createdAt: string
  allowedTournamentTypes: string[] | null
  allowedSurfaces: string[] | null
  seasonStartDate: string | null
  ownerId: string
  ownerUsername: string | null
  memberCount: number
  /** False after an ownership handover (022) left the owner outside the roster. */
  ownerIsMember: boolean
  /** Most recent join — the closest proxy the schema has for "still alive". */
  lastJoinedAt: string | null
  totalPoints: number
}

export interface AdminLeagueMemberRow {
  userId: string
  username: string | null
  email: string | null
  /** Points inside this league — `league_members.total_points`. */
  totalPoints: number
  /** Global ranking points, for contrast with the league figure. */
  rankingPoints: number
  joinedAt: string
  isOwner: boolean
}

/** The raw column names the RPC returns, before they are camel-cased. */
interface RawLeagueRow {
  id: string
  name: string
  description: string | null
  invite_code: string
  is_public: boolean
  is_active: boolean
  created_at: string
  allowed_tournament_types: string[] | null
  allowed_surfaces: string[] | null
  season_start_date: string | null
  owner_id: string
  owner_username: string | null
  member_count: number
  owner_is_member: boolean
  last_joined_at: string | null
  total_points: number
  total_rows: number
}

interface RawMemberRow {
  user_id: string
  username: string | null
  email: string | null
  total_points: number
  ranking_points: number
  joined_at: string
  is_owner: boolean
  total_rows: number
}

export interface ListLeaguesResult {
  ok: boolean
  error?: string
  /** True when the failure is specifically "migration 089 not applied yet". */
  migrationMissing?: boolean
  rows: AdminLeagueRow[]
  /** Exact — the RPC computes it with a window function in the same pass. */
  total: number
  page: number
  pageSize: number
}

/**
 * One page of leagues, across every owner and both visibilities.
 *
 * All the narrowing — visibility, active state, the search — happens inside
 * `admin_league_overview` (089), and so does the member-count aggregate. The
 * browser receives one integer per league rather than the membership rows, so
 * this does not get heavier as leagues fill up. See the migration for why
 * counting client-side was not an option.
 */
export async function listLeagues(opts: {
  search?: string
  visibility?: LeagueVisibility
  status?: LeagueStatus
  sort?: LeagueSort
  page?: number
} = {}): Promise<ListLeaguesResult> {
  await assertAdmin()
  const admin = createAdminClient()

  const page = Math.max(0, opts.page ?? 0)
  const empty = { rows: [], total: 0, page, pageSize: PAGE_SIZE }

  const { data, error } = await admin.rpc('admin_league_overview', {
    p_search: (opts.search ?? '').trim() || null,
    p_visibility: opts.visibility ?? 'all',
    p_status: opts.status ?? 'all',
    p_sort: opts.sort ?? 'members',
    p_limit: PAGE_SIZE,
    p_offset: page * PAGE_SIZE,
  })

  if (error) {
    console.error('[admin-leagues] overview failed:', error.message)
    return {
      ok: false,
      error: error.message,
      migrationMissing: MISSING_FUNCTION_CODES.has(error.code),
      ...empty,
    }
  }

  const raw = (data ?? []) as unknown as RawLeagueRow[]

  return {
    ok: true,
    // Every row carries the same window count; with no rows the set is empty.
    total: Number(raw[0]?.total_rows ?? 0),
    rows: raw.map(l => ({
      id: l.id,
      name: l.name,
      description: l.description,
      inviteCode: l.invite_code,
      isPublic: l.is_public,
      isActive: l.is_active,
      createdAt: l.created_at,
      allowedTournamentTypes: l.allowed_tournament_types,
      allowedSurfaces: l.allowed_surfaces,
      seasonStartDate: l.season_start_date,
      ownerId: l.owner_id,
      ownerUsername: l.owner_username,
      memberCount: Number(l.member_count),
      ownerIsMember: l.owner_is_member,
      lastJoinedAt: l.last_joined_at,
      totalPoints: Number(l.total_points),
    })),
    page,
    pageSize: PAGE_SIZE,
  }
}

/**
 * The roster inside one league, paged.
 *
 * `league_members` is readable only by members under RLS, so this is the one
 * path by which an admin can see who is actually in a private league.
 */
export async function listLeagueMembers(opts: {
  leagueId: string
  page?: number
}): Promise<{
  ok: boolean
  error?: string
  migrationMissing?: boolean
  rows: AdminLeagueMemberRow[]
  total: number
  page: number
  pageSize: number
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const page = Math.max(0, opts.page ?? 0)
  const empty = { rows: [], total: 0, page, pageSize: ROSTER_PAGE_SIZE }

  const { data, error } = await admin.rpc('admin_league_members', {
    p_league_id: opts.leagueId,
    p_limit: ROSTER_PAGE_SIZE,
    p_offset: page * ROSTER_PAGE_SIZE,
  })

  if (error) {
    console.error('[admin-leagues] roster failed:', error.message)
    return {
      ok: false,
      error: error.message,
      migrationMissing: MISSING_FUNCTION_CODES.has(error.code),
      ...empty,
    }
  }

  const raw = (data ?? []) as unknown as RawMemberRow[]

  return {
    ok: true,
    total: Number(raw[0]?.total_rows ?? 0),
    rows: raw.map(m => ({
      userId: m.user_id,
      username: m.username,
      email: m.email,
      totalPoints: Number(m.total_points),
      rankingPoints: Number(m.ranking_points),
      joinedAt: m.joined_at,
      isOwner: m.is_owner,
    })),
    page,
    pageSize: ROSTER_PAGE_SIZE,
  }
}

/**
 * A single league's header row, for the drill-down page.
 *
 * Reuses the overview RPC rather than adding a third function: searching by the
 * league's own invite code matches exactly one row (the column is unique), so
 * this is an indexed single-row lookup, not a scan.
 */
export async function getLeague(leagueId: string): Promise<AdminLeagueRow | null> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('leagues')
    .select('invite_code')
    .eq('id', leagueId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('[admin-leagues] league lookup failed:', error.message)
    return null
  }

  const res = await listLeagues({ search: (data as { invite_code: string }).invite_code })
  return res.rows.find(l => l.id === leagueId) ?? null
}
