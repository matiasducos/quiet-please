import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processReferralSignup, REFERRAL_COOKIE_NAME } from '@/lib/referrals'
import { parseAcceptedVersion } from '@/lib/legal/terms'
import { trackServerEvent } from '@/lib/posthog/server'

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
      // ── Login tracking ────────────────────────────────────────────
      // Fires for every OAuth sign-in, new account or returning. That
      // double-counts against signup_completed on someone's very first
      // Google/Facebook sign-in, which is correct here — it's genuinely
      // both a signup and a login, and downstream queries can exclude
      // day-of-signup logins if a "returning user" cut is ever needed.
      const { data: { user: signedInUser } } = await supabase.auth.getUser()
      if (signedInUser) {
        trackServerEvent(signedInUser.id, 'user_logged_in', {
          method: signedInUser.app_metadata?.provider ?? 'oauth',
        })
      }

      // ── Terms acceptance ──────────────────────────────────────────
      // The ?consent=<version> param is attached by /signup, the only page
      // that shows the checkbox, and rides through both the email
      // confirmation link and the OAuth round trip. Signing in with Google
      // straight from /login carries no param, so those accounts are left
      // NULL rather than credited with an acceptance nobody was asked for.
      const acceptedVersion = parseAcceptedVersion(searchParams.get('consent'))
      if (acceptedVersion) {
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError) {
          console.error('[auth/callback] could not load user to record consent:', userError.message)
        } else if (user) {
          // `.is('terms_accepted_at', null)` makes this a no-op on every later
          // sign-in through the same link, so the original acceptance timestamp
          // is never overwritten. Doing it as one conditional statement rather
          // than read-then-write leaves no window for two tabs to race.
          const { error: consentError } = await createAdminClient()
            .from('users')
            .update({ terms_accepted_at: new Date().toISOString(), terms_version: acceptedVersion })
            .eq('id', user.id)
            .is('terms_accepted_at', null)
          if (consentError) {
            // Never block the sign-in on this — a missing record is recoverable,
            // a user locked out of a confirmed account is not.
            console.error('[auth/callback] failed to record consent:', consentError.message)
          }
        }
      }

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
