import Link from 'next/link'
import type { ReactNode } from 'react'

export interface ScopeItem {
  key: string
  label: string
  href?: string              // omit for disabled items
  active: boolean
  disabledReason?: string    // tooltip when no href
  /** Optional leading icon — emoji string or <CountryFlag/> etc. */
  icon?: ReactNode
}

/**
 * Segmented control for leaderboard scope selection (Worldwide / Country /
 * City / My community). Connected cells with a single outer border and thin
 * dividers — one active cell is filled green, the others stay white.
 *
 * Responsive: a single row from `sm:` up, a 2×2 grid below it. It used to be a
 * horizontal scroller instead, on the reasoning that scrolling beat cutting a
 * label like "My community" mid-word. It ended up doing both: at 375px the
 * fourth cell rendered as "My c", and `scrollbarWidth: none` removed the only
 * hint that there was anything to scroll to. Wrapping keeps every label whole,
 * which was the actual goal, and costs one row of height.
 *
 * Dividers come from a 1px grid gap over a chalk-dim background rather than
 * per-cell borders. Border-side logic has to know each cell's position, which
 * is knowable in a row and awkward in a wrapping grid; the gap draws correct
 * dividers in both layouts without the cells knowing anything.
 */
export default function ScopeSegmented({ items }: { items: ScopeItem[] }) {
  return (
    <div>
      <div
        className="grid grid-cols-2 sm:inline-flex rounded-sm border overflow-hidden"
        style={{ borderColor: 'var(--chalk-dim)', background: 'var(--chalk-dim)', gap: '1px' }}
      >
        {items.map((item) => {
          const baseStyle: React.CSSProperties = {
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            letterSpacing: '0.03em',
            padding: '8px 14px',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            transition: 'background 0.12s ease, color 0.12s ease',
            userSelect: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            lineHeight: 1,
          }

          // Icon gets a tiny dim when the cell is disabled so it doesn't
          // visually dominate a muted label.
          const iconWrap = (icon: ReactNode, dim: boolean) => (
            <span
              aria-hidden
              style={{
                fontSize: '0.95em',
                display: 'inline-flex',
                alignItems: 'center',
                opacity: dim ? 0.45 : 1,
              }}
            >
              {icon}
            </span>
          )

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
                {item.icon && iconWrap(item.icon, false)}
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
                  background: 'white',
                  cursor: 'not-allowed',
                }}
              >
                {item.icon && iconWrap(item.icon, true)}
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
                background: 'white',
              }}
            >
              {item.icon && iconWrap(item.icon, false)}
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
