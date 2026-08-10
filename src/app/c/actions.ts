'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateShareCode } from '@/lib/share-code'
import { rateLimit } from '@/lib/rate-limit'
import { isManualLockMode } from '@/lib/app-settings'
import { isBotEmail } from '@/lib/email'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getClientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

/**
 * Server half of the challenge-token digest — see `src/lib/challenge-token.ts`
 * for why the page gets a hash rather than the token. Deliberately not
 * exported: in a `'use server'` module every export is a callable endpoint, and
 * this one has no business being reachable from the browser.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ── Create anonymous challenge ──────────────────────────────────────────────

export async function createAnonymousChallenge(data: {
  tournamentId: string
  creatorName: string
  creatorPicks: Record<string, string>
  creatorToken: string
}): Promise<{ ok: true; shareCode: string } | { ok: false; error: string }> {
  // Rate limit: 3 per hour per IP
  const ip = await getClientIp()
  const rl = rateLimit(`anon-create:${ip}`, { maxRequests: 3, windowMs: 3_600_000 })
  if (rl.limited) return { ok: false, error: `Too many challenges created. Try again in ${rl.retryAfter}s.` }

  const admin = createAdminClient()

  // Validate tournament
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, status')
    .eq('id', data.tournamentId)
    .single()

  if (!tournament) return { ok: false, error: 'Tournament not found.' }
  // Challenges always open for accepting_predictions + in_progress regardless of prediction mode toggle
  if (!['accepting_predictions', 'in_progress'].includes(tournament.status)) {
    return { ok: false, error: 'This tournament is not open for predictions.' }
  }

  // Validate picks (must have at least 1)
  if (!data.creatorPicks || Object.keys(data.creatorPicks).length === 0) {
    return { ok: false, error: 'You must make at least one pick.' }
  }

  // Tag picks for admin-locked matches (manual_lock mode) — saved but scored as 0 pts
  let creatorLockedPicks: string[] = []
  if (await isManualLockMode()) {
    const { data: drawRow } = await admin
      .from('draws')
      .select('locked_matches')
      .eq('tournament_id', data.tournamentId)
      .single()
    const adminLocked = (drawRow?.locked_matches as Record<string, string>) ?? {}
    for (const matchId of Object.keys(adminLocked)) {
      if (matchId in data.creatorPicks) creatorLockedPicks.push(matchId)
    }
  }

  // Validate name
  const creatorName = data.creatorName.trim().slice(0, 30) || 'Player 1'

  // Generate share code with retry for uniqueness
  let shareCode = generateShareCode()
  let attempts = 0
  while (attempts < 5) {
    const { data: existing } = await admin
      .from('challenges')
      .select('id')
      .eq('share_code', shareCode)
      .maybeSingle()
    if (!existing) break
    shareCode = generateShareCode()
    attempts++
  }
  if (attempts >= 5) return { ok: false, error: 'Failed to generate unique code. Please try again.' }

  // Insert challenge
  const { error } = await admin.from('challenges').insert({
    tournament_id: data.tournamentId,
    status: 'waiting_opponent',
    is_anonymous: true,
    share_code: shareCode,
    creator_name: creatorName,
    creator_picks: data.creatorPicks,
    creator_locked_picks: creatorLockedPicks,
    creator_token: data.creatorToken,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  if (error) {
    console.error('[createAnonymousChallenge] insert error:', error)
    return { ok: false, error: 'Failed to create challenge.' }
  }

  return { ok: true, shareCode }
}

// ── Submit opponent picks ───────────────────────────────────────────────────

export async function submitOpponentPicks(data: {
  shareCode: string
  opponentName: string
  opponentPicks: Record<string, string>
  opponentToken: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Rate limit: 10 per hour per IP
  const ip = await getClientIp()
  const rl = rateLimit(`anon-opponent:${ip}`, { maxRequests: 10, windowMs: 3_600_000 })
  if (rl.limited) return { ok: false, error: `Too many submissions. Try again in ${rl.retryAfter}s.` }

  const admin = createAdminClient()

  // Fetch challenge
  const { data: challenge } = await admin
    .from('challenges')
    .select('id, tournament_id, status, opponent_picks')
    .eq('share_code', data.shareCode)
    .eq('is_anonymous', true)
    .single()

  if (!challenge) return { ok: false, error: 'Challenge not found.' }
  if (challenge.status !== 'waiting_opponent') return { ok: false, error: 'This challenge already has an opponent.' }
  if (challenge.opponent_picks) return { ok: false, error: 'Picks already submitted.' }

  // Validate tournament still open
  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, status')
    .eq('id', challenge.tournament_id)
    .single()

  if (!tournament || tournament.status === 'completed') {
    return { ok: false, error: 'This tournament is no longer open.' }
  }

  // Validate picks
  if (!data.opponentPicks || Object.keys(data.opponentPicks).length === 0) {
    return { ok: false, error: 'You must make at least one pick.' }
  }

  // Tag picks for admin-locked matches (manual_lock mode) — saved but scored as 0 pts
  let opponentLockedPicks: string[] = []
  if (await isManualLockMode()) {
    const { data: drawRow } = await admin
      .from('draws')
      .select('locked_matches')
      .eq('tournament_id', challenge.tournament_id)
      .single()
    const adminLocked = (drawRow?.locked_matches as Record<string, string>) ?? {}
    for (const matchId of Object.keys(adminLocked)) {
      if (matchId in data.opponentPicks) opponentLockedPicks.push(matchId)
    }
  }

  const opponentName = data.opponentName.trim().slice(0, 30) || 'Player 2'

  // Atomic update: the WHERE status='waiting_opponent' guard ensures only the
  // first concurrent opponent submission wins. If a race happens, the second
  // request matches 0 rows and we detect it below.
  const { data: updated, error } = await admin
    .from('challenges')
    .update({
      opponent_name: opponentName,
      opponent_picks: data.opponentPicks,
      opponent_locked_picks: opponentLockedPicks,
      opponent_token: data.opponentToken,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', challenge.id)
    .eq('status', 'waiting_opponent')
    .select('id')

  if (error) {
    console.error('[submitOpponentPicks] update error:', error)
    return { ok: false, error: 'Failed to submit picks.' }
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'This challenge already has an opponent.' }
  }

  return { ok: true }
}

// ── Save an email for the result ────────────────────────────────────────────

/**
 * Basic shape check only. Deliverability is not knowable here and a strict
 * pattern rejects addresses that are perfectly valid, so this filters obvious
 * typos and nothing more — the send itself is the real test.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Store the address an anonymous player left so we can tell them the result.
 *
 * The caller proves which side of the challenge they are by presenting the
 * token they were given when they submitted their picks — the same token the
 * UI already keeps in localStorage to decide whose bracket to show. Without it
 * anyone holding a share code could write an address into either slot, which
 * would turn a public link into a way to sign strangers up for mail.
 */
export async function saveAnonymousEmail(data: {
  shareCode: string
  token: string
  email: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = await getClientIp()
  const rl = rateLimit(`anon-email:${ip}`, { maxRequests: 10, windowMs: 3_600_000 })
  if (rl.limited) return { ok: false, error: `Too many attempts. Try again in ${rl.retryAfter}s.` }

  const email = data.email.trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'That does not look like an email address.' }
  }
  if (isBotEmail(email)) {
    return { ok: false, error: 'That address cannot be used.' }
  }

  const admin = createAdminClient()

  const { data: challenge, error: readErr } = await admin
    .from('challenges')
    .select('id, creator_token, opponent_token')
    .eq('share_code', data.shareCode)
    .eq('is_anonymous', true)
    .single()

  if (readErr || !challenge) return { ok: false, error: 'Challenge not found.' }

  const side =
    data.token && data.token === challenge.creator_token ? 'creator' :
    data.token && data.token === challenge.opponent_token ? 'opponent' :
    null

  if (!side) return { ok: false, error: 'Only a player in this challenge can do that.' }

  // Minted here rather than defaulted in the schema so a row with no address
  // never carries a live unsubscribe token.
  const { error } = await admin
    .from('challenges')
    .update({
      [`${side}_email`]: email,
      [`${side}_email_token`]: crypto.randomUUID(),
      // Re-entering an address after a send should get the next result, not a
      // duplicate of the one already delivered; the guard stays as it was.
      updated_at: new Date().toISOString(),
    })
    .eq('id', challenge.id)

  if (error) {
    console.error('[saveAnonymousEmail] update error:', error)
    return { ok: false, error: 'Could not save that address.' }
  }

  return { ok: true }
}

// ── Fetch anonymous challenge (read-only) ───────────────────────────────────

export async function getAnonymousChallenge(shareCode: string) {
  const admin = createAdminClient()

  const { data: challenge, error: challengeErr } = await admin
    .from('challenges')
    .select('id, tournament_id, status, is_anonymous, share_code, creator_name, opponent_name, creator_picks, opponent_picks, creator_token, opponent_token, creator_pick_locks, opponent_pick_locks, challenger_points, challenged_points, winner_id, creator_email, opponent_email, created_at, updated_at')
    .eq('share_code', shareCode)
    .eq('is_anonymous', true)
    .single()

  if (challengeErr || !challenge) return null

  // Strip both secrets before this object reaches the browser.
  //
  // The page needs to answer "is the visitor holding this token the creator,
  // the opponent, or a bystander?", and the token lives in their localStorage,
  // so the comparison has to happen client-side. Shipping the raw tokens made
  // that work but put them in the RSC payload of a deliberately public URL —
  // fine while they only decided which bracket to highlight, not fine now that
  // one of them authorises writing an email address. A digest answers the same
  // question without handing anyone the credential.
  //
  // The addresses never leave the server at all: the page only needs to know
  // whether a side has already left one, and returning the address itself
  // would let anyone holding a share code read their opponent's email.
  const { creator_token, opponent_token, creator_email, opponent_email, ...rest } = challenge
  const safeChallenge = {
    ...rest,
    creator_token_hash: creator_token ? hashToken(creator_token) : null,
    opponent_token_hash: opponent_token ? hashToken(opponent_token) : null,
    creator_has_email: Boolean(creator_email),
    opponent_has_email: Boolean(opponent_email),
  }

  // Fetch tournament + draw + match results in parallel
  const [{ data: tournament }, { data: drawData }, { data: matchResults }] = await Promise.all([
    admin.from('tournaments').select('id, name, status, tour, category, surface, starts_at, ends_at, location, flag_emoji').eq('id', challenge.tournament_id).single(),
    admin.from('draws').select('bracket_data, locked_matches').eq('tournament_id', challenge.tournament_id).single(),
    admin.from('match_results').select('id, external_match_id, round, winner_external_id, loser_external_id, score, played_at').eq('tournament_id', challenge.tournament_id),
  ])

  return {
    challenge: safeChallenge,
    tournament,
    draw: drawData?.bracket_data ?? null,
    lockedMatches: (drawData?.locked_matches as Record<string, string>) ?? {},
    matchResults: matchResults ?? [],
  }
}
