import { notFound } from 'next/navigation'
import { getNavProfile } from '@/lib/supabase/profile'
import Nav from '@/components/Nav'
import { getAnonymousChallenge } from '../actions'
import ChallengeView from './ChallengeView'

export default async function SharedChallengePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { profile } = await getNavProfile().catch(() => ({ user: null, profile: null }))
  const { code } = await params

  const result = await getAnonymousChallenge(code)
  if (!result) notFound()

  const { challenge, tournament, draw, lockedMatches, matchResults } = result
  if (!tournament) notFound()

  // Build match results map for BracketPredictor
  const matchResultsMap: Record<string, string> = {}
  for (const r of matchResults) {
    matchResultsMap[r.external_match_id] = r.winner_external_id
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="challenges" />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <ChallengeView
          challenge={challenge}
          tournament={tournament}
          draw={draw}
          matchResults={matchResultsMap}
          rawMatchResults={matchResults}
          shareCode={code}
          adminLockedMatches={Object.keys(lockedMatches).length > 0 ? lockedMatches : undefined}
        />
      </div>
    </main>
  )
}
