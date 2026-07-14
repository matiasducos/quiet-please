import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { revalidateTag } from 'next/cache'
import { createAdminClient, listAllUsers } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'
import { buildQualifierRemaps, type QualifierRemap, type DrawLike } from '@/lib/tennis/qualifier-remap'
import { sendDrawOpenEmail, isBotEmail } from '@/lib/email'
import { isEmailEnabled } from '@/lib/email-preferences'
import { withCronLogging } from '@/lib/cron-logger'
import type { Json } from '@/types/database'

// Allow up to 60 s — parallel getDraw() calls + DB writes need headroom.
export const maxDuration = 60

function isAuthorized(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false  // Fail closed — never open if secret is missing
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return withCronLogging('sync-draws', async () => {
    const supabase = createAdminClient()

    // Draws are never published more than ~2 weeks before a tournament starts,
    // so there's no point hitting the tennis API for events further out.
    // Three buckets:
    //   1. accepting_predictions — draw already stored, keep it fresh
    //   2. draw_published — qualifying/shell draw synced; keep polling for the main draw
    //   3. upcoming with starts_at within 14 days — draw might just have been published
    //
    // NOTE: We intentionally do NOT include upcoming + starts_at IS NULL without a
    // starts_year filter. The DB contains ~400+ stale rows with no date at all; pulling
    // all of them into the sync window would require 400+ sequential API calls and
    // always time out. If a tournament has a known year but no exact date yet, it will
    // be caught by the starts_year = currentYear clause below once dates are published.
    const currentYear = new Date().getFullYear()
    const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

    const { data: tournaments, error: fetchError } = await supabase
      .from('tournaments')
      .select('id, external_id, name, status, draw_close_at, starts_at, ends_at, location, flag_emoji')
      .or(
        `status.eq.accepting_predictions,` +
        `status.eq.draw_published,` +
        `and(status.eq.upcoming,starts_at.lte.${twoWeeksFromNow}),` +
        // Only null-date tournaments from the current year — avoids stale rows with no year at all.
        `and(status.eq.upcoming,starts_at.is.null,starts_year.eq.${currentYear})`
      )
      .order('starts_at', { ascending: true })
    if (fetchError) throw new Error(fetchError.message)
    if (!tournaments || tournaments.length === 0) {
      return { status: 200, body: { message: 'No tournaments to sync', synced: 0 } }
    }
    console.log(`[sync-draws] Fetching draws for ${tournaments.length} tournaments in parallel`)

    // ── Fan out all tennis API calls in parallel ───────────────────────────
    // Promise.allSettled never throws — a single failed API call doesn't abort
    // the rest of the batch.
    const drawFetches = await Promise.allSettled(
      tournaments.map(t =>
        tennisAdapter.getDraw(t.external_id, {
          startsAt: t.starts_at ?? undefined,
          endsAt:   t.ends_at   ?? undefined,
        })
      )
    )

    // ── Process results (DB writes, status transitions, notifications) ─────
    const results = []
    for (let i = 0; i < tournaments.length; i++) {
      const tournament = tournaments[i]
      const fetchResult = drawFetches[i]

      if (fetchResult.status === 'rejected') {
        results.push({
          name: tournament.name,
          status: 'error',
          error: fetchResult.reason instanceof Error ? fetchResult.reason.message : 'Unknown error',
        })
        continue
      }

      const draw = fetchResult.value
      if (!draw.matches || draw.matches.length === 0) {
        results.push({ name: tournament.name, status: 'no_draw' })
        continue
      }

      // ── Qualifier resolution: remap stale picks BEFORE overwriting the draw ──
      // Once predictions are open, a slot can flip from a "Qualifier" placeholder
      // to a real player. The pick still points at the old placeholder id, so we
      // diff the stored draw against the incoming one and rewrite affected picks
      // (see qualifier-remap.ts). Only tournaments that already accept picks can
      // have any — 'upcoming'/'draw_published' have none, so skip the read.
      let qualifierRemaps: QualifierRemap[] = []
      if (tournament.status === 'accepting_predictions' || tournament.status === 'in_progress') {
        const { data: oldDrawRow, error: oldDrawError } = await supabase
          .from('draws')
          .select('bracket_data')
          .eq('tournament_id', tournament.id)
          .maybeSingle()
        if (oldDrawError) {
          console.error(`[sync-draws] failed to read prior draw for "${tournament.name}":`, oldDrawError.message)
        } else {
          qualifierRemaps = buildQualifierRemaps(
            oldDrawRow?.bracket_data as unknown as DrawLike | null,
            draw as unknown as DrawLike,
          )
        }
      }

      const { error: drawError } = await supabase
        .from('draws')
        .upsert(
          { tournament_id: tournament.id, bracket_data: draw as unknown as Json, synced_at: new Date().toISOString() },
          { onConflict: 'tournament_id' }
        )
      if (drawError) {
        results.push({ name: tournament.name, status: 'error', error: drawError.message })
        continue
      }

      // Apply the remaps now that the resolved draw is committed.
      if (qualifierRemaps.length > 0) {
        try {
          const remapped = await applyQualifierRemaps(supabase, tournament.id, qualifierRemaps)
          console.log(
            `[sync-draws] "${tournament.name}": ${qualifierRemaps.length} qualifier(s) resolved, ` +
            `remapped ${remapped.predictions} prediction(s) + ${remapped.challenges} anonymous challenge(s)`,
          )
        } catch (remapErr) {
          console.error(`[sync-draws] qualifier remap failed for "${tournament.name}":`, remapErr)
          Sentry.captureException(remapErr)
        }
      }

      // Bust the ISR cache for this tournament's detail page so users see
      // the draw immediately rather than waiting up to an hour.
      revalidateTag('tournament-detail', 'default')

      // ── Backfill dates from fixture data if tournament is still "Date TBC" ──
      // get_tournaments sometimes omits tournament_date for future events; but
      // get_fixtures (called inside getDraw) returns event_date per match.
      // Derive starts_at = min(event_date), ends_at = max(event_date) and write
      // them back so the tournament moves out of the "Date TBC" bucket.
      if (!tournament.starts_at && draw.matches.length > 0) {
        const matchDates = draw.matches
          .map(m => m.scheduledAt)
          .filter((d): d is string => typeof d === 'string' && d.length > 0)
          .sort()
        if (matchDates.length > 0) {
          const newStartsAt = matchDates[0]
          const newEndsAt   = matchDates[matchDates.length - 1]
          const newYear     = new Date(newStartsAt).getUTCFullYear()
          await supabase
            .from('tournaments')
            .update({
              starts_at:     newStartsAt,
              ends_at:       newEndsAt,
              starts_year:   newYear,
              draw_close_at: newStartsAt,   // sensible default; adjust manually if needed
            })
            .eq('id', tournament.id)
          console.log(`[sync-draws] Backfilled dates for "${tournament.name}": ${newStartsAt} → ${newEndsAt}`)
          // Reflect the new date in the local object so the status transition below works
          tournament.starts_at = newStartsAt
        }
      }

      // ── Smart status transition based on player data ───────────────────────
      // Qualifying draws have player1/player2 = null for all matches (players TBD).
      // Main draws have named players. Use this to distinguish the two.
      const hasPlayers = draw.matches.some(m => m.player1 !== null || m.player2 !== null)

      if (tournament.status === 'upcoming' && !hasPlayers) {
        // Qualifying / shell bracket synced — move to draw_published but don't notify yet.
        await supabase.from('tournaments').update({ status: 'draw_published' }).eq('id', tournament.id)
        console.log(`[sync-draws] "${tournament.name}" → draw_published (qualifying draw, no players yet)`)

      } else if ((tournament.status === 'upcoming' || tournament.status === 'draw_published') && hasPlayers) {
        // Main draw now has named players — open predictions and notify all users.
        await supabase.from('tournaments').update({ status: 'accepting_predictions' }).eq('id', tournament.id)

        try {
          const allUsers = await listAllUsers(supabase)
          if (allUsers.length > 0) {
            const notificationRows = allUsers.map((u: any) => ({
              user_id:       u.id,
              type:          'draw_open',
              tournament_id: tournament.id,
              meta:          { tournament_name: tournament.name, tournament_location: tournament.location ?? null, tournament_flag_emoji: tournament.flag_emoji ?? null },
            }))
            await (supabase as any).from('notifications').insert(notificationRows)
          }
          // Fetch email preferences to respect unsubscribe
          const { data: userPrefs } = await supabase
            .from('users')
            .select('id, email_notifications, email_preferences, unsubscribe_token')
          const prefsMap = new Map((userPrefs ?? []).map((p: any) => [p.id, p]))

          // Send all emails in parallel — avoids O(n) sequential await per user.
          const emailResults = await Promise.allSettled(
            allUsers
              .filter((u: any) => {
                if (!u.email || isBotEmail(u.email)) return false
                const prefs = prefsMap.get(u.id)
                return isEmailEnabled(prefs?.email_notifications, prefs?.email_preferences, 'draw_open')
              })
              .map((u: any) => sendDrawOpenEmail({
                to:               u.email,
                tournamentName:   tournament.name,
                tournamentId:     tournament.id,
                closeDate:        tournament.draw_close_at ?? null,
                unsubscribeToken: prefsMap.get(u.id)?.unsubscribe_token ?? '',
              })),
          )
          const emailFailed = emailResults.filter(r => r.status === 'rejected').length
          console.log(
            `[sync-draws] Notified ${allUsers.length} users for ${tournament.name}` +
            (emailFailed ? ` (${emailFailed} email errors)` : ''),
          )
        } catch (notifyErr) {
          console.error('[sync-draws] notification error:', notifyErr)
          Sentry.captureException(notifyErr)
        }
      }
      // If already accepting_predictions: no status change, just refresh draw data.

      results.push({ name: tournament.name, status: 'synced', matches: draw.matches.length })
    }
    return { status: 200, body: { message: 'Draw sync complete', results } }
  })
}

/**
 * Rewrite stale qualifier picks to the resolved player id for one tournament.
 *
 * Covers both pick-storage models:
 *   • `predictions.picks`  — global predictions AND friends challenges
 *   • `challenges.creator_picks` / `opponent_picks` — anonymous challenges
 *
 * Scalability: `.contains()` pushes the filter to Postgres so we only fetch the
 * rows that actually reference a resolved qualifier — not every prediction in
 * the tournament. This whole path only runs the one sync where a qualifier
 * flips to a real player (afterwards the stored draw already holds the real
 * player, so no remap is produced).
 */
async function applyQualifierRemaps(
  supabase: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  remaps: QualifierRemap[],
): Promise<{ predictions: number; challenges: number }> {
  // ── predictions (global + friends) ──────────────────────────────────────
  // id → the picks object being mutated (so a prediction touching two resolved
  // qualifiers is fetched once and updated once).
  const predPicks = new Map<string, Record<string, string>>()
  for (const r of remaps) {
    const { data, error } = await supabase
      .from('predictions')
      .select('id, picks')
      .eq('tournament_id', tournamentId)
      .contains('picks', { [r.matchId]: r.oldId })
    if (error) throw new Error(`predictions read: ${error.message}`)
    for (const row of data ?? []) {
      const picks = predPicks.get(row.id) ?? { ...(row.picks as Record<string, string>) }
      picks[r.matchId] = r.newId
      predPicks.set(row.id, picks)
    }
  }
  const predResults = await Promise.allSettled(
    [...predPicks].map(([id, picks]) => supabase.from('predictions').update({ picks }).eq('id', id)),
  )

  // ── anonymous challenges ────────────────────────────────────────────────
  // id → column patch (creator/opponent picks are independent jsonb columns).
  const challPatches = new Map<string, { creator_picks?: Record<string, string>; opponent_picks?: Record<string, string> }>()
  const collectChallenge = (col: 'creator_picks' | 'opponent_picks', id: string, current: Record<string, string> | null, r: QualifierRemap) => {
    const patch = challPatches.get(id) ?? {}
    const picks = patch[col] ?? { ...(current ?? {}) }
    picks[r.matchId] = r.newId
    patch[col] = picks
    challPatches.set(id, patch)
  }
  for (const r of remaps) {
    const [creatorRes, opponentRes] = await Promise.all([
      supabase.from('challenges').select('id, creator_picks').eq('tournament_id', tournamentId).contains('creator_picks', { [r.matchId]: r.oldId }),
      supabase.from('challenges').select('id, opponent_picks').eq('tournament_id', tournamentId).contains('opponent_picks', { [r.matchId]: r.oldId }),
    ])
    if (creatorRes.error) throw new Error(`challenges read (creator_picks): ${creatorRes.error.message}`)
    if (opponentRes.error) throw new Error(`challenges read (opponent_picks): ${opponentRes.error.message}`)
    for (const row of creatorRes.data ?? []) collectChallenge('creator_picks', row.id, row.creator_picks as Record<string, string> | null, r)
    for (const row of opponentRes.data ?? []) collectChallenge('opponent_picks', row.id, row.opponent_picks as Record<string, string> | null, r)
  }
  const challResults = await Promise.allSettled(
    [...challPatches].map(([id, patch]) => supabase.from('challenges').update(patch).eq('id', id)),
  )

  const failed = [...predResults, ...challResults].filter(r => r.status === 'rejected').length
  if (failed > 0) console.error(`[sync-draws] ${failed} qualifier-remap update(s) failed for tournament ${tournamentId}`)

  return { predictions: predPicks.size, challenges: challPatches.size }
}
