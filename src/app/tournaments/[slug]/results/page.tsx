import { notFound, permanentRedirect } from 'next/navigation'
import { resolveTournamentParam } from '@/lib/tournaments/series'

/**
 * Folded into the edition page.
 *
 * The full read-only bracket used to live here. It is the most substantive
 * thing an edition page can carry — the content that keeps
 * /tournaments/<slug>/<year> off the near-duplicate pile — so it moved there
 * and this route became a redirect.
 *
 * Leaving both would have put two URLs in front of the same query
 * ("<tournament> <year> results") each holding half the content, which for a
 * domain this size loses to a single strong page every time.
 *
 * 308 rather than a temporary redirect: the move is permanent and the target
 * genuinely answers the original request, so ranking signals transfer instead
 * of the redirect being read as a soft 404.
 */
export default async function TournamentResultsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug: routeParam } = await params
  const resolved = await resolveTournamentParam(routeParam)
  if (!resolved?.slug || resolved.year == null) notFound()
  permanentRedirect(`/tournaments/${resolved.slug}/${resolved.year}#draw`)
}
