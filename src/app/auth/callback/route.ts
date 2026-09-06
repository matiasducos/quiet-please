import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processReferralSignup, REFERRAL_COOKIE_NAME } from '@/lib/referrals'
import { parseAcceptedVersion } from '@/lib/legal/terms'
import { trackServerEvent } from '@/lib/posthog/server'
// Shared with /login, /signup, /setup-username and middleware so one
// definition of "a safe redirect target" governs the whole round trip.
import { getSafeRedirectPath } from '@/lib/auth-redirect'

/**
 * Every way this route can fail, and the `?error=` code /login knows how to
 * explain. Kept as one function so the mapping is readable in one place.
 *
 * `provider_no_email` is the interesting one. Migration 083 raises
 * `no_email_from_provider` from the handle_new_user() trigger when a provider
 * hands back no address — Facebook does this for a phone-registered account, or
 * when the person unticks the email permission. GoTrue wraps any trigger
 * exception as a generic "Database error saving new user", so the trigger's own
 * name never reaches the browser and matching on that wrapper is the best this
 * side can do. Confirm a match in Supabase → Logs → Auth, where 083 deliberately
 * left `no_email_from_provider` greppable.
 */
function classifyProviderError(
  error: string,
  errorCode: string | null,
  description: string | null,
): string {
  const text = `${errorCode ?? ''} ${description ?? ''}`.toLowerCase()
  if (text.includes('database error') || errorCode === 'unexpected_failure') return 'provider_no_email'
  if (error === 'access_denied') return 'oauth_declined'
  return 'auth_callback_failed'
}

/**
 * A failed sign-in is invisible by design — the person is redirected away and
 * the only record is whatever we chose to write down. Both sinks are here on
 * purpose: console.error reaches the Vercel runtime log, which is immediate but
 * retained for about an hour on Hobby, and Sentry keeps it long enough to still
 * be there when someone gets round to looking. Errors are not sampled (only
 * `tracesSampleRate` is), so this arrives whole.
 */
function reportAuthFailure(what: string, detail: Record<string, unknown>) {
  console.error(`[auth/callback] ${what}:`, JSON.stringify(detail))
  Sentry.captureMessage(`auth/callback: ${what}`, {
    level: 'error',
    extra: detail,
  })
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  let next = getSafeRedirectPath(searchParams.get('next'))

  // ── The provider refused ──────────────────────────────────────────
  // A failed OAuth round trip comes back to `redirect_to` with the reason in
  // the query string and no `code` at all. Reading only `code` sent every one
  // of these to the generic branch at the bottom, which discarded the reason
  // before anyone could see it — the single thing that kept the Facebook
  // failure undiagnosed. Capture it first, then answer.
  //
  // One shape does NOT arrive here: with an unusable `state` GoTrue cannot
  // recover `redirect_to`, so it bounces to the site root carrying
  // `?error=invalid_request&error_code=bad_oauth_state`. Nothing on / reads
  // that, so it still looks like a silent bounce to the homepage.
  const providerError = searchParams.get('error')
  if (providerError) {
    const errorCode = searchParams.get('error_code')
    const description = searchParams.get('error_description')
    const failure = classifyProviderError(providerError, errorCode, description)
    reportAuthFailure('the identity provider refused the sign-in', {
      error: providerError,
      error_code: errorCode,
      error_description: description,
      error_reason: searchParams.get('error_reason'),
      next,
      classified_as: failure,
    })
    return NextResponse.redirect(`${origin}/login?error=${failure}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      // Destructured and then dropped before this. A code that will not redeem
      // and a provider that refused are different faults with different fixes,
      // and from /login they looked identical.
      reportAuthFailure('the authorization code would not exchange', {
        message: exchangeError.message,
        status: exchangeError.status,
        code: exchangeError.code,
        next,
      })
    } else {
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
  // The failure copy has to match the flow that failed. A recovery link that
  // does not redeem is the same code path as a broken OAuth round trip, but
  // "check you allowed access to your email address" is nonsense advice for
  // someone who just clicked a reset link — and the real causes (expired, used,
  // opened in another browser) are ones they can act on.
  const failure = next.startsWith('/reset-password') ? 'reset_link_invalid' : 'auth_callback_failed'
  return NextResponse.redirect(`${origin}/login?error=${failure}`)
}
