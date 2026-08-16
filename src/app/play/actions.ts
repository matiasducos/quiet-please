'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateShareCode } from '@/lib/share-code'
import { rateLimit } from '@/lib/rate-limit'
import { isBotEmail } from '@/lib/email'
import { getTournamentISOWeeks } from '@/lib/utils/iso-week'
import { computeLockedPicks, isPlayableStatus } from '@/lib/anonymous-predictions'

/**
 * Server half of the signed-out bracket flow.
 *
 * The ordering this file exists to support: a visitor fills in a bracket, it
 * is saved with no account, and only then are they asked for an email and an
 * account. Every write here is therefore reachable with no session, which is
 * why each one is rate limited by IP and authorised by a bearer token rather
 * than by `auth.getUser()`.
 */

async function getClientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

/**
 * Server half of the token digest — see `src/lib/challenge-token.ts`. Not
 * exported: in a `'use server'` module every export is a callable endpoint,
 * and a hashing oracle has no business being one.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** See the identical constant in `src/app/c/actions.ts`. Shape only. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// ── Submit a bracket with no account ────────────────────────────────────────

export async function submitAnonymousPrediction(data: {
  tournamentId: string
  displayName: string
  picks: Record<string, string>
}): Promise<{ ok: true; shareCode: string; token: string } | { ok: false; error: string }> {
  const ip = await getClientIp()
  const rl = rateLimit(`anon-pred:${ip}`, { maxRequests: 5, windowMs: 3_600_000 })
  if (rl.limited) return { ok: false, error: `Too many brackets submitted. Try again in ${rl.retryAfter}s.` }

  if (!data.picks || Object.keys(data.picks).length === 0) {
    return { ok: false, error: 'Make at least one pick first.' }
  }

  const admin = createAdminClient()

  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .select('id, status')
    .eq('id', data.tournamentId)
    .single()

  if (tErr || !tournament) return { ok: false, error: 'Tournament not found.' }
  if (!isPlayableStatus(tournament.status)) {
    return { ok: false, error: 'This tournament is no longer open for predictions.' }
  }

  // Which picks are worth nothing. Both halves are read fresh here rather than
  // trusted from the client: the browser was handed the draw at page load and
  // a match can be decided while someone is still filling the bracket in.
  const [{ data: drawRow }, { data: decided }] = await Promise.all([
    admin.from('draws').select('locked_matches').eq('tournament_id', data.tournamentId).single(),
    admin.from('match_results').select('external_match_id').eq('tournament_id', data.tournamentId),
  ])

  const lockedPicks = computeLockedPicks(
    data.picks,
    (decided ?? []).map(r => r.external_match_id),
    Object.keys((drawRow?.locked_matches as Record<string, string>) ?? {}),
  )

  // Generated rather than left null when the visitor gave no name — which is
  // the normal case here, since this flow deliberately has no name step. The
  // bracket still needs something to be called: the shared view renders
  // "<name>'s picks", and an empty name turns that into a label about nothing.
  // Same fallback shape as createAnonymousChallenge.
  const displayName =
    data.displayName.trim().slice(0, 30) || `Player ${Math.floor(Math.random() * 9000) + 1000}`
  const token = crypto.randomUUID()

  // Retry on collision. 54^8 makes this effectively unreachable, but a unique
  // index that can fail an insert deserves a handler rather than a stack trace
  // on someone's first ever interaction with the product.
  let shareCode = generateShareCode()
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await admin
      .from('anonymous_predictions')
      .select('id')
      .eq('share_code', shareCode)
      .maybeSingle()
    if (!existing) break
    shareCode = generateShareCode()
    if (attempt === 4) return { ok: false, error: 'Could not save your bracket. Please try again.' }
  }

  const { error } = await admin.from('anonymous_predictions').insert({
    tournament_id: data.tournamentId,
    share_code: shareCode,
    token,
    display_name: displayName,
    picks: data.picks,
    locked_picks: lockedPicks,
  })

  if (error) {
    console.error('[submitAnonymousPrediction] insert error:', error)
    return { ok: false, error: 'Could not save your bracket. Please try again.' }
  }

  return { ok: true, shareCode, token }
}

// ── Read a saved bracket ────────────────────────────────────────────────────

export async function getAnonymousPrediction(shareCode: string) {
  const admin = createAdminClient()

  const { data: row, error } = await admin
    .from('anonymous_predictions')
    .select('id, tournament_id, share_code, token, display_name, picks, locked_picks, email, claimed_by, claimed_at, created_at')
    .eq('share_code', shareCode)
    .maybeSingle()

  if (error || !row) return null

  // Strip both secrets before this reaches the browser: /b/<code> is a public
  // URL, and the token authorises claiming the bracket into an account. The
  // digest lets the author's own browser recognise itself without the payload
  // carrying anything a bystander could use. Same reasoning as
  // getAnonymousChallenge — see src/lib/challenge-token.ts.
  const { token, email, ...rest } = row
  const bracket = {
    ...rest,
    token_hash: hashToken(token),
    has_email: Boolean(email),
  }

  const [{ data: tournament }, { data: drawData }, { data: matchResults }] = await Promise.all([
    admin
      .from('tournaments')
      .select('id, name, status, tour, category, surface, starts_at, ends_at, location, flag_emoji')
      .eq('id', row.tournament_id)
      .single(),
    admin.from('draws').select('bracket_data, locked_matches').eq('tournament_id', row.tournament_id).single(),
    admin
      .from('match_results')
      .select('id, external_match_id, round, winner_external_id, loser_external_id, score, played_at')
      .eq('tournament_id', row.tournament_id),
  ])

  return {
    bracket,
    tournament,
    draw: drawData?.bracket_data ?? null,
    lockedMatches: (drawData?.locked_matches as Record<string, string>) ?? {},
    matchResults: matchResults ?? [],
  }
}

// ── Leave an email for the result ───────────────────────────────────────────

export async function saveAnonymousPredictionEmail(data: {
  shareCode: string
  token: string
  email: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = await getClientIp()
  const rl = rateLimit(`anon-pred-email:${ip}`, { maxRequests: 10, windowMs: 3_600_000 })
  if (rl.limited) return { ok: false, error: `Too many attempts. Try again in ${rl.retryAfter}s.` }

  const email = data.email.trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'That does not look like an email address.' }
  }
  if (isBotEmail(email)) return { ok: false, error: 'That address cannot be used.' }

  const admin = createAdminClient()

  const { data: row, error: readErr } = await admin
    .from('anonymous_predictions')
    .select('id, token')
    .eq('share_code', data.shareCode)
    .single()

  if (readErr || !row) return { ok: false, error: 'Bracket not found.' }
  // Without this the share code alone would be enough to sign a stranger up
  // for mail against someone else's bracket.
  if (!data.token || data.token !== row.token) {
    return { ok: false, error: 'Only the person who made this bracket can do that.' }
  }

  const { error } = await admin
    .from('anonymous_predictions')
    .update({ email, email_token: crypto.randomUUID() })
    .eq('id', row.id)

  if (error) {
    console.error('[saveAnonymousPredictionEmail] update error:', error)
    return { ok: false, error: 'Could not save that address.' }
  }

  return { ok: true }
}

// ── Claim a bracket into a real account ─────────────────────────────────────

type ClaimResult =
  | { ok: true; tournamentId: string }
  | { ok: false; error: string; code: 'auth' | 'not_found' | 'forbidden' | 'closed' | 'already_claimed' | 'has_prediction' | 'slot_taken' | 'unknown' }

/**
 * Copy an anonymous bracket onto the signed-in user's account.
 *
 * Runs at /b/<code> rather than in `setUsername()`, which is where the
 * account-creation choke point normally lives. Attribution has to be banked
 * there because a cookie is its only carrier through the auth round trip; this
 * has a better one — the share code rides in the `?next=` path and the token
 * is still in the author's localStorage when they land back on the page. That
 * also makes the claim work for someone who signs up days later, which a
 * one-shot hook on username creation would not.
 *
 * Points are deliberately not computed here. `award-points` scores every
 * (match_result, prediction) pair that is missing from `point_ledger` — it is
 * not restricted to results it has not seen before — so inserting the
 * prediction row is enough for the next run to score the tournament to date,
 * using exactly the same code path as every other bracket.
 */
export async function claimAnonymousPrediction(data: {
  shareCode: string
  token: string
}): Promise<ClaimResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Sign in to save this bracket.', code: 'auth' }

  const rl = rateLimit(`anon-claim:${user.id}`, { maxRequests: 10, windowMs: 3_600_000 })
  if (rl.limited) return { ok: false, error: `Too many attempts. Try again in ${rl.retryAfter}s.`, code: 'unknown' }

  const admin = createAdminClient()

  const { data: row, error: readErr } = await admin
    .from('anonymous_predictions')
    .select('id, tournament_id, token, picks, locked_picks, claimed_by')
    .eq('share_code', data.shareCode)
    .single()

  if (readErr || !row) return { ok: false, error: 'Bracket not found.', code: 'not_found' }
  if (!data.token || data.token !== row.token) {
    return { ok: false, error: 'Only the person who made this bracket can save it.', code: 'forbidden' }
  }
  if (row.claimed_by) {
    return row.claimed_by === user.id
      ? { ok: true, tournamentId: row.tournament_id }
      : { ok: false, error: 'This bracket has already been saved to another account.', code: 'already_claimed' }
  }

  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .select('id, tour, starts_at, ends_at, is_manual, status, name')
    .eq('id', row.tournament_id)
    .single()

  if (tErr || !tournament) return { ok: false, error: 'Tournament not found.', code: 'not_found' }
  if (!isPlayableStatus(tournament.status)) {
    return { ok: false, error: 'This tournament has closed, so the bracket can no longer be saved to an account.', code: 'closed' }
  }

  // An existing global bracket wins. Overwriting it would destroy picks the
  // user made deliberately while signed in, in favour of ones they may have
  // made anonymously months earlier — and the partial unique index on global
  // predictions would reject the insert anyway.
  const { data: existing } = await admin
    .from('predictions')
    .select('id')
    .eq('user_id', user.id)
    .eq('tournament_id', row.tournament_id)
    .is('challenge_id', null)
    .maybeSingle()

  if (existing) {
    return {
      ok: false,
      error: `You already have a bracket for ${tournament.name} on this account.`,
      code: 'has_prediction',
    }
  }

  // Weekly slot enforcement, mirroring savePrediction. A claimed bracket is a
  // global prediction like any other, so skipping this would make /play a way
  // around the one-tournament-per-ISO-week rule.
  const weeks = tournament.is_manual
    ? []
    : getTournamentISOWeeks(tournament.starts_at, tournament.ends_at)

  if (weeks.length > 0) {
    const circuit = tournament.tour as 'ATP' | 'WTA'
    const weekFilters = weeks.map(w => `and(iso_year.eq.${w.year},iso_week.eq.${w.week})`).join(',')
    const { data: conflicts } = await admin
      .from('weekly_slots')
      .select('tournament_id, tournaments(name)')
      .eq('user_id', user.id)
      .eq('circuit', circuit)
      .neq('tournament_id', row.tournament_id)
      .or(weekFilters)
      .limit(1)

    if (conflicts && conflicts.length > 0) {
      const conflictingName = (conflicts[0].tournaments as any)?.name ?? 'another tournament'
      return {
        ok: false,
        error: `Your ${circuit} slot for that week is already taken by ${conflictingName}.`,
        code: 'slot_taken',
      }
    }
  }

  const { data: inserted, error: insertErr } = await admin
    .from('predictions')
    .insert({
      user_id: user.id,
      tournament_id: row.tournament_id,
      challenge_id: null,
      picks: row.picks,
      locked_picks: row.locked_picks ?? [],
      submitted_at: new Date().toISOString(),
    } as any)
    .select('id')
    .single()

  if (insertErr || !inserted) {
    console.error('[claimAnonymousPrediction] prediction insert error:', insertErr)
    return { ok: false, error: 'Could not save the bracket to your account.', code: 'unknown' }
  }

  if (weeks.length > 0) {
    const circuit = tournament.tour as 'ATP' | 'WTA'
    const { error: slotErr } = await admin.from('weekly_slots').upsert(
      weeks.map(w => ({
        user_id: user.id,
        circuit,
        iso_year: w.year,
        iso_week: w.week,
        tournament_id: row.tournament_id,
      })),
      { onConflict: 'user_id,circuit,iso_year,iso_week', ignoreDuplicates: false },
    )
    // The prediction is already in and is the thing the user asked for. A slot
    // row that failed to write leaves the week un-reserved, which is a laxer
    // state than intended rather than a broken one, so this is logged rather
    // than rolled back.
    if (slotErr) console.error('[claimAnonymousPrediction] weekly_slots upsert error:', slotErr)
  }

  const { error: markErr } = await admin
    .from('anonymous_predictions')
    .update({
      claimed_by: user.id,
      claimed_at: new Date().toISOString(),
      prediction_id: inserted.id,
    })
    .eq('id', row.id)

  if (markErr) console.error('[claimAnonymousPrediction] mark claimed error:', markErr)

  revalidatePath('/dashboard')
  revalidatePath(`/tournaments/${row.tournament_id}`)

  return { ok: true, tournamentId: row.tournament_id }
}
