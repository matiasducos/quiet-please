'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { recordAdminAction } from '@/lib/admin-audit'
import { committedPicks } from '@/lib/tennis'
import { assertAdmin } from '../auth'

const PAGE_SIZE = 25
const TOURNAMENT_LIMIT = 200

/** Bots are seeded with this email domain (migration 037). */
const BOT_EMAIL_SUFFIX = '@bot.quietplease.app'

/**
 * Rows are typed by hand: `src/types/database.ts` is a `Record<string, any>`
 * placeholder (the project is not linked locally, so `supabase gen types`
 * can't run), so every Supabase call returns `any`. Declaring the shape here
 * keeps the components themselves free of `any`.
 */
export interface AdminPredictionRow {
  predictionId: string
  userId: string
  username: string | null
  email: string
  /** Seeded auto-predict account — 87 of 91 entrants on a real draw are bots. */
  isBot: boolean
  tournamentId: string
  tournamentLabel: string
  /** null for a global bracket, set for a friends-challenge bracket. */
  challengeId: string | null
  pickCount: number
  /** Of those picks, how many the auto-predict cron made rather than the user. */
  autoPickCount: number
  /**
   * Picks made on a match the admin had already locked. Scored as 0 and
   * excluded from streaks (migration 045) — the one "picked after it started"
   * signal the data already carries.
   */
  latePickCount: number
  pointsEarned: number
  isFullyLocked: boolean
  /**
   * Streak commitments the user made themselves — `voluntary`, `round` and
   * `auto_lock_all` locks, counted by the same `committedPicks()` the scorer
   * uses, so the cron's post-match `'auto'` records are excluded.
   *
   * Matters because a bracket can carry round locks with `isFullyLocked`
   * false, and the list called that state "still editable" — which it is not,
   * in the rounds those locks cover. Includes commitments on already-played
   * matches, which an unlock keeps.
   */
  committedLockCount: number
  /** Times the bracket has been reopened, by its owner or by an admin. */
  unlockCount: number
  submittedAt: string
  updatedAt: string
}

export interface AdminPredictionTournament {
  id: string
  name: string
  location: string | null
  flagEmoji: string | null
  tour: string | null
  status: string
  startsAt: string | null
}

export interface AdminPredictionOverview {
  /** Brackets matching the current tournament + scope, before search. */
  total: number
  /**
   * null in the cross-tournament view. The breakdown needs a join, and a
   * joined count can only be estimated there — the planner put the bot share
   * at 1,001 of 1,282 when the true figure was 1,110. A number that wrong is
   * worse than no number in a tool whose whole job is telling an admin what is
   * actually in the database, so it is withheld rather than guessed at.
   */
  bots: number | null
  locked: number | null
  /** True when `total` is the planner's estimate rather than a real count. */
  approximate: boolean
}

export type PredictionScope = 'all' | 'global' | 'challenge'
export type EntrantFilter = 'all' | 'humans' | 'bots'

/**
 * The shapes PostgREST actually returns for the two selects below. Declared by
 * hand for the same reason the public tournament pages do it: the generated
 * `Database` type is a placeholder, so every Supabase call is `any` until it is
 * pinned down at a boundary like this one.
 */
interface RawTournamentRow {
  id: string
  name: string
  location: string | null
  flag_emoji: string | null
  tour: string | null
  status: string
  starts_at: string | null
}

interface RawPredictionRow {
  id: string
  user_id: string
  tournament_id: string
  challenge_id: string | null
  picks: Record<string, string> | null
  pick_sources: Record<string, string> | null
  locked_picks: string[] | null
  points_earned: number | null
  is_fully_locked: boolean | null
  pick_locks: Record<string, string> | null
  unlock_count: number | null
  submitted_at: string
  updated_at: string
  users: { username: string | null; email: string | null } | null
  tournaments: { name: string; location: string | null; flag_emoji: string | null } | null
}

interface ListOptions {
  /** A tournament id, or 'all' for a cross-tournament feed. */
  tournamentId: string
  search?: string
  page?: number
  scope?: PredictionScope
  entrants?: EntrantFilter
  sort?: 'recent' | 'points'
}

/**
 * The tournament picker. Every tournament, newest first — an admin checking for
 * cheating needs finished draws as much as live ones.
 *
 * Capped rather than paged: tournaments are added by hand a few dozen a year,
 * so this list stays in the low hundreds however many users there are.
 */
export async function listPredictionTournaments(): Promise<{
  ok: boolean
  tournaments: AdminPredictionTournament[]
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('tournaments')
    .select('id, name, location, flag_emoji, tour, status, starts_at')
    .order('starts_at', { ascending: false, nullsFirst: false })
    .limit(TOURNAMENT_LIMIT)

  if (error) {
    console.error('[admin-predictions] tournament list failed:', error.message)
    return { ok: false, tournaments: [] }
  }

  return {
    ok: true,
    tournaments: ((data ?? []) as unknown as RawTournamentRow[]).map(t => ({
      id: t.id,
      name: t.name,
      location: t.location,
      flagEmoji: t.flag_emoji,
      tour: t.tour,
      status: t.status,
      startsAt: t.starts_at,
    })),
  }
}

/**
 * One page of brackets.
 *
 * Everything that narrows the set — tournament, challenge scope, bots, the
 * username search — is a filter on the SQL side, and the page is a `range`, so
 * the work is O(page size) rather than O(entrants). `picks` comes back as JSON
 * because Postgres can't count its keys through PostgREST, but it is counted
 * here and never sent to the browser: the client gets three integers per row,
 * not a 128-match bracket.
 */
export async function listTournamentPredictions(opts: ListOptions): Promise<{
  ok: boolean
  error?: string
  rows: AdminPredictionRow[]
  /** Whether a next page exists — established without counting anything. */
  hasMore: boolean
  page: number
  pageSize: number
}> {
  await assertAdmin()
  const admin = createAdminClient()

  const page = Math.max(0, opts.page ?? 0)
  const from = page * PAGE_SIZE
  const scope = opts.scope ?? 'all'
  const entrants = opts.entrants ?? 'all'
  const empty = { rows: [], hasMore: false, page, pageSize: PAGE_SIZE }

  // `users!inner` throughout: the search and the bot filter are conditions on
  // the joined row, and an outer join would keep the rows they exclude.
  let q = admin
    .from('predictions')
    // One unbroken literal — a `+` concatenation widens the select to `string`
    // at the type level and collapses the result to GenericStringError.
    //
    // No `count` here on purpose. In the cross-tournament view there is no
    // `where` to narrow it, so an exact count means scanning every prediction
    // ever made — on every filter change. One extra row is asked for instead,
    // which answers the only question the pager needs.
    .select(
      'id, user_id, tournament_id, challenge_id, picks, pick_sources, locked_picks, points_earned, is_fully_locked, pick_locks, unlock_count, submitted_at, updated_at, users!inner(username, email), tournaments!inner(name, location, flag_emoji)',
    )

  if (opts.tournamentId !== 'all') q = q.eq('tournament_id', opts.tournamentId)
  if (scope === 'global') q = q.is('challenge_id', null)
  if (scope === 'challenge') q = q.not('challenge_id', 'is', null)
  if (entrants === 'humans') q = q.not('users.email', 'like', `%${BOT_EMAIL_SUFFIX}`)
  if (entrants === 'bots') q = q.like('users.email', `%${BOT_EMAIL_SUFFIX}`)

  // Same escaping as listUsers: these characters are syntax inside a PostgREST
  // filter, so map them to wildcards rather than let them break the query.
  const term = (opts.search ?? '').trim().replace(/[,()*\\"%]/g, '%')
  if (term) q = q.ilike('users.username', `%${term}%`)

  if (opts.sort === 'points') q = q.order('points_earned', { ascending: false })
  else q = q.order('updated_at', { ascending: false })
  // Tiebreak. Postgres gives no stable order among equal keys and may pick a
  // different one per query — invisible under LIMIT, but under OFFSET it shows
  // one bracket twice and drops another.
  q = q.order('id', { ascending: true }).range(from, from + PAGE_SIZE)

  const { data, error } = await q
  if (error) {
    console.error('[admin-predictions] page query failed:', error.message)
    return { ok: false, error: error.message, ...empty }
  }

  const fetched = (data ?? []) as unknown as RawPredictionRow[]
  const hasMore = fetched.length > PAGE_SIZE
  const rows: AdminPredictionRow[] = fetched.slice(0, PAGE_SIZE).map(p => {
    const picks = p.picks ?? {}
    const sources = p.pick_sources ?? {}
    // A pick can hold an empty player id — the draw being re-saved over a
    // resolved qualifier zeroes it in place — so count values, not keys.
    const pickedMatchIds = Object.keys(picks).filter(m => Boolean(picks[m]))
    const late: string[] = Array.isArray(p.locked_picks) ? p.locked_picks : []
    const t = p.tournaments
    const email = p.users?.email ?? ''

    return {
      predictionId: p.id,
      userId: p.user_id,
      username: p.users?.username ?? null,
      email,
      isBot: email.endsWith(BOT_EMAIL_SUFFIX),
      tournamentId: p.tournament_id,
      tournamentLabel: t ? [t.flag_emoji, t.location ?? t.name].filter(Boolean).join(' ') : '',
      challengeId: p.challenge_id,
      pickCount: pickedMatchIds.length,
      autoPickCount: pickedMatchIds.filter(m => sources[m] === 'auto').length,
      latePickCount: late.length,
      pointsEarned: p.points_earned ?? 0,
      isFullyLocked: Boolean(p.is_fully_locked),
      // Counted here and not sent on: pick_locks is a 128-key object, and the
      // browser only ever renders the size of it.
      committedLockCount: committedPicks(p.pick_locks).size,
      unlockCount: p.unlock_count ?? 0,
      submittedAt: p.submitted_at,
      updatedAt: p.updated_at,
    }
  })

  return { ok: true, rows, hasMore, page, pageSize: PAGE_SIZE }
}

/**
 * Headline counts for the current tournament + scope, ignoring the search box.
 *
 * `head: true`, so Postgres returns the number and no rows.
 *
 * With a tournament selected, all three are exact — the tournament_id filter
 * keeps them cheap. Across all tournaments there is no `where` to narrow them,
 * so an exact count would scan the whole predictions table on every filter
 * change; only the total is fetched there, estimated, and the breakdown is
 * dropped rather than reported wrong.
 */
export async function getPredictionOverview(opts: {
  tournamentId: string
  scope?: PredictionScope
}): Promise<AdminPredictionOverview> {
  await assertAdmin()
  const admin = createAdminClient()
  const scope = opts.scope ?? 'all'
  const allTournaments = opts.tournamentId === 'all'
  const mode = allTournaments ? ('estimated' as const) : ('exact' as const)

  const base = (withUserJoin: boolean) => {
    let q = admin
      .from('predictions')
      .select(withUserJoin ? 'id, users!inner(email)' : 'id', { count: mode, head: true })
    if (opts.tournamentId !== 'all') q = q.eq('tournament_id', opts.tournamentId)
    if (scope === 'global') q = q.is('challenge_id', null)
    if (scope === 'challenge') q = q.not('challenge_id', 'is', null)
    return q
  }

  if (allTournaments) {
    const { count, error } = await base(false)
    if (error) console.error('[admin-predictions] overview count failed:', error.message)
    return { total: count ?? 0, bots: null, locked: null, approximate: true }
  }

  const [total, bots, locked] = await Promise.all([
    base(false),
    base(true).like('users.email', `%${BOT_EMAIL_SUFFIX}`),
    base(false).eq('is_fully_locked', true),
  ])

  for (const res of [total, bots, locked]) {
    if (res.error) console.error('[admin-predictions] overview count failed:', res.error.message)
  }

  return {
    total: total.count ?? 0,
    bots: bots.count ?? 0,
    locked: locked.count ?? 0,
    approximate: false,
  }
}

// ── Unlocking somebody else's bracket ────────────────────────────────────────

export type AdminUnlockResult =
  | {
      ok: true
      /** Nothing was locked — reported rather than written, so no audit row. */
      noOp: boolean
      wasFullyLocked: boolean
      /** Commitments released. Locks on played matches are kept, not counted. */
      withdrawn: number
      kept: number
    }
  | {
      ok: false
      error: 'not_found' | 'tournament_closed' | 'opponent_locked' | 'unknown'
      message: string
    }

/**
 * Reopen any user's bracket.
 *
 * The self-serve unlocks (094/095) resolve their row with
 * `user_id = auth.uid()`, so neither can be reused here: the admin client has
 * no `auth.uid()` at all, and even a signed-in admin would get `not_found` for
 * a bracket that is not theirs. `admin_unlock_prediction` (096) is the same
 * transition with that clause replaced by a service_role-only grant — which is
 * why it is called through `createAdminClient()` and can only be reached from
 * behind `assertAdmin()`.
 *
 * It does the work of both self-serve unlocks at once: clears the bracket lock
 * and releases pick/round locks on unplayed matches. A bracket with round locks
 * and no bracket lock is a real state, and treating it as "already unlocked"
 * would be a button that reports success and changes nothing.
 */
export async function adminUnlockPrediction(
  predictionId: string,
  opts?: { allowRevealedChallenge?: boolean },
): Promise<AdminUnlockResult> {
  const actor = await assertAdmin()
  const admin = createAdminClient()

  // Read the identity first, for the audit label. Unlike a deletion the row
  // survives, but resolving it afterwards would be a second round trip to
  // learn something already in hand.
  const { data: pred, error: lookupError } = await admin
    .from('predictions')
    .select('id, user_id, tournament_id, challenge_id, users(username, email), tournaments(name, location, status)')
    .eq('id', predictionId)
    .maybeSingle()

  if (lookupError) {
    console.error('[admin-predictions] unlock lookup failed:', lookupError.message)
    return { ok: false, error: 'unknown', message: `Lookup failed: ${lookupError.message}` }
  }
  if (!pred) return { ok: false, error: 'not_found', message: 'Bracket not found — it may have been deleted.' }

  // PostgREST types a to-one embed as an array in some shapes and an object in
  // others; both are read the same way here.
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
  type Owner = { username: string | null; email: string | null }
  type Tournament = { name: string; location: string | null; status: string }
  const owner = one(pred.users as unknown as Owner | Owner[] | null)
  const tournament = one(pred.tournaments as unknown as Tournament | Tournament[] | null)

  const { data, error } = await admin.rpc('admin_unlock_prediction', {
    p_prediction_id: predictionId,
    p_allow_revealed_challenge: opts?.allowRevealedChallenge === true,
  })

  // A Postgres error here is ours, not the admin's — most likely 096 has not
  // been run in this environment yet. Say so, because that is the one cause
  // worth checking first, and log the detail.
  if (error) {
    console.error('[admin-predictions] admin_unlock_prediction rpc failed:', error.message)
    return {
      ok: false,
      error: 'unknown',
      message: `Unlock failed: ${error.message}. If this says the function does not exist, migration 096 has not been applied.`,
    }
  }

  const result = (data ?? {}) as {
    ok?: boolean
    error?: string
    status?: string
    no_op?: boolean
    was_fully_locked?: boolean
    withdrawn?: number
    kept?: number
  }

  if (!result.ok) {
    if (result.error === 'tournament_closed') {
      return {
        ok: false,
        error: 'tournament_closed',
        message: `This tournament is ${(result.status ?? 'closed').replace(/_/g, ' ')} — picks can no longer be saved, so unlocking would give them a bracket they still cannot edit.`,
      }
    }
    if (result.error === 'opponent_locked') {
      return {
        ok: false,
        error: 'opponent_locked',
        message: 'Their challenge opponent has locked, so both brackets are already revealed to each other. Unlocking now lets this user pick with their opponent’s bracket in front of them.',
      }
    }
    if (result.error === 'not_found') {
      return { ok: false, error: 'not_found', message: 'Bracket not found — it may have been deleted.' }
    }
    return { ok: false, error: 'unknown', message: result.error ?? 'Unlock failed' }
  }

  // A no-op changed nothing, so there is nothing to attribute to anyone. Audit
  // rows are for things that happened.
  if (result.no_op) {
    return { ok: true, noOp: true, wasFullyLocked: false, withdrawn: 0, kept: result.kept ?? 0 }
  }

  await recordAdminAction({
    actor,
    action: 'prediction.unlock',
    targetType: 'prediction',
    targetId: predictionId,
    targetLabel: `${owner?.username ?? '(no username)'} <${owner?.email ?? 'unknown'}> — ${tournament?.location ?? tournament?.name ?? pred.tournament_id}`,
    meta: {
      user_id: pred.user_id,
      tournament_id: pred.tournament_id,
      challenge_id: pred.challenge_id,
      tournament_status: tournament?.status,
      was_fully_locked: result.was_fully_locked === true,
      // Streak commitments handed back. Zero means the bracket was locked
      // before anything had been played — the mis-click case.
      commitments_withdrawn: result.withdrawn ?? 0,
      commitments_kept: result.kept ?? 0,
      // Only ever true when an admin deliberately overrode the poker rule.
      forced_over_revealed_challenge: opts?.allowRevealedChallenge === true,
    },
  })

  return {
    ok: true,
    noOp: false,
    wasFullyLocked: result.was_fully_locked === true,
    withdrawn: result.withdrawn ?? 0,
    kept: result.kept ?? 0,
  }
}
