import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  ATTRIBUTION_COOKIE_NAME,
  ATTRIBUTION_COOKIE_MAX_AGE,
  deriveAttribution,
  isLandingCandidate,
  serializeAttribution,
} from '@/lib/attribution'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — do not add any logic between createServerClient and getUser
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // ── Referral attribution ────────────────────────────────────────────────
  // When a visitor lands on /invite/<username>, stash a 30-day cookie so the
  // referral survives the signup round-trip. Only set for guests — logged-in
  // users don't need attribution (the landing page redirects them anyway).
  if (!user && pathname.startsWith('/invite/')) {
    const code = pathname.slice('/invite/'.length).split('/')[0]
    if (code && code.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(code)) {
      if (request.cookies.get('qp_ref')?.value !== code) {
        supabaseResponse.cookies.set('qp_ref', code, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 30 * 24 * 60 * 60,
        })
      }
    }
  }

  // ── Acquisition attribution ─────────────────────────────────────────────
  // First-touch only: written once, when a guest has no cookie yet, so the
  // campaign that earned the visit keeps the credit through the whole signup
  // round trip. setUsername() reads it. See lib/attribution.ts for why this
  // cannot be left to the PostHog browser client.
  //
  // Guests only — a logged-in user browsing is not an acquisition — and never
  // on machine endpoints or /auth/*, whose referrer is the OAuth provider.
  //
  // Applied through a helper rather than written straight onto
  // supabaseResponse: the guest redirect below returns a *different* response
  // object, and a cookie set only on supabaseResponse would be silently
  // dropped for exactly the visitor who arrived on a deep link from an ad.
  const attribution =
    !user && !request.cookies.has(ATTRIBUTION_COOKIE_NAME) && isLandingCandidate(pathname)
      ? deriveAttribution(request.nextUrl, request.headers.get('referer'))
      : null

  function withAttribution<T extends NextResponse>(response: T): T {
    if (attribution) {
      response.cookies.set(ATTRIBUTION_COOKIE_NAME, serializeAttribution(attribution), {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: ATTRIBUTION_COOKIE_MAX_AGE,
      })
    }
    return response
  }

  // Protect routes that require authentication — fast middleware redirect
  // Note: /challenges and /leagues root pages handle anonymous visitors themselves
  const protectedRoutes = ['/dashboard', '/profile', '/predict', '/friends', '/notifications', '/admin', '/leagues/browse', '/leagues/new', '/leagues/join', '/challenges/new', '/messages']
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirectTo', pathname)
    return withAttribution(NextResponse.redirect(url))
  }

  // For authenticated users on page routes (not API/assets), redirect to
  // /setup-username if they signed up via OAuth and haven't chosen a username yet.
  // Use a cookie to skip the DB query after the first successful check.
  const isPageRoute =
    user &&
    pathname !== '/setup-username' &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/_next/')

  if (isPageRoute) {
    const usernameSet = request.cookies.get('username_is_set')?.value

    if (usernameSet !== '1') {
      const { data: profile } = await supabase
        .from('users')
        .select('username_is_set')
        .eq('id', user.id)
        .single()

      if (profile && profile.username_is_set === false) {
        const url = request.nextUrl.clone()
        url.pathname = '/setup-username'
        return NextResponse.redirect(url)
      }

      // Username is set — cache in cookie to skip DB hit on future requests
      if (profile?.username_is_set) {
        supabaseResponse.cookies.set('username_is_set', '1', {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 30, // 30 days
        })
      }
    }
  }

  return withAttribution(supabaseResponse)
}
