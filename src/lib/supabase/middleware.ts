import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  // Protect routes that require authentication
  const protectedRoutes = ['/dashboard', '/profile', '/leagues', '/predict']
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
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

  return supabaseResponse
}
