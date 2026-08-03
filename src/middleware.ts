import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { legacyTournamentRedirect } from '@/lib/tournaments/legacy-redirect'

export async function middleware(request: NextRequest) {
  // Before session handling: a legacy /tournaments/<uuid> URL should redirect
  // regardless of who is asking, and doing it here is the only way to emit a
  // real 308 — see legacy-redirect.ts for why the page component cannot.
  const redirect = await legacyTournamentRedirect(request)
  if (redirect) return redirect

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
