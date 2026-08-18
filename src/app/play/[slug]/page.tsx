import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import { getNavProfile } from '@/lib/supabase/profile'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePlayableTournament } from '@/lib/anonymous-predictions'
import { resolveTournamentParam } from '@/lib/tournaments/series'
import SoloPlayFlow from './SoloPlayFlow'

/**
 * The campaign landing: fill in a bracket, then get asked for an account.
 *
 * This exists because the funnel it replaces asked in the opposite order.
 * A social post sent people to the homepage, they navigated to a tournament,
 * clicked Predict, and were bounced to /signup having invested nothing — the
 * predict page's own source comments call that click "the single most likely
 * moment for someone without an account to hit a wall".
 *
 * Here the bracket is the first thing they touch and the account is how they
 * keep it.
 */

/**
 * Not indexed, on purpose. This is a social entry point for one tournament,
 * and letting it into the index would put it in competition with the evergreen
 * /tournaments/<slug> hub and the dated edition page — the two URLs the SEO
 * work actually wants ranking. `follow` still passes link equity on to them.
 *
 * The title and OG tags still matter and are still resolved per tournament:
 * noindex stops crawlers, not the preview card that WhatsApp, Twitter and
 * Messages render when somebody forwards the link. That card IS the campaign
 * for every share after the original post.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const resolution = await resolvePlayableTournament(slug)

  const robots = { index: false, follow: true }

  // No brand suffix here — the root layout's title template appends
  // "| Quiet Please" to whatever this returns.
  if (resolution.kind === 'nothing-open') {
    return { title: 'Predict the draw', robots }
  }

  const t = resolution.tournament
  const where = t.location ?? t.name
  const title = `Predict ${where} — no account needed`
  const description = `Fill in your ${where} bracket in a couple of minutes. No signup, no email — it scores itself as the results come in.`

  return {
    title,
    description,
    robots,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ round?: string }>
}) {
  const { slug } = await params
  const { round: initialRound } = await searchParams

  // Someone already signed in has no use for the anonymous path — send them
  // to the real thing, which knows about their existing picks, their slot and
  // their points. The `/play` link is shared publicly and will be clicked by
  // existing users constantly.
  const { user, profile } = await getNavProfile().catch(() => ({ user: null, profile: null }))
  if (user) {
    // The predict route accepts the same param shapes this one does (series
    // slug or legacy UUID), so it can be handed straight through.
    const resolved = await resolveTournamentParam(slug)
    // Carry the round across: a campaign link is clicked by existing users
    // constantly, and dropping it here would land exactly those people on the
    // first round — the thing the param exists to avoid.
    const round = initialRound ? `?round=${encodeURIComponent(initialRound)}` : ''
    redirect(resolved ? `/tournaments/${slug}/predict${round}` : '/tournaments')
  }

  const resolution = await resolvePlayableTournament(slug)

  if (resolution.kind === 'nothing-open') {
    return (
      <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
        <Nav username={undefined} points={0} activePage="tournaments" />
        <div className="max-w-lg mx-auto px-4 md:px-8 py-20 text-center">
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              letterSpacing: '0.08em',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              marginBottom: '1rem',
            }}
          >
            No draw open
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2rem',
              letterSpacing: '-0.02em',
              marginBottom: '1rem',
              lineHeight: 1.15,
            }}
          >
            Nothing to predict right now
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.7 }}>
            {resolution.requested
              ? `The draw for ${resolution.requested.location ?? resolution.requested.name} isn't open, and no other tournament is taking predictions yet.`
              : "No tournament is taking predictions yet."}{' '}
            Draws open a day or two before play starts.
          </p>
          <div className="flex flex-col items-center gap-3 mt-10">
            <Link
              href="/tournaments"
              className="px-6 py-3 text-sm font-medium text-white rounded-sm"
              style={{ background: 'var(--court)', textDecoration: 'none' }}
            >
              See the calendar →
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const { tournament, draw, adminLockedMatches, substituted } = resolution

  const admin = createAdminClient()
  const { data: results, error: resultsErr } = await admin
    .from('match_results')
    .select('external_match_id, winner_external_id')
    .eq('tournament_id', tournament.id)

  if (resultsErr) console.error('[play] match_results query failed:', resultsErr.message)

  const matchResults: Record<string, string> = {}
  for (const r of results ?? []) matchResults[r.external_match_id] = r.winner_external_id

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav username={profile?.username} points={profile?.ranking_points ?? 0} activePage="tournaments" />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 md:py-10">
        <SoloPlayFlow
          tournament={tournament}
          draw={draw}
          matchResults={matchResults}
          adminLockedMatches={Object.keys(adminLockedMatches).length > 0 ? adminLockedMatches : undefined}
          substitutedFor={substituted}
          totalMatches={draw?.matches?.length ?? 0}
          decidedMatches={Object.keys(matchResults).length}
          initialRound={initialRound}
        />
      </div>
    </main>
  )
}
