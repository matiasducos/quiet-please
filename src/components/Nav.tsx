import Link from 'next/link'

interface NavProps {
  username?: string | null
  points?: number
  activePage?: 'tournaments' | 'leaderboard' | 'leagues' | 'test'
}

export default function Nav({ username, points = 0, activePage }: NavProps) {
  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-8 py-5 border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex items-center gap-8">
        <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--ink)' }}>
          Quiet Please
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/tournaments" style={{ fontSize: '0.875rem', color: activePage === 'tournaments' ? 'var(--ink)' : 'var(--muted)', fontWeight: activePage === 'tournaments' ? 500 : 400 }}>
            Tournaments
          </Link>
          <Link href="/leaderboard" style={{ fontSize: '0.875rem', color: activePage === 'leaderboard' ? 'var(--ink)' : 'var(--muted)', fontWeight: activePage === 'leaderboard' ? 500 : 400 }}>
            Leaderboard
          </Link>
          <Link href="/leagues" style={{ fontSize: '0.875rem', color: activePage === 'leagues' ? 'var(--ink)' : 'var(--muted)', fontWeight: activePage === 'leagues' ? 500 : 400 }}>
            Leagues
          </Link>
          <Link href="/test-tournaments" style={{ fontSize: '0.875rem', color: activePage === 'test' ? 'var(--ink)' : 'var(--muted)', fontWeight: activePage === 'test' ? 500 : 400 }}>
            Sandbox
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {username ? (
          <Link href={`/profile/${username}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none' }}>{username}</Link>
        ) : null}
        <span className="score-pill">{points} pts</span>
        <form action="/auth/logout" method="post">
          <button type="submit" style={{ fontSize: '0.8rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
