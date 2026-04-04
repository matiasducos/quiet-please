import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { revalidateTag } from 'next/cache'
import { createAdminClient, listAllUsers } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'
import { sendDrawOpenEmail } from '@/lib/email'
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
            .select('id, email_notifications, unsubscribe_token')
          const prefsMap = new Map((userPrefs ?? []).map((p: any) => [p.id, p]))

          // Send all emails in parallel — avoids O(n) sequential await per user.
          const emailResults = await Promise.allSettled(
            allUsers
              .filter((u: any) => {
                if (!u.email) return false
                const prefs = prefsMap.get(u.id)
                return prefs?.email_notifications !== false
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
