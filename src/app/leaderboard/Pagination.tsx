import Link from 'next/link'

/**
 * URL-driven pager for the leaderboard.
 *
 * Server-rendered <Link>s, no client JS: the page number lives in the query
 * string, so every page is a real URL — shareable, back-button-correct, and
 * cacheable by the same `unstable_cache` slot the board already uses.
 *
 * Mobile keeps only Prev / "Page 3 of 12" / Next. A numbered strip at 375px
 * either overflows the container or shrinks each number below a usable tap
 * target; the numbers appear from `sm:` up, where there is room for them.
 */
export default function Pagination({
  page,
  totalPages,
  baseQuery,
}: {
  page: number
  totalPages: number
  /** Query string carrying scope/circuit/etc., without `page`. May be empty. */
  baseQuery: string
}) {
  if (totalPages <= 1) return null

  const href = (p: number) => `/leaderboard?${baseQuery ? `${baseQuery}&` : ''}page=${p}`
  const current = Math.min(Math.max(page, 1), totalPages)

  return (
    <nav
      aria-label="Leaderboard pages"
      className="mt-5 flex items-center justify-center gap-1.5 sm:gap-2"
    >
      <Step href={current > 1 ? href(current - 1) : undefined} label="← Prev" />

      {/* Mobile: position only. */}
      <span
        className="sm:hidden px-3"
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}
      >
        Page {current} of {totalPages}
      </span>

      {/* sm+: first / last / current ±1, with gaps collapsed to an ellipsis. */}
      <span className="hidden sm:flex items-center gap-1.5">
        {pageWindow(current, totalPages).map((p, i) =>
          p === 'gap' ? (
            <span
              key={`gap-${i}`}
              aria-hidden="true"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', padding: '0 2px' }}
            >
              …
            </span>
          ) : (
            <PageNumber key={p} href={href(p)} page={p} active={p === current} />
          ),
        )}
      </span>

      <Step href={current < totalPages ? href(current + 1) : undefined} label="Next →" />
    </nav>
  )
}

/**
 * Which page numbers to render: always the first and last, plus the current one
 * and its immediate neighbours. Any run of skipped pages collapses into a single
 * 'gap'. Keeps the strip a fixed width no matter how deep the board goes.
 */
function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  const wanted = [1, page - 1, page, page + 1, totalPages]
    .filter(p => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b)

  const out: (number | 'gap')[] = []
  let prev = 0
  for (const p of wanted) {
    if (p === prev) continue
    if (p - prev > 1) out.push('gap')
    out.push(p)
    prev = p
  }
  return out
}

const cellStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  letterSpacing: '0.03em',
  borderRadius: '2px',
  textDecoration: 'none',
  minWidth: '32px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

function PageNumber({ href, page, active }: { href: string; page: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="px-2.5 py-1.5 border transition-colors"
      style={{
        ...cellStyle,
        borderColor: active ? 'var(--court)' : 'var(--chalk-dim)',
        background: active ? 'var(--court)' : 'white',
        color: active ? '#fff' : 'var(--muted)',
        fontWeight: active ? 600 : 400,
      }}
    >
      {page}
    </Link>
  )
}

/** Prev/Next. Renders as inert text — not a link — at the ends of the board. */
function Step({ href, label }: { href?: string; label: string }) {
  const style: React.CSSProperties = {
    ...cellStyle,
    borderColor: 'var(--chalk-dim)',
    background: href ? 'white' : '#fafaf8',
    color: href ? 'var(--ink)' : 'var(--chalk-dim)',
    minWidth: 0,
  }

  if (!href) {
    return (
      <span aria-disabled="true" className="px-3 py-1.5 border whitespace-nowrap" style={style}>
        {label}
      </span>
    )
  }
  return (
    <Link href={href} className="px-3 py-1.5 border transition-colors whitespace-nowrap" style={style}>
      {label}
    </Link>
  )
}
