import Link from 'next/link'

export interface ScopeItem {
  key: string
  label: string
  href?: string              // omit for disabled items
  active: boolean
  disabledReason?: string    // tooltip when no href
}

/**
 * Segmented control for leaderboard scope selection (Worldwide / Country /
 * City / My community). Four connected cells with a single outer border and
 * thin dividers — one active cell is filled green, others stay transparent.
 *
 * Responsive: falls back to horizontal scroll on screens narrow enough that
 * all four labels don't fit. Accepts a bare-text label like "My community"
 * without truncation — we'd rather scroll than cut it mid-word.
 */
export default function ScopeSegmented({ items }: { items: ScopeItem[] }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
      <div
        className="inline-flex rounded-sm border overflow-hidden"
        style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}
      >
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          const baseStyle: React.CSSProperties = {
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            letterSpacing: '0.03em',
            padding: '8px 14px',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            borderRight: isLast ? 'none' : '1px solid var(--chalk-dim)',
            transition: 'background 0.12s ease, color 0.12s ease',
            userSelect: 'none',
          }

          if (item.active) {
            return (
              <span
                key={item.key}
                style={{
                  ...baseStyle,
                  background: '#eaf3de',
                  color: 'var(--court-dark)',
                  fontWeight: 600,
                }}
              >
                {item.label}
              </span>
            )
          }

          if (!item.href) {
            return (
              <span
                key={item.key}
                title={item.disabledReason}
                style={{
                  ...baseStyle,
                  color: 'var(--chalk-dim)',
                  background: 'transparent',
                  cursor: 'not-allowed',
                }}
              >
                {item.label}
              </span>
            )
          }

          return (
            <Link
              key={item.key}
              href={item.href}
              style={{
                ...baseStyle,
                color: 'var(--muted)',
                background: 'transparent',
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
