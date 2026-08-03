import { notFound, permanentRedirect } from 'next/navigation'
import { resolveTournamentParam } from '@/lib/tournaments/series'

/**
 * Folded into the edition page, same reasoning as ../results.
 *
 * The upcoming-matches list is now a section on /tournaments/<slug>/<year>.
 * On its own it was thin — a schedule with no context — and it changes by the
 * hour, so it was never going to hold a ranking of its own. As a section of
 * the edition page it adds freshness to a URL that already has substance.
 */
export default async function TournamentUpcomingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug: routeParam } = await params
  const resolved = await resolveTournamentParam(routeParam)
  if (!resolved?.slug || resolved.year == null) notFound()
  permanentRedirect(`/tournaments/${resolved.slug}/${resolved.year}#upcoming`)
}
