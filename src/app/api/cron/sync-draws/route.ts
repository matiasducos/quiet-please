import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tennisAdapter } from '@/lib/tennis'
import { sendDrawOpenEmail } from '@/lib/email'
import type { Json } from '@/types/database'

// Allow up to 60 s — sequential getDraw() calls across many tournaments need headroom.
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
  try {
    const supabase = createAdminClient()

    // Draws are never published more than ~2 weeks before a tournament starts,
    // so there's no point hitting the tennis API for events further out.
    // Always include accepting_predictions (draw already exists, keep it fresh)
    // and only include upcoming tournaments starting within the next 14 days.
    const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

    const { data: tournaments, error: fetchError } = await supabase
      .from('tournaments')
      .select('id, external_id, name, status, draw_close_at, starts_at, ends_at')
      .or(`status.eq.accepting_predictions,and(status.eq.upcoming,starts_at.lte.${twoWeeksFromNow})`)
      .order('starts_at', { ascending: true })
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
    if (!tournaments || tournaments.length === 0) {
      return NextResponse.json({ message: 'No tournaments to sync', synced: 0 })
    }
    console.log(`[sync-draws] Syncing ${tournaments.length} tournaments (within 14-day window + active)`)
    const results = []
    for (const tournament of tournaments) {
      try {
        const draw = await tennisAdapter.getDraw(tournament.external_id, {
          startsAt: tournament.starts_at ?? undefined,
          endsAt:   tournament.ends_at   ?? undefined,
        })
        if (!draw.matches || draw.matches.length === 0) {
          results.push({ name: tournament.name, status: 'no_draw' })
          continue
        }
        const { error: drawError } = await supabase
          .from('draws')
          .upsert({ tournament_id: tournament.id, bracket_data: draw as unknown as Json, synced_at: new Date().toISOString() }, { onConflict: 'tournament_id' })
        if (drawError) { results.push({ name: tournament.name, status: 'error', error: drawError.message }); continue }

        // Only notify when the draw first opens (status transitions from upcoming)
        if (tournament.status === 'upcoming') {
          await supabase.from('tournaments').update({ status: 'accepting_predictions' }).eq('id', tournament.id)

          // Fan-out: create draw_open notifications for all users + send emails
          try {
            const { data: { users: allUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 })
            if (allUsers.length > 0) {
              const notificationRows = allUsers.map((u: any) => ({
                user_id:       u.id,
                type:          'draw_open',
                tournament_id: tournament.id,
                meta:          { tournament_name: tournament.name },
              }))
              await (supabase as any).from('notifications').insert(notificationRows)
            }
            // Send all emails in parallel — avoids O(n) sequential await per user.
            const emailResults = await Promise.allSettled(
              allUsers
                .filter((u: any) => u.email)
                .map((u: any) => sendDrawOpenEmail({
                  to:             u.email,
                  tournamentName: tournament.name,
                  tournamentId:   tournament.id,
                  closeDate:      tournament.draw_close_at ?? null,
                })),
            )
            const emailFailed = emailResults.filter(r => r.status === 'rejected').length
            console.log(
              `[sync-draws] Notified ${allUsers.length} users for ${tournament.name}` +
              (emailFailed ? ` (${emailFailed} email errors)` : ''),
            )
          } catch (notifyErr) {
            console.error('[sync-draws] notification error:', notifyErr)
          }
        }

        results.push({ name: tournament.name, status: 'synced', matches: draw.matches.length })
      } catch (err) {
        results.push({ name: tournament.name, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      }
    }
    return NextResponse.json({ message: 'Draw sync complete', results })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
