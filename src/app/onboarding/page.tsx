import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavProfile } from '@/lib/supabase/profile'
import { getPredictableStatuses } from '@/lib/app-settings'
import Link from 'next/link'
import Nav from '@/components/Nav'
import HowItWorksDemo from '@/components/HowItWorksDemo'

export const metadata: Metadata = { title: 'Get Started | Quiet Please' }

// ── Onboarding page — shown to new users after signup ───────────────────────
// Also accessible any time via /onboarding (linked from the nav)

const modes = [
  {
    number: '01',
    headline: 'Predict every tournament. Earn real points.',
    body: 'Pick winners before the draw closes on any ATP or WTA tournament. Every correct prediction earns points using the official ATP/WTA formula — the same structure the pros compete for. Your results roll into a 52-week global ranking.',
    cta: 'Browse tournaments',
    href: '/tournaments',
    icon: '🎾',
  },
  {
    number: '02',
    headline: 'Create a league with your group.',
    body: 'Invite your friends, family, or tennis buddies into a private league. Everyone predicts the same tournaments, and the standings update automatically after every match result. Filter by Grand Slams only or the full calendar.',
    cta: 'Create a league',
    href: '/leagues',
    icon: '🏆',
  },
  {
    number: '03',
    headline: 'Challenge anyone. No account needed.',
    body: 'Pick a live tournament, fill in your bracket, and send a link. Your opponent makes their picks — they don\'t need an account. Whoever scores more points when it\'s all over wins. Simple.',
    cta: 'Start a challenge',
    href: '/challenges/create',
    icon: '⚡',
  },
]

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ invited_by?: string }>
}) {
  const { user, profile } = await getNavProfile()
  const admin = createAdminClient()
  const { invited_by } = await searchParams

  // Validate the invited_by param — only show the banner if it resolves to
  // an actual user. Prevents arbitrary strings from being echoed back.
  let inviterUsername: string | null = null
  if (invited_by) {
    const { data: inviter } = await admin
      .from('users')
      .select('username')
      .ilike('username', invited_by)
      .maybeSingle()
    inviterUsername = inviter?.username ?? null
  }

  // Find the first predictable tournament for the "Get started" CTA
  const predictableStatuses = await getPredictableStatuses()
  const { data: liveTournaments } = await admin
    .from('tournaments')
    .select('id, name, location, flag_emoji')
    .in('status', predictableStatuses)
    .order('starts_at', { ascending: true })
    .limit(1)

  const firstLiveTournament = liveTournaments?.[0] ?? null

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav
        username={profile?.username}
        points={profile?.ranking_points ?? 0}
        userId={user?.id}
        activePage="onboarding"
      />

      <div className="max-w-4xl mx-auto px-4 md:px-8 py-12 md:py-20">

        {/* ── Invited-by banner ───────────────────────────────────────────── */}
        {inviterUsername && (
          <div
            className="rounded-sm border mb-8 flex items-center gap-3 md:gap-4"
            style={{
              background: '#eaf3de',
              borderColor: '#B8D4F0',
              padding: '14px 16px',
            }}
          >
            <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>🎾</span>
            <div className="flex-1 min-w-0">
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.62rem',
                color: 'var(--court-dark)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: '2px',
              }}>
                You were invited
              </p>
              <p style={{ fontSize: '0.92rem', color: 'var(--ink)', lineHeight: 1.4 }}>
                <Link href={`/profile/${inviterUsername}`} style={{ color: 'var(--court-dark)', fontWeight: 500, textDecoration: 'none' }}>
                  {inviterUsername}
                </Link>
                {' '}is now your first friend. Start a challenge or just share picks.
              </p>
            </div>
            <Link
              href={`/challenges/create`}
              className="flex-shrink-0"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.7rem',
                padding: '6px 10px',
                borderRadius: '2px',
                background: 'var(--court)',
                color: '#fff',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Challenge →
            </Link>
          </div>
        )}

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="text-center mb-12 md:mb-16">
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'var(--court)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            marginBottom: '1rem',
          }}>
            Welcome to Quiet Please
          </p>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(2rem, 5vw, 3.5rem)',
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            marginBottom: '1.25rem',
          }}>
            Your bracket.<br />Your season.
          </h1>
          <p style={{
            color: 'var(--muted)',
            fontSize: '1.05rem',
            maxWidth: '480px',
            margin: '0 auto',
            lineHeight: 1.6,
          }}>
            Predict every ATP and WTA tournament. Compete in private leagues. Challenge friends with a single link.
          </p>
        </div>

        {/* ── How it works demo ───────────────────────────────────────────── */}
        <div className="mb-14">
          <HowItWorksDemo />
        </div>

        {/* ── Three modes ─────────────────────────────────────────────────── */}
        <div className="mb-14">
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.5rem',
            letterSpacing: '-0.02em',
            marginBottom: '1.5rem',
          }}>
            Three ways to play
          </h2>

          <div className="flex flex-col gap-4">
            {modes.map(mode => (
              <div
                key={mode.number}
                className="bg-white rounded-sm border p-6 md:p-8"
                style={{ borderColor: 'var(--chalk-dim)' }}
              >
                <div className="flex items-start gap-4 md:gap-6">
                  {/* Number badge */}
                  <div
                    className="shrink-0 flex items-center justify-center rounded-sm"
                    style={{
                      width: '36px',
                      height: '36px',
                      background: 'var(--chalk)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.7rem',
                      color: 'var(--muted)',
                      letterSpacing: '0.04em',
                      marginTop: '2px',
                    }}
                  >
                    {mode.number}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Icon + headline */}
                    <div className="flex items-center gap-2 mb-2">
                      <span style={{ fontSize: '1.1rem' }}>{mode.icon}</span>
                      <h3 style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '1.1rem',
                        letterSpacing: '-0.01em',
                        color: 'var(--ink)',
                      }}>
                        {mode.headline}
                      </h3>
                    </div>

                    {/* Body */}
                    <p style={{
                      fontSize: '0.875rem',
                      color: 'var(--muted)',
                      lineHeight: 1.65,
                      marginBottom: '1rem',
                    }}>
                      {mode.body}
                    </p>

                    {/* Mode CTA */}
                    <Link
                      href={mode.href}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.75rem',
                        color: 'var(--court)',
                        letterSpacing: '0.03em',
                        textDecoration: 'none',
                      }}
                    >
                      {mode.cta} →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Primary CTA ─────────────────────────────────────────────────── */}
        <div className="text-center">
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: '1.25rem', textTransform: 'uppercase' }}>
            Ready to start?
          </p>

          {firstLiveTournament ? (
            <Link
              href={`/tournaments/${firstLiveTournament.id}`}
              className="inline-block px-8 py-4 text-white rounded-sm hover:opacity-90"
              style={{ background: 'var(--court)', fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}
            >
              {firstLiveTournament.flag_emoji && `${firstLiveTournament.flag_emoji} `}
              Start with {firstLiveTournament.location ?? firstLiveTournament.name} →
            </Link>
          ) : (
            <Link
              href="/tournaments"
              className="inline-block px-8 py-4 text-white rounded-sm hover:opacity-90"
              style={{ background: 'var(--court)', fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}
            >
              Browse tournaments →
            </Link>
          )}

          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.75rem', letterSpacing: '0.04em' }}>
            Free to play · ATP & WTA · 60+ tournaments per season
          </p>
        </div>

      </div>
    </main>
  )
}
