import Link from 'next/link'
import TrackedCTA from '@/components/TrackedCTA'
import { createAdminClient } from '@/lib/supabase/admin'
import { unstable_cache } from 'next/cache'
import TournamentCard from '@/components/TournamentCard'
import MarketingNav from '@/components/MarketingNav'
import CountryFlag from '@/components/CountryFlag'
import HowItWorksDemo from '@/components/HowItWorksDemo'
import { getTournamentEngagement } from '@/lib/tournaments/engagement'
import { getRecentCompleted, withRecaps } from '@/lib/tournaments/recap'
import { getOnNowTournaments } from '@/lib/tournaments/cached'
import { formatPoints } from '@/lib/utils/format'
import { SITE_URL, SITE_NAME, DEFAULT_OG } from '@/lib/site'
import type { Metadata } from 'next'

// The homepage's own canonical. It used to live on the root layout, from where
// it cascaded onto every other page — see the note there.
//
// openGraph is restated in full rather than inherited only because `url` has to
// be added, and Next replaces the parent's openGraph instead of merging into
// it. DEFAULT_OG keeps the copy identical to the layout's fallback card.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { ...DEFAULT_OG, url: '/' },
}

// ── Cached homepage data: live tournaments + top players ──────────────────
const getHomepageData = unstable_cache(
  async () => {
    const admin = createAdminClient()
    // The strip is no longer just what is on court — a published draw taking
    // predictions belongs here too, and is the only thing a first-time visitor
    // can still enter clean. `getOnNowTournaments` owns that definition and the
    // in-progress-first ordering for every surface that shows the strip; it
    // also flattens the embedded series to the slug/year a card links from.
    const [liveTournaments, { data: top, error: topError }] = await Promise.all([
      getOnNowTournaments(4),
      admin.from('users')
        .select('id, username, ranking_points, country')
        .gt('ranking_points', 0)
        .order('ranking_points', { ascending: false })
        .limit(5),
    ])

    if (topError) console.error('[homepage] top players query failed:', topError.message)

    const engagement = await getTournamentEngagement(liveTournaments.map(t => t.id))
    const enrichedLive = liveTournaments.map(t => ({
      ...t,
      prediction_count: engagement[t.id]?.predictions ?? 0,
      challenge_count: engagement[t.id]?.challenges ?? 0,
    }))

    // Recently finished tournaments, with their stored recap. One extra query
    // for the tournaments and one for the recap rows — the aggregation itself
    // already happened at completion (migration 076), so this stays O(1) in the
    // number of users no matter how many brackets a tournament drew.
    // Formatted on the server: the cards are rendered by client components
    // elsewhere, and the raw payload has no business in a bundle.
    const recentTournaments = await withRecaps(await getRecentCompleted(3))

    // Credibility figures for the hero.
    //
    // Deliberately about coverage rather than crowd. The obvious hero stat is
    // "N predictions locked in", and it would be a lie: of the 108 predictions
    // on the current live tournament, 100 are auto-generated bot brackets and 8
    // belong to real people. Any count of predictions, entrants or players is
    // inflated the same way, so none of them can go on a marketing page.
    //
    // Tournaments covered and matches scored are properties of the product, not
    // claims about how many people use it, so bots cannot distort them.
    //
    // head:true keeps these as COUNT queries — a plain select would silently
    // stop at PostgREST's 1000-row cap and understate matches scored by ~200.
    const [{ count: tournamentsScored }, { count: allResults }, { count: byeResults }] =
      await Promise.all([
        admin.from('tournaments').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
        admin.from('match_results').select('*', { count: 'exact', head: true }),
        admin.from('match_results').select('*', { count: 'exact', head: true }).eq('score', 'BYE'),
      ])

    return {
      liveTournaments: enrichedLive,
      topPlayers: top ?? [],
      recentTournaments,
      coverage: {
        tournamentsScored: tournamentsScored ?? 0,
        // BYEs are bookkeeping rows, not matches anyone played or predicted.
        matchesScored: (allResults ?? 0) - (byeResults ?? 0),
      },
    }
  },
  ['homepage-data'],
  // Tagged so a completion, a revert or an admin rebuild drops this cache
  // rather than leaving a finished tournament missing from the homepage — or
  // worse, a reverted one still claiming a champion.
  //
  // The window is an hour rather than five minutes because the tags, not the
  // clock, are what keep this page correct, and a short window here is pure
  // cost: the homepage renders to 145 KB of HTML (the largest page in the app)
  // and at current traffic almost every visit arrived after the 5-minute window
  // had expired, so nearly every visitor paid a full regeneration and the cache
  // never got a hit. An hour lets the cache actually amortise while every write
  // path that changes what is shown here still busts it immediately.
  { revalidate: 3600, tags: ['tournament-list', 'tournament-recaps'] }
)

// ── Static bracket mock ─────────────────────────────────────────────────────
function MockBracketPreview() {
  const green = 'var(--court)'
  const dim = 'var(--chalk-dim)'
  const muted = 'var(--muted)'

  type MatchData = { p1: string; p2: string; picked: string; correct?: boolean; wrong?: boolean }

  function MatchCard({ p1, p2, picked, correct, wrong }: MatchData) {
    const red = '#b91c1c'
    return (
      <div style={{ width: '116px', border: `1px solid ${dim}`, borderRadius: '3px', overflow: 'hidden', background: 'white', fontSize: '11px', fontFamily: 'var(--font-body)' }}>
        {[p1, p2].map(name => {
          const isPicked = name === picked
          const isWrongPick   = !!wrong && isPicked
          const isActualWinner = !!wrong && !isPicked

          const bg    = isWrongPick    ? '#fef2f2'
                      : isActualWinner ? '#edf7f0'
                      : correct && isPicked ? '#e8f5e9'
                      : isPicked           ? '#eaf3de'
                      : 'white'
          const color = isWrongPick    ? red
                      : isActualWinner ? green
                      : isPicked       ? green
                      : 'var(--ink)'
          const border = isWrongPick    ? '#fca5a5'
                       : isActualWinner ? green
                       : isPicked       ? green
                       : 'transparent'
          return (
            <div key={name} style={{
              padding: '5px 8px',
              background: bg,
              color,
              borderLeft: `3px solid ${border}`,
              borderBottom: `1px solid ${dim}`,
              fontWeight: (isPicked || isActualWinner) ? 500 : 400,
            }}>
              {name}
              {correct       && isPicked     && <span style={{ opacity: 0.7 }}> ✓</span>}
              {isWrongPick                   && <span style={{ opacity: 0.8 }}> ✗</span>}
              {isActualWinner                && <span style={{ opacity: 0.7 }}> ✓</span>}
            </div>
          )
        })}
      </div>
    )
  }

  const r16: MatchData[] = [
    { p1: 'Djokovic',  p2: 'Alcaraz',  picked: 'Alcaraz',  correct: true },
    { p1: 'Sinner',    p2: 'Medvedev',  picked: 'Sinner',   wrong: true },
    { p1: 'Ruud',      p2: 'Rune',      picked: 'Ruud' },
    { p1: 'Fritz',     p2: 'Zverev',    picked: 'Zverev' },
  ]
  const qf: MatchData[] = [
    { p1: 'Alcaraz', p2: 'Medvedev', picked: 'Alcaraz' },
    { p1: 'Ruud',    p2: 'Zverev',   picked: 'Zverev' },
  ]
  const sf: MatchData[] = [
    { p1: 'Alcaraz', p2: 'Zverev', picked: 'Alcaraz' },
  ]

  const colHeader = { fontFamily: 'var(--font-mono)', fontSize: '9px', color: muted, letterSpacing: '2px', textTransform: 'uppercase' as const, textAlign: 'center' as const, marginBottom: '10px' }

  return (
    <div style={{ background: 'var(--chalk)', padding: '20px 24px 20px', overflowX: 'auto' }}>
      <div className="flex justify-end mb-2">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', background: '#eaf3de', color: green, padding: '2px 8px', borderRadius: '2px', letterSpacing: '0.04em' }}>
          +360 pts · ×1.5 streak
        </span>
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', minWidth: 'max-content' }}>
        <div>
          <div style={colHeader}>R16</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {r16.map((m, i) => <MatchCard key={i} {...m} />)}
          </div>
        </div>
        <div style={{ marginTop: '30px' }}>
          <div style={colHeader}>QF</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '54px' }}>
            {qf.map((m, i) => <MatchCard key={i} {...m} />)}
          </div>
        </div>
        <div style={{ marginTop: '80px' }}>
          <div style={colHeader}>SF</div>
          {sf.map((m, i) => <MatchCard key={i} {...m} />)}
        </div>
        <div style={{ marginTop: '136px', paddingLeft: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: muted, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px' }}>Final</div>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#eaf3de', border: `1.5px solid ${green}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>
            🏆
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Compact bracket fragment for the hero.
 *
 * The hero was ~700px of pure typography and the product itself did not appear
 * until roughly 1,500px down the page, so a visitor decided whether to sign up
 * having never seen the thing they were signing up for.
 *
 * Deliberately not MockBracketPreview. That one is four rounds wide and lives
 * further down beside the copy explaining how the draw works; repeating it here
 * would be the same picture twice with the second one squashed. This shows the
 * single idea the hero needs — you pick a winner, it turns green or red and
 * pays points — and leaves the full diagram to do its own job below.
 *
 * md: and up only. On a phone the hero is already tall, and pushing the live
 * tournaments further down to make room for a picture of a bracket would cost
 * more than it gains.
 */
function HeroBracketFragment() {
  const green = 'var(--court)'
  const dim = 'var(--chalk-dim)'
  const red = '#b91c1c'

  const rows: { name: string; state: 'correct' | 'wrong' | 'winner' | 'plain' }[][] = [
    [{ name: 'Alcaraz', state: 'correct' }, { name: 'Djokovic', state: 'plain' }],
    [{ name: 'Sinner', state: 'wrong' }, { name: 'Medvedev', state: 'winner' }],
    [{ name: 'Zverev', state: 'correct' }, { name: 'Fritz', state: 'plain' }],
  ]

  const style = (s: string) =>
    s === 'wrong'  ? { background: '#fef2f2', color: red,   border: '#fca5a5' }
  : s === 'winner' ? { background: '#edf7f0', color: green, border: green }
  : s === 'correct'? { background: '#e8f5e9', color: green, border: green }
  :                  { background: 'white',   color: 'var(--ink)', border: 'transparent' }

  return (
    <div aria-hidden="true" className="w-full max-w-[320px] mx-auto md:mx-0 md:ml-auto">
      <div
        className="rounded-sm border overflow-hidden"
        style={{ borderColor: dim, background: 'var(--chalk)', padding: '18px' }}
      >
        <div className="flex items-center justify-between mb-3">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--muted)', letterSpacing: '2px', textTransform: 'uppercase' }}>
            Your picks
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', background: '#eaf3de', color: green, padding: '2px 8px', borderRadius: '2px' }}>
            +360 pts
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((match, i) => (
            <div key={i} style={{ border: `1px solid ${dim}`, borderRadius: '3px', overflow: 'hidden', background: 'white' }}>
              {match.map(p => {
                const s = style(p.state)
                return (
                  <div
                    key={p.name}
                    style={{
                      padding: '6px 9px',
                      fontSize: '12px',
                      fontFamily: 'var(--font-body)',
                      background: s.background,
                      color: s.color,
                      borderLeft: `3px solid ${s.border}`,
                      borderBottom: `1px solid ${dim}`,
                      fontWeight: p.state === 'plain' ? 400 : 500,
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{p.name}</span>
                    {p.state === 'correct' && <span style={{ opacity: 0.7 }}>✓</span>}
                    {p.state === 'wrong' && <span style={{ opacity: 0.8 }}>✗</span>}
                    {p.state === 'winner' && <span style={{ opacity: 0.7 }}>✓</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9.5px', color: 'var(--muted)', marginTop: '12px', letterSpacing: '0.03em' }}>
          Green = called it · Red = missed
        </p>
      </div>
    </div>
  )
}

// ── Structured data ─────────────────────────────────────────────────────────
// WebApplication describes the product itself; FAQPage targets the questions
// people actually type ("is it free", "how does scoring work"), which is how a
// small site earns SERP real estate against bigger domains.
const homepageJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      '@id': `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any',
      description:
        'Free tennis bracket challenge for ATP and WTA tournaments. Predict every match, earn points for correct picks, and compete with friends across the season.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/#faq`,
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is Quiet Please free to play?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Creating an account and filling out brackets for any ATP or WTA tournament is completely free. You can also challenge a friend without signing up at all.',
          },
        },
        {
          '@type': 'Question',
          name: 'How does the tennis bracket challenge work?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'When the official draw is published, you pick the winner of every match from the first round through to the final. Each correct pick earns points, and backing the same player through consecutive rounds compounds your score with a streak multiplier.',
          },
        },
        {
          '@type': 'Question',
          name: 'Which tournaments can I predict?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'All 60+ ATP and WTA tournaments across the season, including every Grand Slam — the Australian Open, Roland Garros, Wimbledon and the US Open.',
          },
        },
        {
          '@type': 'Question',
          name: 'How is scoring calculated?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Correct picks earn points using a formula modelled on professional tour scoring, so correctly picking a Grand Slam champion is worth substantially more than an early-round match. Points roll into a global ranking over a 52-week window.',
          },
        },
      ],
    },
  ],
}

export default async function HomePage() {
  const { liveTournaments, topPlayers, recentTournaments, coverage } = await getHomepageData()

  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--chalk)' }}>

      {/* Structured data — lets Google render this as a rich result for
          "tennis bracket challenge" rather than a plain blue link. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageJsonLd) }}
      />

      {/* ── Nav ───────────────────────────────────────────────────── */}
      <MarketingNav />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="px-4 md:px-8 pt-12 pb-16 md:pt-20 md:pb-24">
      <div className="max-w-5xl mx-auto grid md:grid-cols-[1fr_auto] gap-12 items-center">
      <div className="flex flex-col items-center md:items-start text-center md:text-left">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 mb-8 rounded-sm text-xs tracking-widest uppercase"
          style={{ background: 'var(--court-dark)', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)' }}
        >
          <span style={{ color: 'var(--clay)' }}>●</span>
          ATP · WTA · All tournaments
        </div>
        {/* The display type carries the emotion; the h1 carries the keywords.
            Screen readers and crawlers read both, in this order. */}
        <p
          aria-hidden="true"
          style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(3rem, 8vw, 6.5rem)', lineHeight: '1.0', letterSpacing: '-0.02em', color: 'var(--ink)', maxWidth: '14ch' }}
        >
          Predict.<br /><em style={{ color: 'var(--court)' }}>Compete.</em><br />Win.
        </p>
        <h1 className="mt-8" style={{ fontFamily: 'var(--font-body)', fontSize: '1.125rem', color: 'var(--muted)', maxWidth: '46ch', lineHeight: '1.6', fontWeight: 300 }}>
          Free tennis bracket challenges for every ATP &amp; WTA tournament — fill out the draw before it closes, earn points for every correct pick, and compete with friends all season.
        </h1>
        <div className="flex flex-col sm:flex-row items-center gap-3 mt-10">
          <TrackedCTA
            href="/signup"
            location="hero"
            className="w-full sm:w-auto px-6 py-3.5 md:px-8 text-white text-sm font-medium rounded-sm hover:opacity-90 text-center"
            style={{ background: 'var(--court)' }}
          >
            Start predicting — it&apos;s free
          </TrackedCTA>
          {/* /challenges/create works without an account — that is the whole
              appeal of this path, so the label says so rather than making
              visitors guess whether it will hit a signup wall. */}
          <Link
            href="/challenges/create"
            className="w-full sm:w-auto px-6 py-3.5 md:px-8 text-sm font-medium rounded-sm border transition-opacity hover:opacity-80 text-center"
            style={{ background: 'white', borderColor: 'var(--chalk-dim)', color: 'var(--ink)' }}
          >
            Challenge a friend — no signup
          </Link>
        </div>

        {/*
          Credibility line. Says what the product has actually done, not how
          many people did it — see the note in getHomepageData for why no count
          of predictions, entrants or players can appear on a marketing page
          while bot brackets outnumber real ones roughly twelve to one.
        */}
        {coverage.matchesScored > 0 && (
          <p
            className="mt-8"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.03em' }}
          >
            {coverage.tournamentsScored} tournaments scored this season ·{' '}
            {coverage.matchesScored.toLocaleString('en-US')} matches settled
          </p>
        )}
      </div>

      <HeroBracketFragment />
      </div>
      </section>

      {/* ── Live Right Now ─────────────────────────────────────────── */}
      {liveTournaments.length > 0 && (
        <section className="py-8 md:py-12 border-t border-b" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
          <div className="max-w-5xl mx-auto px-4 md:px-8">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: '#c84b31', boxShadow: '0 0 0 3px rgba(200,75,49,0.2)', flexShrink: 0 }}
                />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Live right now
                </span>
              </div>
              <Link href="/tournaments" className="inline-flex items-center min-h-[44px]" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>See all tournaments →</Link>
            </div>
            <div className={`grid gap-3 ${liveTournaments.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
              {liveTournaments.map(t => (
                <TournamentCard key={t.id} t={t} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Recent results ─────────────────────────────────────────── */}
      {/* Not windowed to "this week" — tennis has quiet weeks and a long
          off-season, and a section that disappears for months teaches
          visitors the app is dormant. Each card carries its own dates, so
          showing the last three finished events overclaims nothing. */}
      {recentTournaments.length > 0 && (
        <section className="py-8 md:py-12 border-b" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
          <div className="max-w-5xl mx-auto px-4 md:px-8">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Recent results
                </span>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '4px', lineHeight: 1.4 }}>
                  How the crowd did when the dust settled.
                </p>
              </div>
              <Link href="/tournaments?status=completed&year=all" className="inline-flex items-center min-h-[44px] shrink-0" style={{ fontSize: '0.875rem', color: 'var(--court)' }}>
                See all →
              </Link>
            </div>
            {/* One column on mobile by default — three recap cards side by side
                at 375px would each be ~100px wide. */}
            <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
              {recentTournaments.map(t => (
                <TournamentCard key={t.id} t={t} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Bracket Preview ────────────────────────────────────────── */}
      <section className="py-12 md:py-20">
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
                The bracket
              </div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '16px' }}>
                Fill out your bracket before the draw closes
              </h2>
              <p style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: '0.9rem' }}>
                The moment the official draw is published, your window opens. Pick the winner of every match — round by round — and lock in your predictions before each match starts.
              </p>
              {/* Label matches the destination: this goes to the tournament list,
                  not straight into a bracket. */}
              <Link
                href="/tournaments"
                className="inline-block mt-6 px-6 py-3 text-sm font-medium text-white rounded-sm hover:opacity-90"
                style={{ background: 'var(--court)' }}
              >
                See open draws →
              </Link>
            </div>
            <div className="rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              <MockBracketPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────────────────── */}
      <section className="py-12 md:py-20 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="text-center mb-8">
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
              How it works
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Four steps to your first prediction
            </h2>
          </div>
          <HowItWorksDemo />
        </div>
      </section>

      {/* ── Leaderboard Teaser ─────────────────────────────────────── */}
      <section className="py-12 md:py-20 border-t" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">

            {/* Rankings preview */}
            <div style={{ position: 'relative' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>
                Global rankings · Rolling 52 weeks
              </div>
              <div className="rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
                {(topPlayers.length > 0 ? topPlayers : Array.from({ length: 5 })).map((p: any, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-3 border-b last:border-0"
                    style={{
                      borderColor: 'var(--chalk-dim)',
                      filter: i >= 3 ? 'blur(5px)' : 'none',
                      userSelect: i >= 3 ? 'none' : 'auto',
                      pointerEvents: i >= 3 ? 'none' : 'auto',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', minWidth: '24px' }}>
                        #{i + 1}
                      </span>
                      {topPlayers.length > 0 ? (
                        <>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', color: 'var(--ink)' }}>{p.username}</span>
                          {p.country && (
                            <CountryFlag country={p.country} size={14} />
                          )}
                        </>
                      ) : (
                        <span style={{
                          fontFamily: 'var(--font-display)', fontSize: '0.95rem',
                          background: 'var(--chalk-dim)', color: 'transparent', borderRadius: '2px',
                          userSelect: 'none',
                        }}>
                          {'─'.repeat(7 + i)}
                        </span>
                      )}
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--court)' }}>
                      {topPlayers.length > 0
                        ? `${formatPoints(p.ranking_points)} pts`
                        : `${formatPoints(4800 - i * 620)} pts`
                      }
                    </span>
                  </div>
                ))}
              </div>
              {/* Gradient fade + CTA */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px',
                background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.97))',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '10px',
              }}>
                <TrackedCTA
                  href="/signup"
                  location="leaderboard_teaser"
                  className="inline-flex items-center min-h-[44px] px-3"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--court)', textDecoration: 'none', letterSpacing: '0.03em' }}
                >
                  Sign up to see full rankings →
                </TrackedCTA>
              </div>
            </div>

            {/* Copy */}
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
                Season standings
              </div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '16px' }}>
                Compete across the full 52-week season
              </h2>
              <p style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: '0.9rem' }}>
                Every tournament you predict adds to your rolling annual ranking. The leaderboard runs a 52-week window — consistent accuracy over the whole season beats a single lucky week every time.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {[
                  { stat: '60+', label: 'Tournaments per season' },
                  { stat: 'ATP & WTA', label: 'Both tours, full calendar' },
                ].map((s, i) => (
                  <div key={i} className="px-4 py-4 rounded-sm border" style={{ borderColor: 'var(--chalk-dim)', background: 'var(--chalk)' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.02em', color: 'var(--court)' }}>{s.stat}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '3px', lineHeight: 1.4 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────── */}
      <section className="py-12 md:py-20 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="text-center mb-10 md:mb-14">
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
              Everything in one place
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Built for every tennis fan
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px" style={{ background: 'var(--chalk-dim)', border: '1px solid var(--chalk-dim)' }}>
            {[
              {
                n: '01',
                label: 'Worldwide rankings',
                desc: 'See where you stand globally, in your country, and in your city. Rankings roll over a 52-week window — sustained accuracy beats a single lucky Grand Slam.',
              },
              {
                n: '02',
                label: 'Private leagues',
                desc: 'Create a group, share the invite code, and see who rules your circle through the full season. Filter standings by Grand Slams only or across the full calendar.',
              },
              {
                n: '03',
                label: 'Head-to-head challenges',
                desc: 'Send a bracket link to anyone. They fill in their picks, you both lock in, and the results settle the argument.',
              },
              {
                n: '04',
                label: 'Streak multiplier',
                desc: 'Back the same player round after round and your points compound. Ride one through five straight rounds and the multiplier stacks on top of that.',
              },
              {
                n: '05',
                label: 'The full calendar',
                desc: 'All 60+ ATP and WTA tournaments from Melbourne to the ATP Finals, synced the moment official draws are published.',
              },
              {
                n: '06',
                label: 'ATP & WTA-style scoring',
                desc: 'Your correct picks earn points using the same scoring formula as the professional tour. A correct Grand Slam winner pick is worth 2,000 points — matching what the actual champion earns on tour.',
              },
            ].map((f, i) => (
              <div key={i} className="px-6 py-8 md:px-8 md:py-10" style={{ background: i % 2 === 0 ? '#eef4ff' : '#edf7f0' }}>
                <div className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--court)', fontFamily: 'var(--font-mono)' }}>
                  {f.n}
                </div>
                <div className="font-medium mb-2" style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>{f.label}</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: '1.7' }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Achievements showcase ─────────────────────────────────── */}
      <section className="py-12 md:py-20 border-t" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="text-center mb-10 md:mb-14">
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#D4A017', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
              Earn badges
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Collect achievements as you play
            </h2>
            <p style={{ color: 'var(--muted)', maxWidth: '44ch', margin: '16px auto 0', lineHeight: 1.7, fontSize: '0.9rem' }}>
              Win tournament trophies, unlock milestones, and build your badge collection throughout the season.
            </p>
          </div>

          {/* Trophy showcase row */}
          <div className="flex justify-center gap-4 md:gap-6 mb-10 flex-wrap">
            {[
              { emoji: '🏆', label: '1st place', bg: '#FFF8E7', border: '#F0D68A', ring: '#D4A017', glow: 'rgba(212,160,23,0.15)', name: 'Tournament Champion' },
              { emoji: '🥈', label: '2nd place', bg: '#F5F5F5', border: '#D0D0D0', ring: '#8A8A8A', glow: 'rgba(138,138,138,0.12)', name: 'Runner-Up' },
              { emoji: '🥉', label: '3rd place', bg: '#FDF5EE', border: '#E0C4A8', ring: '#B87333', glow: 'rgba(184,115,51,0.12)', name: 'On the Podium' },
            ].map((t, i) => (
              <div
                key={i}
                className="flex flex-col items-center tournament-card"
                style={{ padding: '20px 18px 16px', borderRadius: '3px', border: `1px solid ${t.border}`, background: t.bg, minWidth: '120px' }}
              >
                <div style={{
                  width: '64px', height: '64px', borderRadius: '50%',
                  border: `2.5px solid ${t.ring}`, boxShadow: `0 0 0 3px ${t.glow}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '10px', background: 'white',
                }}>
                  <span style={{ fontSize: '1.5rem' }}>{t.emoji}</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.ring, marginBottom: '6px' }}>
                  {t.label}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', textAlign: 'center', color: 'var(--ink)' }}>
                  {t.name}
                </span>
              </div>
            ))}
          </div>

          {/* Achievement samples — horizontal scroll on mobile */}
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <div className="flex gap-3 md:justify-center" style={{ minWidth: 'max-content' }}>
              {[
                { emoji: '🎾', name: 'First Pick', desc: '1 prediction', color: '#185FA5', bg: '#EEF4FF', border: '#B8D4F0' },
                { emoji: '🔥', name: 'On Fire', desc: '15 correct picks', color: '#c8530a', bg: '#FFF5EE', border: '#F0C8A0' },
                { emoji: '⚡', name: 'Hot Streak', desc: '3× multiplier', color: '#c8530a', bg: '#FFF5EE', border: '#F0C8A0' },
                { emoji: '👑', name: 'Grand Master', desc: '2500+ pts', color: '#7c2d7c', bg: '#F9F0F9', border: '#DDB8DD' },
                { emoji: '🤝', name: 'Social Starter', desc: '1st friend', color: '#1a6b3c', bg: '#EDF7F0', border: '#B8DABB' },
                { emoji: '🌍', name: 'Globe Trotter', desc: 'ATP + WTA', color: '#993556', bg: '#FDF0F4', border: '#E0B0C0' },
              ].map((a, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center flex-shrink-0 tournament-card"
                  style={{ padding: '14px 10px 10px', borderRadius: '3px', border: `1px solid ${a.border}`, background: a.bg, width: '110px' }}
                >
                  <div style={{
                    width: '44px', height: '44px', borderRadius: '50%',
                    border: `2px solid ${a.color}`, boxShadow: `0 0 0 2px ${a.color}20`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: '6px', background: 'white',
                  }}>
                    <span style={{ fontSize: '1.1rem' }}>{a.emoji}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.75rem', textAlign: 'center', color: 'var(--ink)', lineHeight: 1.2, marginBottom: '2px' }}>
                    {a.name}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', color: 'var(--muted)', textAlign: 'center' }}>
                    {a.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center mt-8">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
              26 achievements to unlock
            </span>
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────── */}
      <section className="py-16 md:py-24 border-t text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 5vw, 3.5rem)', letterSpacing: '-0.02em', lineHeight: 1.05, marginBottom: '20px' }}>
            The full season starts now.
          </h2>
          <p style={{ color: 'var(--muted)', maxWidth: '36ch', margin: '0 auto 2rem', lineHeight: 1.7, fontSize: '0.9rem' }}>
            Create your free account and make your first picks before the next draw closes.
          </p>
          <TrackedCTA
            href="/signup"
            location="footer"
            className="inline-block px-8 py-4 text-sm font-medium text-white rounded-sm hover:opacity-90"
            style={{ background: 'var(--court)' }}
          >
            Make your first picks — free
          </TrackedCTA>
        </div>
      </section>
    </main>
  )
}
