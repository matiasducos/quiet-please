import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Development-only sign-in for the QA verification account.
 *
 * `scripts/qa-user.mjs login-link` mints a magic link. Its `action_link` form
 * goes through Supabase's own /verify endpoint, which enforces the project's
 * redirect allow-list — and localhost is not on it, so every local target falls
 * back to the production Site URL and the session lands on the wrong origin.
 *
 * `generateLink` also returns a `hashed_token`, and `verifyOtp` redeems that
 * directly from our own server. That path never touches the allow-list, so the
 * QA loop needs no Supabase dashboard configuration to keep working.
 *
 * Gated to development. In production this is a 404 — the app's real auth entry
 * point is /auth/callback, and a second one earning its keep only for local QA
 * has no business being reachable on the live site.
 */

/** Same guard as /auth/callback: only same-origin relative paths. */
function getSafeRedirectPath(next: string | null): string {
  const fallback = '/dashboard'
  if (!next) return fallback
  if (!next.startsWith('/') || next.startsWith('//')) return fallback
  if (/^\/\\/.test(next) || /^[a-z]+:/i.test(next)) return fallback
  return next
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse('Not found', { status: 404 })
  }

  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const next = getSafeRedirectPath(searchParams.get('next'))

  if (!tokenHash) {
    return new NextResponse('Missing token_hash', { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (error) {
    // Single-use and short-lived, so "already used" and "expired" are the
    // everyday failures here — say which, rather than bouncing to /login where
    // the reason would be invisible.
    return new NextResponse(`Sign-in failed: ${error.message}`, { status: 400 })
  }

  return NextResponse.redirect(`${origin}${next}`)
}
