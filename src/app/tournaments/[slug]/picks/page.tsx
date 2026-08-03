import { notFound, redirect } from 'next/navigation'
import { resolveTournamentParam } from '@/lib/tournaments/series'

/**
 * The standalone "all picks" list was folded into the tournament leaderboard,
 * which shows the same field plus accuracy, hit rate and streak power, and links
 * to each player's bracket. Kept as a redirect so older links and emails still land.
 */
export default async function AllPicksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: routeParam } = await params
  const resolved = await resolveTournamentParam(routeParam)
  if (!resolved) notFound()
  redirect(`/leaderboard/tournaments/${resolved.tournamentId}`)
}
