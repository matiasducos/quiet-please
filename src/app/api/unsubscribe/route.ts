import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  EMAIL_PREF_KEYS,
  type EmailPrefKey,
  type EmailPreferences,
  resolvePreferences,
} from '@/lib/email-preferences'

/**
 * GET /api/unsubscribe?token=<uuid>[&type=<pref key>]
 * One-click email unsubscribe — no login required.
 *
 * Without `type` this is the all-or-nothing opt-out: master toggle off and
 * every preference false.
 *
 * With `type` (e.g. `draw_open`) only that one preference is turned off, so a
 * user can stop draw announcements — the only email that goes to everybody —
 * without losing the ones they asked for by taking an action, like a friend
 * request or their points summary.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const rawType = req.nextUrl.searchParams.get('type')

  if (!token) {
    return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
  }

  // Only accept a known preference key — an unrecognised `type` must not fall
  // back to unsubscribing from everything, which would be a far bigger action
  // than the link promised.
  if (rawType && !EMAIL_PREF_KEYS.includes(rawType as EmailPrefKey)) {
    return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
  }
  const type = rawType as EmailPrefKey | null

  const supabase = createAdminClient()

  let update: { email_notifications?: boolean; email_preferences: EmailPreferences }

  if (type) {
    // Read-modify-write: preserve every other preference. Without the read we'd
    // reset the untouched keys to their defaults and silently re-subscribe
    // someone to mail they had already turned off.
    const { data: current, error: readErr } = await supabase
      .from('users')
      .select('email_preferences')
      .eq('unsubscribe_token', token)
      .single()

    if (readErr || !current) {
      return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
    }

    update = {
      email_preferences: {
        ...resolvePreferences(current.email_preferences as Partial<EmailPreferences> | null),
        [type]: false,
      },
    }
    // Master toggle deliberately untouched — this opts out of one kind of mail.
  } else {
    // Derived from EMAIL_PREF_KEYS rather than a hand-written literal: a
    // hardcoded list drifts the moment a new email type is added, leaving that
    // type still enabled after someone unsubscribed from "all".
    update = {
      email_notifications: false,
      email_preferences: Object.fromEntries(
        EMAIL_PREF_KEYS.map(k => [k, false]),
      ) as EmailPreferences,
    }
  }

  const { data: user, error } = await supabase
    .from('users')
    .update(update)
    .eq('unsubscribe_token', token)
    .select('id')
    .single()

  if (error || !user) {
    return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
  }

  const dest = type ? `/unsubscribed?type=${type}` : '/unsubscribed'
  return NextResponse.redirect(new URL(dest, req.url))
}
