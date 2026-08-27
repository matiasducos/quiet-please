import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Redeems a Supabase OTP `token_hash` server-side.
 *
 * Two callers, one mechanism:
 *
 * `recovery` — an operator-minted password reset. `auth.admin.generateLink`
 * hands back a `hashed_token`, and this route is what turns it into a session.
 * Reachable in production, unlike the QA path below, because the alternative
 * when Auth mail is down — and it was, silently, on the day the reset flow
 * shipped — is telling a locked-out user to wait, or setting a password for
 * them and sending it in plain text. Both are worse than a single-use link.
 *
 * `magiclink` — the local QA loop, development only. `scripts/qa-user.mjs
 * login-link` mints one. Its `action_link` form goes through Supabase's own
 * /verify endpoint, which enforces the project's redirect allow-list — and
 * localhost is not on it, so every local target falls back to the production
 * Site URL and the session lands on the wrong origin. Redeeming the
 * `hashed_token` here never touches the allow-list, so the QA loop needs no
 * Supabase dashboard configuration to keep working.
 *
 * Note this path is NOT PKCE: there is no code verifier to match, so unlike the
 * link /forgot-password mails, one of these works in any browser on any device.
 * That is exactly what a recovery link a human forwards by hand needs.
 *
 * What makes it safe to expose is the token, not the route: single-use,
 * short-lived, and mintable only by the service role. Guessing at one is worth
 * nothing, and redeeming a stolen one is a race against its own expiry.
 */

/** Same guard as /auth/callback: only same-origin relative paths. */
function getSafeRedirectPath(next: string | null): string {
  const fallback = '/dashboard'
  if (!next) return fallback
  if (!next.startsWith('/') || next.startsWith('//')) return fallback
  if (/^\/\\/.test(next) || /^[a-z]+:/i.test(next)) return fallback
  return next
}

/**
 * Which OTP kinds this route will redeem, per environment.
 *
 * An allow-list rather than passing `type` straight through: verifyOtp accepts
 * kinds this app has no business redeeming here — email change, invite, phone —
 * and a route that redeems whatever it is handed is a wider door than the one
 * it was opened for. `magiclink` stays development-only; a permanent
 * passwordless side entrance on the live site is not something the product asks
 * for, and /auth/callback is the real front door.
 */
const ALLOWED_TYPES: readonly string[] = process.env.NODE_ENV === 'development'
  ? ['recovery', 'magiclink']
  : ['recovery']

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  // Defaults to magiclink so the existing QA links, which carry no `type`,
  // keep working unchanged — and in production that default is not allowed,
  // so an untyped link 404s there rather than silently doing something else.
  const type = searchParams.get('type') ?? 'magiclink'
  const next = getSafeRedirectPath(searchParams.get('next'))

  if (!tokenHash) {
    return new NextResponse('Missing token_hash', { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(type)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    type: type as 'recovery' | 'magiclink',
    token_hash: tokenHash,
  })
  if (error) {
    // Single-use and short-lived, so "already used" and "expired" are the
    // everyday failures here — say which, rather than bouncing to /login where
    // the reason would be invisible.
    return new NextResponse(`Sign-in failed: ${error.message}`, { status: 400 })
  }

  return NextResponse.redirect(`${origin}${next}`)
}
