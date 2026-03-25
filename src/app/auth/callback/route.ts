import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
  const next = getSafeRedirectPath(searchParams.get('next'))
  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
