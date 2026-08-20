'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { isBotEmail } from '@/lib/email'

/**
 * Server half of the "tell me when this draw is out" box.
 *
 * The visitor this serves has no session by definition — they arrived on
 * /tournaments/<slug>/<year> from a search result months before the event, and
 * the page has nothing to offer them because the draw does not exist yet. So
 * every guard here is IP-based rather than session-based, exactly like
 * src/app/play/actions.ts.
 */

async function getClientIp(): Promise<string> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

/** See the identical constant in `src/app/play/actions.ts`. Shape only. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function subscribeToDrawReminder(data: {
  tournamentId: string
  email: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = await getClientIp()
  // Tighter than the /play email limit: that one is attached to a bracket the
  // same visitor just built, this one is an unauthenticated write reachable
  // from a public page by anyone.
  const rl = rateLimit(`draw-reminder:${ip}`, { maxRequests: 5, windowMs: 3_600_000 })
  if (rl.limited) return { ok: false, error: `Too many attempts. Try again in ${rl.retryAfter}s.` }

  const email = data.email.trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'That does not look like an email address.' }
  }
  if (isBotEmail(email)) return { ok: false, error: 'That address cannot be used.' }

  const admin = createAdminClient()

  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .select('id, status, draw_announced_at')
    .eq('id', data.tournamentId)
    .maybeSingle()

  if (tErr) {
    console.error('[subscribeToDrawReminder] tournament lookup failed:', tErr.message)
    return { ok: false, error: 'Could not save that address.' }
  }
  if (!tournament) return { ok: false, error: 'Tournament not found.' }

  // Both of these are promises we cannot keep, and taking the address anyway
  // would be collecting data for an email that is never going to be sent.
  // `draw_announced_at` is the honest test rather than the status: it is the
  // exact flag announceDrawOpen() claims, so if it is set the one message this
  // subscription exists for has already gone out.
  if (tournament.status === 'completed') {
    return { ok: false, error: 'This tournament is already over.' }
  }
  if (tournament.draw_announced_at) {
    return { ok: false, error: 'Good news — the draw is already out. Refresh the page.' }
  }

  // Idempotent by design. Someone who forgets they already asked, or
  // double-taps the button, gets a success and one row, not two emails.
  // `ignoreDuplicates` keeps the original `email_token` intact, which matters:
  // an opt-out link already in their inbox has to keep working.
  const { error } = await admin
    .from('draw_reminders')
    .upsert(
      { tournament_id: tournament.id, email, source: 'edition' },
      { onConflict: 'tournament_id,email', ignoreDuplicates: true },
    )

  if (error) {
    console.error('[subscribeToDrawReminder] upsert failed:', error.message)
    return { ok: false, error: 'Could not save that address.' }
  }

  return { ok: true }
}
