import Link from 'next/link'
import type { Metadata } from 'next'
import MarketingNav from '@/components/MarketingNav'
import Footer from '@/components/Footer'

/**
 * The 404 page.
 *
 * Added once 404s became reachable: until PR #112 a Suspense boundary around
 * the whole app meant notFound() rendered Next's built-in fallback with a 200
 * status, so nobody — user or crawler — ever landed here. Every bogus
 * tournament, league and challenge URL now arrives at this page.
 *
 * MarketingNav rather than Nav: Nav wants a session (username, points,
 * userId), and a 404 should not pay for an auth round trip to decorate a dead
 * end. The signed-out chrome is also the right frame for the visitor this page
 * mostly gets, who followed a stale link from outside the app.
 *
 * noindex is belt-and-braces. The 404 status is what actually keeps this out of
 * the index; the tag costs nothing and covers the case where something ahead of
 * us rewrites the status.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--chalk)' }}>
      <MarketingNav />

      <div className="flex-1 max-w-5xl w-full mx-auto px-4 md:px-8 py-16 md:py-24">
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            marginBottom: '12px',
          }}
        >
          404 — Not found
        </p>

        <h1
          className="text-3xl md:text-4xl"
          style={{
            fontFamily: 'var(--font-display)',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            marginBottom: '12px',
            maxWidth: '20ch',
          }}
        >
          Out. That page isn&rsquo;t here.
        </h1>

        <p style={{ color: 'var(--muted)', maxWidth: '52ch', marginBottom: '32px' }}>
          The link may be mistyped, or it may point at a tournament edition we
          don&rsquo;t have. Nothing is broken — the page simply doesn&rsquo;t exist.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <Link
            href="/tournaments"
            className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90"
            style={{ background: 'var(--court)', color: 'white', textDecoration: 'none' }}
          >
            Browse tournaments
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90"
            style={{
              background: 'white',
              color: 'var(--ink)',
              textDecoration: 'none',
              border: '1px solid var(--chalk-dim)',
            }}
          >
            Go to the homepage
          </Link>
        </div>

        {/* A dead end with no onward path is what makes a 404 feel like a
            failure. These are the three places a lost visitor plausibly wanted. */}
        <div
          className="mt-12 pt-8 border-t"
          style={{ borderColor: 'var(--chalk-dim)', maxWidth: '52ch' }}
        >
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              marginBottom: '12px',
            }}
          >
            Try instead
          </p>
          <ul className="flex flex-col gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <li>
              <Link href="/tournaments" style={{ color: 'var(--court)' }}>
                Every ATP and WTA draw
              </Link>
            </li>
            <li>
              <Link href="/leaderboard" style={{ color: 'var(--court)' }}>
                The leaderboard
              </Link>
            </li>
            <li>
              <Link href="/onboarding" style={{ color: 'var(--court)' }}>
                How the bracket challenge works
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <Footer />
    </main>
  )
}
