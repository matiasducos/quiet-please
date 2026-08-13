import Link from 'next/link'
import MarketingNav from '@/components/MarketingNav'
import Footer from '@/components/Footer'
import TrackedCTA from '@/components/TrackedCTA'
import TournamentCard from '@/components/TournamentCard'
import HowItWorksDemo from '@/components/HowItWorksDemo'
import { getLiveTournaments } from '@/lib/tournaments/cached'
import { getTournamentEngagement } from '@/lib/tournaments/engagement'
import { ALL_SLAMS, type SlamConfig } from '@/lib/slams/config'
import { estimateNextEdition, getSlamPerformers, type SlamEditions, type SlamTournament } from '@/lib/slams/data'
import { editionHref, hubHref } from '@/lib/tournaments/slug'
import { buildSlamJsonLd } from '@/lib/slams/jsonLd'

/** "the US Open" -> "The US Open", for use at the start of a sentence. */
function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatDateRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt) return ''
  const start = new Date(startsAt)
  const year = start.getUTCFullYear()
  if (!endsAt) return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const end = new Date(endsAt)
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${start.toLocaleDateString('en-GB', { month: 'long' })} ${year}`
  }
  return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${year}`
}

/**
 * Tournament rows arrive from the API sync with `location`/`flag_emoji` NULL,
 * but the project convention is that every tournament reference shows its flag.
 * The slam's own config always has both, so fill any gaps from there.
 */
function withVenue(t: SlamTournament, config: SlamConfig) {
  return {
    ...t,
    location: t.location ?? `${config.city}, ${config.country}`,
    flag_emoji: t.flag_emoji ?? config.flagEmoji,
  }
}

function SectionHeading({ kicker, title, accent }: { kicker: string; title: string; accent: string }) {
  return (
    <>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
        {kicker}
      </div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '16px' }}>
        {title}
      </h2>
    </>
  )
}

export default async function SlamLanding({
  config,
  editions,
}: {
  config: SlamConfig
  editions: SlamEditions
}) {
  const { accent } = config
  const draws = [editions.atp, editions.wta].filter(Boolean) as SlamTournament[]
  const isPlayable = editions.phase === 'open' || editions.phase === 'live'

  // Both short-circuit to an empty result when there is no edition to describe.
  // Performers feed the structured data, not the UI, so they ride along here.
  const [engagement, performers] = await Promise.all([
    getTournamentEngagement(draws.map(d => d.id)),
    getSlamPerformers(editions),
  ])

  // In the off-season the page still needs somewhere to send people.
  const liveElsewhere = isPlayable ? [] : await getLiveTournaments(2)

  const jsonLd = buildSlamJsonLd(config, editions, performers)
  const otherSlams = ALL_SLAMS.filter(s => s.slug !== config.slug)

  // The series hub — every past edition and its champion.
  //
  // Read off a tournament row rather than assuming `config.slug` matches the
  // series slug: the two are independent, config.slug names the landing page
  // and the series slug is admin-editable at /admin/tournaments/series.
  //
  // These four pages carry the most authority on the site, so this link is the
  // main path by which it reaches the tournament section at all.
  const seriesSlug =
    editions.atp?.slug ?? editions.wta?.slug ?? editions.lastCompleted?.slug ?? null
  const seriesHref = hubHref(seriesSlug)

  const primaryCta = isPlayable && editions.atp
    ? { href: `/tournaments/${editions.atp.id}/predict`, label: `Fill out your ${config.name} bracket` }
    : { href: '/signup', label: 'Create your free account' }

  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--chalk)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <MarketingNav />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="px-4 md:px-8 pt-10 pb-12 md:pt-16 md:pb-16" style={{ borderBottom: `3px solid ${accent.base}` }}>
        <div className="max-w-5xl mx-auto">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-sm text-xs tracking-widest uppercase"
            style={{ background: accent.soft, color: accent.ink, fontFamily: 'var(--font-mono)' }}
          >
            <span>{config.flagEmoji}</span>
            {config.heroKicker}
          </div>

          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.25rem, 6vw, 4rem)', lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--ink)', maxWidth: '18ch' }}>
            {config.h1}
          </h1>

          <p className="mt-6" style={{ fontSize: '1.05rem', color: 'var(--muted)', maxWidth: '52ch', lineHeight: 1.6, fontWeight: 300 }}>
            {config.heroSubhead}
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-8">
            <TrackedCTA
              href={primaryCta.href}
              location={`slam_${config.slug}_hero`}
              className="inline-flex items-center justify-center min-h-[44px] px-6 py-3.5 md:px-8 text-white text-sm font-medium rounded-sm hover:opacity-90 text-center"
              style={{ background: accent.base }}
            >
              {primaryCta.label}
            </TrackedCTA>
            <Link
              href="/challenges/create"
              className="inline-flex items-center justify-center min-h-[44px] px-6 py-3.5 md:px-8 text-sm font-medium rounded-sm border hover:opacity-80 text-center"
              style={{ background: 'white', borderColor: 'var(--chalk-dim)', color: 'var(--ink)' }}
            >
              Challenge a friend — no signup
            </Link>
          </div>

          {/* Facts strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-10">
            {config.facts.map(f => (
              <div key={f.label} className="px-4 py-3 rounded-sm border" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {f.label}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: accent.ink, marginTop: '3px' }}>
                  {f.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── This edition ──────────────────────────────────────────── */}
      <section className="py-12 md:py-16" style={{ background: 'white', borderBottom: '1px solid var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          {draws.length > 0 ? (
            <>
              <SectionHeading
                kicker={isPlayable ? 'Open now' : 'Next edition'}
                title={
                  isPlayable
                    ? `Your ${config.name} bracket is open`
                    : `${config.name} ${editions.year ?? ''}`.trim()
                }
                accent={accent.base}
              />
              <p style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: '0.9rem', maxWidth: '60ch', marginBottom: '20px' }}>
                {isPlayable
                  ? 'Pick the winner of every match, round by round. You can change any pick right up until that match starts.'
                  : `The draw has not been published yet. Brackets open the moment it is, ${
                      editions.nextStartsAt ? `ahead of play starting ${formatDateRange(editions.nextStartsAt, null)}` : 'a few days before the first round'
                    }.`}
              </p>
              <div className={`grid gap-3 ${draws.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                {draws.map(d => (
                  <TournamentCard
                    key={d.id}
                    t={{
                      ...withVenue(d, config),
                      prediction_count: engagement[d.id]?.predictions ?? 0,
                      challenge_count: engagement[d.id]?.challenges ?? 0,
                    }}
                  />
                ))}
              </div>
              {editions.wta === null && (
                <p className="mt-4" style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  The WTA draw appears here as soon as it is added.
                </p>
              )}
            </>
          ) : (
            <>
              <SectionHeading kicker="Off-season" title={`${config.name} returns in ${estimateNextEdition(config)}`} accent={accent.base} />
              <p style={{ color: 'var(--muted)', lineHeight: 1.7, fontSize: '0.9rem', maxWidth: '60ch' }}>
                {sentenceCase(config.nameWithArticle)} is played in {config.seasonWindow} each year in {config.city}.
                Your bracket opens here the moment the official draw is published — until then, there is plenty of
                tennis to predict.
              </p>
              {editions.lastCompleted && (
                <Link
                  // The edition page, not /tournaments/<uuid>/results: it shows
                  // the same draw and results, and it is the canonical URL in
                  // the sitemap. The UUID path stays as the fallback for a row
                  // with no series, which has no edition URL to link.
                  href={
                    editionHref(editions.lastCompleted.slug, editions.lastCompleted.year) ??
                    `/tournaments/${editions.lastCompleted.id}/results`
                  }
                  className="inline-flex items-center min-h-[44px] mt-4"
                  style={{ color: accent.base, fontSize: '0.9rem' }}
                >
                  See how the last {config.name} played out →
                </Link>
              )}
              {liveElsewhere.length > 0 && (
                <div className="mt-8">
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px' }}>
                    Open right now
                  </div>
                  <div className={`grid gap-3 ${liveElsewhere.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                    {liveElsewhere.map(t => (
                      <TournamentCard key={t.id} t={t} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Outside both branches: whether the draw is open or the page is in
              the off-season, the history is there and worth linking. */}
          {seriesHref && (
            <Link
              href={seriesHref}
              className="inline-flex items-center min-h-[44px] mt-6"
              style={{ color: accent.base, fontSize: '0.9rem' }}
            >
              Every {config.name} champion, year by year →
            </Link>
          )}
        </div>
      </section>

      {/* ── About this slam ───────────────────────────────────────── */}
      <section className="py-12 md:py-16">
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <SectionHeading kicker={`${config.flagEmoji} ${config.city}, ${config.country}`} title={`About ${config.nameWithArticle}`} accent={accent.base} />
          <p style={{ color: 'var(--muted)', lineHeight: 1.8, fontSize: '0.95rem', maxWidth: '65ch' }}>
            {config.intro}
          </p>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────── */}
      <section className="py-12 md:py-16 border-t" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <div className="text-center mb-8">
            <SectionHeading kicker="How it works" title="Four steps to your first prediction" accent={accent.base} />
          </div>
          <HowItWorksDemo />
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────── */}
      <section className="py-12 md:py-16 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <SectionHeading kicker="Questions" title={`${config.name} bracket FAQ`} accent={accent.base} />
          <div className="flex flex-col gap-px" style={{ background: 'var(--chalk-dim)', border: '1px solid var(--chalk-dim)' }}>
            {config.faq.map(item => (
              <div key={item.q} className="px-5 py-5 md:px-7 md:py-6" style={{ background: 'white' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink)', marginBottom: '8px' }}>
                  {item.q}
                </h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.7 }}>{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Other slams (internal linking) ────────────────────────── */}
      <section className="py-12 md:py-16 border-t" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <SectionHeading kicker="The other majors" title="Predict every Grand Slam" accent={accent.base} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {otherSlams.map(s => (
              <Link
                key={s.slug}
                href={s.route}
                className="tournament-card flex items-center gap-3 px-4 py-4 rounded-sm border min-h-[44px]"
                style={{ borderColor: 'var(--chalk-dim)', background: s.accent.soft, textDecoration: 'none' }}
              >
                <span style={{ fontSize: '1.25rem' }}>{s.flagEmoji}</span>
                <span>
                  <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>
                    {s.name}
                  </span>
                  <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: s.accent.ink, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: '2px' }}>
                    {s.city}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────── */}
      <section className="py-14 md:py-20 border-t text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-8">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 5vw, 3rem)', letterSpacing: '-0.02em', lineHeight: 1.05, marginBottom: '16px' }}>
            {isPlayable ? `The ${config.name} draw is waiting.` : `Be ready when the ${config.name} draw lands.`}
          </h2>
          <p style={{ color: 'var(--muted)', maxWidth: '40ch', margin: '0 auto 1.75rem', lineHeight: 1.7, fontSize: '0.9rem' }}>
            Free to play, no prizes, no real money — just points, rankings and the argument settled.
          </p>
          <TrackedCTA
            href={primaryCta.href}
            location={`slam_${config.slug}_footer`}
            className="inline-flex items-center justify-center min-h-[44px] px-8 py-4 text-sm font-medium text-white rounded-sm hover:opacity-90"
            style={{ background: accent.base }}
          >
            {primaryCta.label}
          </TrackedCTA>
        </div>
      </section>

      <Footer />
    </main>
  )
}
