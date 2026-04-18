import Link from 'next/link'
import { Suspense } from 'react'
import NotificationBell from './NotificationBell'
import ChatBubbleIconServer from './ChatBubbleIconServer'
import PostHogIdentify from './PostHogIdentify'

interface NavProps {
  username?: string | null
  points?: number
  activePage?: 'tournaments' | 'leaderboard' | 'leagues' | 'challenges' | 'achievements' | 'onboarding'
  userId?: string | null
  deletionRequestedAt?: string | null
}

// Primary nav — the "what users come here to do" links.
// "How it works" and "Achievements" live in the avatar dropdown now.
const NAV_LINKS = [
  { href: '/tournaments', label: 'Tournaments', page: 'tournaments' },
  { href: '/leaderboard', label: 'Leaderboard', page: 'leaderboard' },
  { href: '/leagues',     label: 'Leagues',     page: 'leagues'     },
  { href: '/challenges',  label: 'Challenges',  page: 'challenges'  },
] as const

export default function Nav({ username, activePage, userId, deletionRequestedAt }: NavProps) {
  const isGuest = !username
  const deletionDate = deletionRequestedAt
    ? new Date(new Date(deletionRequestedAt).getTime() + 7 * 24 * 60 * 60 * 1000)
    : null

  // Admin check — shown in the avatar dropdown only. Mirrors the rule used
  // elsewhere (ADMIN_USER_IDS env list, plus any logged-in user in dev).
  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const isDev    = process.env.NODE_ENV === 'development'
  const isAdmin  = !!userId && (isDev || adminIds.includes(userId))

  // Avatar dropdown is rendered as a <details> element so it works without JS
  // and keeps Nav a server component. Trade-off: doesn't auto-close on outside
  // click — acceptable because menu items are links that navigate away.
  const userMenuOpen = false // placeholder for clarity; <details> is stateful itself

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

        /* Avatar dropdown trigger */
        .user-menu {
          position: relative;
        }
        .user-menu > summary {
          list-style: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 3px;
          transition: background 0.15s ease;
          user-select: none;
        }
        .user-menu > summary::-webkit-details-marker { display: none; }
        .user-menu > summary:hover { background: var(--chalk); }
        .user-menu[open] > summary { background: var(--chalk); }

        .user-menu .chevron {
          transition: transform 0.15s ease;
          opacity: 0.6;
        }
        .user-menu[open] .chevron { transform: rotate(180deg); }

        .user-menu-panel {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          min-width: 180px;
          background: white;
          border: 1px solid var(--chalk-dim);
          border-radius: 4px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
          padding: 6px;
          z-index: 60;
        }
        .user-menu-item {
          display: block;
          width: 100%;
          padding: 8px 10px;
          font-size: 0.825rem;
          color: var(--ink);
          text-align: left;
          background: none;
          border: none;
          cursor: pointer;
          border-radius: 2px;
          font-family: inherit;
          transition: background 0.12s ease;
        }
        .user-menu-item:hover { background: var(--chalk); }
        .user-menu-divider {
          height: 1px;
          background: var(--chalk-dim);
          margin: 6px 0;
        }

        /* Avatar circle */
        .avatar-circle {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: var(--chalk);
          border: 1px solid var(--chalk-dim);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
          font-size: 0.72rem;
          color: var(--ink);
          text-transform: uppercase;
          flex-shrink: 0;
        }
      `}</style>

      {/* Main row */}
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

        {/* Right: icons + user menu (or sign-in) */}
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
                  <PostHogIdentify userId={userId} username={username!} />
                  <Suspense fallback={null}>
                    <ChatBubbleIconServer userId={userId} />
                  </Suspense>
                  <Suspense fallback={null}>
                    <NotificationBell userId={userId} />
                  </Suspense>
                </>
              )}

              {/* User menu — <details> dropdown, no JS */}
              <details className="user-menu">
                <summary aria-label="User menu">
                  <span className="avatar-circle" aria-hidden="true">
                    {username!.charAt(0)}
                  </span>
                  <span
                    className="hidden sm:inline"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8rem',
                      color: 'var(--muted)',
                    }}
                  >
                    {username}
                  </span>
                  <svg
                    className="chevron"
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <div className="user-menu-panel" role="menu">
                  <Link href={`/profile/${username}`} className="user-menu-item" role="menuitem">
                    Profile
                  </Link>
                  <Link
                    href={`/profile/${username}?tab=achievements`}
                    className={`user-menu-item${activePage === 'achievements' ? ' nav-link-active' : ''}`}
                    role="menuitem"
                    style={activePage === 'achievements' ? { fontWeight: 500 } : undefined}
                  >
                    Achievements
                  </Link>
                  <Link
                    href="/invite"
                    className="user-menu-item"
                    role="menuitem"
                  >
                    Invite a friend
                  </Link>
                  <Link
                    href="/onboarding"
                    className={`user-menu-item${activePage === 'onboarding' ? ' nav-link-active' : ''}`}
                    role="menuitem"
                    style={activePage === 'onboarding' ? { fontWeight: 500 } : undefined}
                  >
                    How it works
                  </Link>
                  {isAdmin && (
                    <>
                      <div className="user-menu-divider" />
                      <Link
                        href="/admin"
                        className="user-menu-item"
                        role="menuitem"
                      >
                        Admin
                      </Link>
                    </>
                  )}
                  <div className="user-menu-divider" />
                  <form action="/auth/logout" method="post">
                    <button type="submit" className="user-menu-item" role="menuitem">
                      Sign out
                    </button>
                  </form>
                </div>
              </details>
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
      </div>

      {/* Deletion warning banner */}
      {deletionDate && (
        <div className="px-4 md:px-8 py-2 text-center" style={{ background: '#FFF9E6', borderBottom: '1px solid #E8C47A' }}>
          <p style={{ fontSize: '0.75rem', color: '#7A5C00', fontFamily: 'var(--font-mono)' }}>
            Your account is scheduled for deletion on {deletionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.{' '}
            <Link href={`/profile/${username}`} style={{ color: '#993C1D', textDecoration: 'underline' }}>
              Cancel
            </Link>
          </p>
        </div>
      )}
    </nav>
  )
}
