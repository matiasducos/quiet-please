import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Nav from '@/components/Nav'
import { getNavProfile } from '@/lib/supabase/profile'
import { getAnonymousPrediction } from '@/app/play/actions'
import AnonymousBracketView from './AnonymousBracketView'

/**
 * A saved signed-out bracket.
 *
 * Three different visitors land here and the page has to tell them apart
 * without a session: the author returning to check their score, the author
 * coming back from signup to claim it, and a bystander who was sent the link.
 * The first two are recognised by the token in their own localStorage matching
 * the digest in this page's payload — see src/lib/challenge-token.ts.
 */

// Public URL, but not one we want indexed: it is one person's bracket, thin
// and duplicated across every visitor who makes one. The title still matters —
// this link gets forwarded, and the tab and preview card should say what it is.
// (Root layout appends "| Quiet Please".)
export const metadata: Metadata = {
  title: 'Bracket',
  robots: { index: false, follow: true },
}

export default async function SavedBracketPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params

  const [{ user, profile }, result] = await Promise.all([
    getNavProfile().catch(() => ({ user: null, profile: null })),
    getAnonymousPrediction(code),
  ])

  if (!result || !result.tournament || !result.draw) notFound()

  const { bracket, tournament, draw, lockedMatches, matchResults } = result

  const matchResultsMap: Record<string, string> = {}
  for (const r of matchResults) matchResultsMap[r.external_match_id] = r.winner_external_id

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav
        deletionRequestedAt={profile?.deletion_requested_at}
        username={profile?.username}
        points={profile?.ranking_points ?? 0}
        activePage="tournaments"
      />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 md:py-10">
        <AnonymousBracketView
          bracket={bracket}
          tournament={tournament}
          draw={draw}
          matchResults={matchResultsMap}
          rawMatchResults={matchResults}
          shareCode={code}
          isSignedIn={Boolean(user)}
          adminLockedMatches={Object.keys(lockedMatches).length > 0 ? lockedMatches : undefined}
        />
      </div>
    </main>
  )
}
