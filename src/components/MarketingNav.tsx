import Link from 'next/link'
import TrackedCTA from '@/components/TrackedCTA'

/**
 * Nav for logged-out marketing surfaces (homepage, slam landing pages).
 *
 * Deliberately not `Nav.tsx` — that one is the product nav (Tournaments /
 * Leaderboard / Leagues / Challenges) aimed at people who already have an
 * account. Someone arriving from a Google search for "wimbledon bracket
 * challenge" needs one obvious way in, not four internal destinations.
 *
 * Every control is min-h-[44px]: these are the highest-intent links on the
 * page and the first thing thumbed on a phone.
 */
export default function MarketingNav() {
  return (
    <nav className="border-b sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)', background: 'var(--chalk)' }}>
      <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-8 py-3 md:py-5">
        <div className="flex items-center gap-4 md:gap-6">
          <Link href="/" className="whitespace-nowrap" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)', textDecoration: 'none' }}>
            Quiet Please
          </Link>
          <Link href="/onboarding" className="hidden md:inline-flex items-center min-h-[44px]" style={{ fontSize: '0.875rem', color: 'var(--muted)', textDecoration: 'none' }}>
            How it works
          </Link>
        </div>
        <div className="flex items-center gap-1 md:gap-3">
          <Link href="/onboarding" className="md:hidden inline-flex items-center min-h-[44px] px-2" style={{ fontSize: '0.75rem', color: 'var(--muted)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            How it works
          </Link>
          <Link href="/login" className="inline-flex items-center min-h-[44px] px-2" style={{ color: 'var(--muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
            Sign in
          </Link>
          {/* Tracked like the in-page CTAs: this is the one signup control
              present on every marketing surface and at every scroll depth, so
              leaving it as a bare Link left the busiest path to /signup as the
              only untracked one. */}
          <TrackedCTA href="/signup" location="nav" className="inline-flex items-center justify-center min-h-[44px] px-4 text-xs md:text-sm text-white rounded-sm hover:opacity-90 whitespace-nowrap" style={{ background: 'var(--court)' }}>
            Get started
          </TrackedCTA>
        </div>
      </div>
    </nav>
  )
}
