import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Permanent redirect for legacy /tournaments/<uuid> URLs.
 *
 * This lives in middleware rather than in the page component, and that is not
 * a stylistic choice. `permanentRedirect()` inside the page produced a 200
 * carrying `<meta http-equiv="refresh">` instead of a 308: the root layout has
 * a <Suspense> boundary, so the response shell flushes — committing the status
 * — before the page's redirect branch runs. Google treats a meta refresh as a
 * weak redirect that does not reliably pass link equity, which would defeat
 * the whole point of redirecting rather than deleting these URLs.
 *
 * Middleware runs before any rendering, so it can still set a real status.
 *
 * Cost: one extra query, paid only by requests whose path actually contains a
 * UUID. Slug URLs fail the regex and pass straight through, so the common case
 * is a string test.
 */

const TOURNAMENT_UUID_PATH =
  /^\/tournaments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/.*)?$/i

/**
 * Child paths that were folded into the edition page, mapped to the anchor
 * they became. Anything else (predict, picks/…) keeps its own path under the
 * slug, since those routes still exist.
 */
const FOLDED_CHILDREN: Record<string, string> = {
  '/results': '#draw',
  '/upcoming': '#upcoming',
}

export async function legacyTournamentRedirect(
  request: NextRequest,
): Promise<NextResponse | null> {
  const match = TOURNAMENT_UUID_PATH.exec(request.nextUrl.pathname)
  if (!match) return null

  const [, id, child] = match

  // Anon key: tournaments and tournament_series are both publicly readable, and
  // middleware has no session to reuse for this.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await supabase
    .from('tournaments')
    .select('starts_year, tournament_series(slug)')
    .eq('id', id)
    .maybeSingle()

  // On a lookup failure, fall through to the page rather than redirecting
  // somewhere wrong or 404ing a URL that may well be valid.
  if (error || !data) return null

  const row = data as {
    starts_year: number | null
    tournament_series?: { slug: string } | { slug: string }[] | null
  }
  const embedded = row.tournament_series
  const slug = Array.isArray(embedded) ? embedded[0]?.slug : embedded?.slug
  if (!slug || row.starts_year == null) return null

  const suffix = child ?? ''
  const folded = FOLDED_CHILDREN[suffix]

  const url = request.nextUrl.clone()
  if (folded !== undefined) {
    url.pathname = `/tournaments/${slug}/${row.starts_year}`
    url.hash = folded
  } else if (suffix) {
    // /predict and /picks/<username> still exist — keep the child path, just
    // swap the UUID for the slug.
    url.pathname = `/tournaments/${slug}${suffix}`
  } else {
    url.pathname = `/tournaments/${slug}/${row.starts_year}`
  }

  // 308 rather than 302: the move is permanent, and unlike 301 it guarantees
  // the method is preserved.
  return NextResponse.redirect(url, 308)
}
