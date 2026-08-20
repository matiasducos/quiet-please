import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/unsubscribe/anonymous?token=<uuid>
 *
 * Opt-out for the one email an anonymous challenge player can receive. Separate
 * from `/api/unsubscribe` because that route resolves its token against
 * `users.unsubscribe_token`, and the people this serves have no user row — they
 * left an address on a challenge and nothing else.
 *
 * It erases rather than suppresses. The address was collected for exactly one
 * message, so once someone says "stop" there is no future mail to hold a
 * preference about, and an address kept past its purpose is a liability. That
 * also makes this the erasure route for anyone who wants their data gone
 * without an account to delete.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
  }

  const supabase = createAdminClient()

  // Which side of the challenge the token belongs to is not known up front, so
  // try both. A token only ever matches one column — they are independent
  // random UUIDs — so at most one of these clears anything.
  for (const side of ['creator', 'opponent'] as const) {
    const { data, error } = await supabase
      .from('challenges')
      .update({
        [`${side}_email`]: null,
        [`${side}_email_token`]: null,
        // Left as-is deliberately. If the send already happened, this keeps it
        // from being reconsidered; if it somehow has not, a NULL address is
        // already enough to skip it.
      })
      .eq(`${side}_email_token`, token)
      .select('id')

    if (error) {
      console.error('[unsubscribe/anonymous] update error:', error)
      return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
    }
    if (data && data.length > 0) {
      return NextResponse.redirect(new URL('/unsubscribed?type=anonymous', req.url))
    }
  }

  // Solo brackets from /play carry the same kind of one-shot address, minted
  // in their own table rather than on a challenge. One column here, not two:
  // a bracket has a single author.
  const { data: bracket, error: bracketErr } = await supabase
    .from('anonymous_predictions')
    .update({ email: null, email_token: null })
    .eq('email_token', token)
    .select('id')

  if (bracketErr) {
    console.error('[unsubscribe/anonymous] bracket update error:', bracketErr)
    return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
  }
  if (bracket && bracket.length > 0) {
    return NextResponse.redirect(new URL('/unsubscribed?type=anonymous', req.url))
  }

  // Draw reminders, from the "tell me when this draw is out" box on an
  // upcoming edition page. Deleted outright rather than nulled: unlike the
  // rows above, this one carries nothing but the address and the tournament it
  // was for, so there is no result left behind to keep it attached to.
  const { data: reminder, error: reminderErr } = await supabase
    .from('draw_reminders')
    .delete()
    .eq('email_token', token)
    .select('id')

  if (reminderErr) {
    console.error('[unsubscribe/anonymous] reminder delete error:', reminderErr)
    return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
  }
  if (reminder && reminder.length > 0) {
    return NextResponse.redirect(new URL('/unsubscribed?type=anonymous', req.url))
  }

  // No match. Most likely an already-used opt-out link — the address is gone,
  // which is the outcome the visitor wanted, so say so rather than erroring.
  return NextResponse.redirect(new URL('/unsubscribed?type=anonymous', req.url))
}
