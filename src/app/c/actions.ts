'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateShareCode } from '@/lib/share-code'
import { rateLimit } from '@/lib/rate-limit'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getClientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
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
  if (!['accepting_predictions', 'in_progress'].includes(tournament.status)) {
    return { ok: false, error: 'This tournament is not open for predictions.' }
  }

  // Validate picks (must have at least 1)
  if (!data.creatorPicks || Object.keys(data.creatorPicks).length === 0) {
    return { ok: false, error: 'You must make at least one pick.' }
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

  const opponentName = data.opponentName.trim().slice(0, 30) || 'Player 2'

  // Update challenge
  const { error } = await admin
    .from('challenges')
    .update({
      opponent_name: opponentName,
      opponent_picks: data.opponentPicks,
      opponent_token: data.opponentToken,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', challenge.id)

  if (error) {
    console.error('[submitOpponentPicks] update error:', error)
    return { ok: false, error: 'Failed to submit picks.' }
  }

  return { ok: true }
}

// ── Fetch anonymous challenge (read-only) ───────────────────────────────────

export async function getAnonymousChallenge(shareCode: string) {
  const admin = createAdminClient()

  const { data: challenge } = await admin
    .from('challenges')
    .select('id, tournament_id, status, is_anonymous, share_code, creator_name, opponent_name, creator_picks, opponent_picks, creator_token, opponent_token, creator_pick_locks, opponent_pick_locks, challenger_points, challenged_points, winner_id, created_at, updated_at')
    .eq('share_code', shareCode)
    .eq('is_anonymous', true)
    .single()

  if (!challenge) return null

  // Fetch tournament + draw + match results in parallel
  const [{ data: tournament }, { data: drawData }, { data: matchResults }] = await Promise.all([
    admin.from('tournaments').select('id, name, status, tour, category, surface, starts_at, ends_at, location, flag_emoji').eq('id', challenge.tournament_id).single(),
    admin.from('draws').select('bracket_data').eq('tournament_id', challenge.tournament_id).single(),
    admin.from('match_results').select('id, external_match_id, round, winner_external_id, loser_external_id, score, played_at').eq('tournament_id', challenge.tournament_id),
  ])

  return {
    challenge,
    tournament,
    draw: drawData?.bracket_data ?? null,
    matchResults: matchResults ?? [],
  }
}
