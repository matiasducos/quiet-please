import { redirect } from 'next/navigation'

/**
 * The standalone "all picks" list was folded into the tournament leaderboard,
 * which shows the same field plus accuracy, hit rate and streak power, and links
 * to each player's bracket. Kept as a redirect so older links and emails still land.
 */
export default async function AllPicksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/leaderboard/tournaments/${id}`)
}
