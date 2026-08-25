import Link from 'next/link'
import { Suspense } from 'react'
import NotificationBell from './NotificationBell'
import SiteNotices from './SiteNotices'
import ChatBubbleIconServer from './ChatBubbleIconServer'
import PostHogIdentify from './PostHogIdentify'

interface NavProps {
  username?: string | null
  points?: number
  activePage?: 'tournaments' | 'leaderboard' | 'leagues' | 'challenges' | 'achievements' | 'onboarding' | 'faq'
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
  // Desktop only. The mobile strip divides its width evenly, so a fifth link
  // drops every label to 75px — and measured at 375px that ellipsises
  // "Tournaments", "Leaderboard" and "Challenges" at once. The row's own comment
  // below says ellipsising is the signal to rethink rather than shave padding,
  // so on a phone help lives in the avatar menu and the footer instead, and the
  // four things people come here to DO keep the strip.
  { href: '/faq',         label: 'How it works', page: 'faq', desktopOnly: true },
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
    <>
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
                    <ChatBubbleIconServer />
                  </Suspense>
                  <Suspense fallback={null}>
                    <NotificationBell userId={userId} />
                  </Suspense>
                </>
              )}

              {/* User menu — <details> dropdown, no JS */}
              <details className="user-menu">
                {/* data-tour: the dashboard tour points here for "where your
                    account and email preferences live". Unlike the nav links
                    above (hidden below md) this is visible at every width. */}
                <summary aria-label="User menu" data-tour="user-menu">
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
                    href="/faq"
                    className={`user-menu-item${activePage === 'faq' ? ' nav-link-active' : ''}`}
                    role="menuitem"
                    style={activePage === 'faq' ? { fontWeight: 500 } : undefined}
                  >
                    How it works
                  </Link>
                  <Link
                    href="/onboarding"
                    className={`user-menu-item${activePage === 'onboarding' ? ' nav-link-active' : ''}`}
                    role="menuitem"
                    style={activePage === 'onboarding' ? { fontWeight: 500 } : undefined}
                  >
                    Getting started
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

      {/*
        Mobile nav links — four tabs sharing the width, hidden on md+.

        This was a horizontal scroller of `flex-shrink-0` tabs at `px-5`, which
        came to roughly 440px of content in a 375px viewport: the last tab read
        "Ch" on every page of the site, and `scrollbarWidth: none` meant nothing
        indicated it could be scrolled. Primary navigation is the worst place to
        hide a destination.

        `flex-1` divides the row four ways instead (~94px each at 375px), which
        fits every label whole.

        The size is a clamp rather than a fixed value because a fixed one only
        solves the width it was measured at: 0.7rem fits 375px exactly and
        ellipsised "Tournaments" and "Leaderboard" — the two labels that matter
        most — on a 320px phone. The clamp holds 0.7rem from 375px up and scales
        down below it, so the narrow case keeps whole words instead.

        Truncation is still set as a backstop, now for a fifth link rather than
        a narrow screen. If labels ever do ellipsise, that is the signal to
        rethink this row rather than shave another pixel off the padding.
      */}
      <div
        className="md:hidden flex border-t max-w-5xl mx-auto"
        style={{ borderColor: 'var(--chalk-dim)' }}
      >
        {NAV_LINKS.filter(link => !('desktopOnly' in link)).map(link => (
          <Link
            key={link.page}
            href={link.href}
            className="flex-1 min-w-0 px-1 py-2.5 text-center border-b-2 transition-colors overflow-hidden text-ellipsis whitespace-nowrap"
            style={{
              fontFamily: 'var(--font-mono)',
              // 2.99vw is 0.7rem at exactly 375px, so the cap takes over from
              // there up and only narrower screens scale down.
              fontSize: 'clamp(0.6rem, 2.99vw, 0.7rem)',
              letterSpacing: '0.02em',
              borderBottomColor: activePage === link.page ? 'var(--court)' : 'transparent',
              color: activePage === link.page ? 'var(--court)' : 'var(--muted)',
              fontWeight: activePage === link.page ? 600 : 400,
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>

      {/* Deletion warning banner.
          Stays INSIDE the sticky nav, unlike the site notice below: this one is
          account state the user has to act on, so following them down the page
          is the point. */}
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

    {/* Outside the sticky <nav>, so it scrolls away with the page.
        Pinning it would cost ~44px of every mobile viewport for a fortnight —
        the nav is navigation and earns its place at the top; an announcement
        read once does not.

        Rendered here rather than in the root layout because this is the one
        component that already knows whether there is an account to refer from,
        and because every route that mounts Nav has already resolved auth from
        cookies — which is what lets the notice read its own dismissal
        server-side instead of flashing on hydration. Verified against a build:
        no route changed rendering mode when this was added.

        Awaited rather than wrapped in Suspense, deliberately. Streaming it in
        behind a fallback would let the nav paint first and then push the whole
        page down when the notice arrives — reintroducing the layout shift the
        server-side dismissal read exists to avoid. getFeaturedSlam() resolves
        from a shared 5-minute cache entry, so the wait is a cache lookup on
        every request but the first after a deploy.

        SiteNotices picks which of the two bars runs — see the note there. The
        pick-gap branch adds one indexed per-user query on top of that cache
        lookup, and only for signed-in visitors. */}
    <SiteNotices userId={userId} />
    </>
  )
}
