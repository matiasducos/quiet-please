import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/unsubscribe?token=<uuid>
 * One-click email unsubscribe — no login required.
 * Sets email_notifications = false for the user matching the token.
 * Redirects to a confirmation page.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
  }

  const supabase = createAdminClient()

  const { data: user, error } = await supabase
    .from('users')
    .update({
      email_notifications: false,
      email_preferences: {
        draw_open: false,
        points_awarded: false,
        friend_request: false,
        friend_accepted: false,
        challenge_received: false,
        auto_predictions: false,
        achievement_earned: false,
      },
    })
    .eq('unsubscribe_token', token)
    .select('id')
    .single()

  if (error || !user) {
    return NextResponse.redirect(new URL('/?unsubscribed=error', req.url))
  }

  return NextResponse.redirect(new URL('/unsubscribed', req.url))
}
