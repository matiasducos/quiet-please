import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { processReferralSignup, REFERRAL_COOKIE_NAME } from '@/lib/referrals'

/** Validate that a redirect target is a safe relative path (prevent open redirect) */
function getSafeRedirectPath(next: string | null): string {
  const fallback = '/dashboard'
  if (!next) return fallback
  // Must start with exactly one slash (not // which browsers treat as protocol-relative)
  if (!next.startsWith('/') || next.startsWith('//')) return fallback
  // Block embedded protocol schemes (e.g. /\evil.com, javascript:, data:)
  if (/^\/\\/.test(next) || /^[a-z]+:/i.test(next)) return fallback
  return next
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  let next = getSafeRedirectPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // ── Referral attribution ──────────────────────────────────────
      // If the cookie was stashed by the /invite/<username> landing
      // page, turn it into a referrals row + auto-friendship. Only
      // succeeds for freshly-created users (10-min window) — existing
      // accounts won't get retroactively credited.
      const cookieStore = await cookies()
      const referralCode = cookieStore.get(REFERRAL_COOKIE_NAME)?.value
      if (referralCode) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const inviterUsername = await processReferralSignup(user.id, referralCode)
          if (inviterUsername) {
            // Land new signups on onboarding with the invited-by banner.
            // If they had a stronger `next` (e.g. deep link into a
            // tournament), keep it — the banner only triggers when
            // next === default /dashboard.
            if (next === '/dashboard') {
              next = `/onboarding?invited_by=${encodeURIComponent(inviterUsername)}`
            }
          }
          // Clear the cookie regardless — one-shot.
          cookieStore.delete(REFERRAL_COOKIE_NAME)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
