import Link from 'next/link'
import { Suspense } from 'react'
import NotificationBell from './NotificationBell'
import ChatBubbleIconServer from './ChatBubbleIconServer'

interface NavProps {
  username?: string | null
  points?: number
  activePage?: 'tournaments' | 'leaderboard' | 'leagues' | 'challenges' | 'onboarding'
  userId?: string | null
}

const NAV_LINKS = [
  { href: '/tournaments',      label: 'Tournaments',  page: 'tournaments'  },
  { href: '/leaderboard',      label: 'Leaderboard',  page: 'leaderboard'  },
  { href: '/leagues',          label: 'Leagues',      page: 'leagues'      },
  { href: '/challenges',       label: 'Challenges',   page: 'challenges'   },
  { href: '/onboarding',       label: 'How it works', page: 'onboarding'   },
] as const

export default function Nav({ username, points = 0, activePage, userId }: NavProps) {
  const isGuest = !username

  return (
    <nav className="sticky top-0 z-50 bg-white border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
      <style>{`
        .nav-link {
          display: inline-block;
          transition: color 0.15s ease, transform 0.15s ease;
        }
        .nav-link:not(.nav-link-active):hover {
          color: var(--ink) !important;
          transform: translateY(-1px);
        }
        .nav-link-active {
          color: var(--ink) !important;
        }
        .sign-out-btn {
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .sign-out-btn:hover {
          background: var(--chalk) !important;
          border-color: var(--muted) !important;
        }
      `}</style>

      {/* Main row: logo + (desktop links) + user area */}
      <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-8 py-3 md:py-5">

        {/* Left: logo + desktop links */}
        <div className="flex items-center gap-6 md:gap-8 min-w-0">
          <Link
            href={isGuest ? '/tournaments' : '/dashboard'}
            style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: 'var(--ink)', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            Quiet Please
          </Link>

          {/* Desktop nav links — hidden on mobile */}
          <div className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map(link => (
              <Link
                key={link.page}
                href={link.href}
                data-tour={`nav-${link.page}`}
                className={`nav-link${activePage === link.page ? ' nav-link-active' : ''}`}
                style={{
                  fontSize: '0.875rem',
                  color: activePage === link.page ? 'var(--ink)' : 'var(--muted)',
                  fontWeight: activePage === link.page ? 500 : 400,
                }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Right: user info or sign-in */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {isGuest ? (
            <Link
              href="/login"
              style={{ fontSize: '0.875rem', color: 'var(--court)', fontWeight: 500 }}
            >
              Sign in
            </Link>
          ) : (
            <>
              {userId && (
                <>
                  <Suspense fallback={null}>
                    <ChatBubbleIconServer userId={userId} />
                  </Suspense>
                  <Suspense fallback={null}>
                    <NotificationBell userId={userId} />
                  </Suspense>
                </>
              )}
              <Link
                href={`/profile/${username}`}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none' }}
              >
                {username}
              </Link>
              <form action="/auth/logout" method="post" className="hidden md:block">
                <button
                  type="submit"
                  className="sign-out-btn"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    letterSpacing: '0.03em',
                    color: 'var(--ink)',
                    background: 'white',
                    border: '1px solid var(--chalk-dim)',
                    borderRadius: '2px',
                    cursor: 'pointer',
                    padding: '4px 10px',
                    lineHeight: 1,
                  }}
                >
                  Sign out
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Mobile nav links — scrollable row, hidden on md+ */}
      <div
        className="md:hidden flex border-t overflow-x-auto max-w-5xl mx-auto"
        style={{ borderColor: 'var(--chalk-dim)', scrollbarWidth: 'none' }}
      >
        {NAV_LINKS.map(link => (
          <Link
            key={link.page}
            href={link.href}
            className="flex-shrink-0 px-5 py-2.5 text-xs border-b-2 transition-colors"
            style={{
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
              borderBottomColor: activePage === link.page ? 'var(--court)' : 'transparent',
              color: activePage === link.page ? 'var(--court)' : 'var(--muted)',
              fontWeight: activePage === link.page ? 600 : 400,
            }}
          >
            {link.label}
          </Link>
        ))}
        {/* Sign out — visible only on mobile, at end of scrollable row */}
        {!isGuest && (
          <form action="/auth/logout" method="post" className="flex-shrink-0">
            <button
              type="submit"
              className="px-5 py-2.5 text-xs border-b-2 transition-colors"
              style={{
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em',
                borderBottomColor: 'transparent',
                color: 'var(--muted)',
                background: 'none',
                border: 'none',
                borderBottom: '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </form>
        )}
      </div>

    </nav>
  )
}
