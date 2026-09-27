'use client'

import { useEffect, useId, useRef, useState } from 'react'
import IntentLink from './IntentLink'
import type { SwitcherItem } from '@/lib/tournaments/switcher'

/**
 * ‹ Hangzhou ▾ › — step between tournaments without a trip back to a list.
 *
 * Modelled on the ATP app's header: the arrows go to the neighbour, the name
 * opens the whole list so a jump across five tournaments is one tap, not four.
 * The arrows wrap, because "next" off the end of a list of live events has no
 * better meaning than the first one.
 *
 * Every destination is a `<Link>` (via IntentLink) with an href decided on the server
 * (see `src/lib/tournaments/switcher.ts`), so the navigation progress bar picks
 * the click up from its document listener with nothing wired here.
 *
 * `IntentLink`: a hover (or the touchstart just before a tap)
 * prefetches the whole next page, not just its shell, so the click lands on
 * data that is already in the browser. Safe here because these links are few
 * and a hover on them is nearly always followed by the click — unlike a list of
 * cards, where every touch that starts a scroll would prefetch a page.
 *
 * Renders nothing when there is nowhere to go: fewer than two items, or a page
 * that is not itself on the list — arrows relative to a position you are not
 * in would have no honest meaning.
 */

const STATUS_CHIP: Record<string, { label: string; color: string; bg: string; dot?: boolean }> = {
  in_progress: { label: 'Live', color: '#c84b31', bg: '#fdf2ed', dot: true },
  accepting_predictions: { label: 'Open', color: 'var(--court)', bg: '#edf7f0' },
  draw_published: { label: 'Draw out', color: '#4338ca', bg: '#eef2ff' },
  upcoming: { label: 'Upcoming', color: 'var(--muted)', bg: 'var(--chalk)' },
  completed: { label: 'Done', color: 'var(--muted)', bg: 'var(--chalk)' },
}

function StatusChip({ status }: { status: string }) {
  const chip = STATUS_CHIP[status] ?? { label: status, color: 'var(--muted)', bg: 'var(--chalk)' }
  return (
    <span
      className="inline-flex items-center gap-1 flex-shrink-0"
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.6rem',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: chip.color,
        background: chip.bg,
        padding: '2px 7px',
        borderRadius: '2px',
      }}
    >
      {chip.dot && <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: chip.color }} />}
      {chip.label}
    </span>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' | 'down' }) {
  const d = dir === 'left' ? 'M10 3L5 8l5 5' : dir === 'right' ? 'M6 3l5 5-5 5' : 'M4 6l4 4 4-4'
  return (
    <svg width={dir === 'down' ? 10 : 14} height={dir === 'down' ? 10 : 14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const arrowStyle: React.CSSProperties = {
  width: 40,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--ink)',
}

export default function TournamentSwitcher({
  items,
  currentHref,
  className = '',
}: {
  items: SwitcherItem[]
  /** The href of the page being viewed, as the server built it for `items`. */
  currentHref: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Close on a click anywhere else, or Escape. Subscribed only while open.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const index = items.findIndex(i => i.href === currentHref)
  if (index === -1 || items.length < 2) return null

  const current = items[index]
  const prev = items[(index - 1 + items.length) % items.length]
  const next = items[(index + 1) % items.length]

  return (
    <div
      ref={rootRef}
      className={`relative flex items-stretch rounded-sm border bg-white ${className}`}
      style={{ borderColor: 'var(--chalk-dim)', height: 40 }}
    >
      <IntentLink
        href={prev.href}
        aria-label={`Previous tournament: ${prev.subtitle}`}
        title={prev.subtitle}
        className="hover:bg-[var(--chalk)] transition-colors"
        style={{ ...arrowStyle, borderRight: '1px solid var(--chalk-dim)' }}
      >
        <Chevron dir="left" />
      </IntentLink>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={listId}
        title={current.subtitle}
        className="flex-1 min-w-0 flex items-center justify-center gap-2 px-3 hover:bg-[var(--chalk)] transition-colors"
      >
        {current.flag && <span aria-hidden="true">{current.flag}</span>}
        <span
          className="truncate"
          style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', letterSpacing: '-0.01em', color: 'var(--ink)' }}
        >
          {current.title}
        </span>
        <span style={{ color: 'var(--muted)', display: 'flex' }}><Chevron dir="down" /></span>
        <span className="flex-shrink-0" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
          {index + 1}/{items.length}
        </span>
      </button>

      <IntentLink
        href={next.href}
        aria-label={`Next tournament: ${next.subtitle}`}
        title={next.subtitle}
        className="hover:bg-[var(--chalk)] transition-colors"
        style={{ ...arrowStyle, borderLeft: '1px solid var(--chalk-dim)' }}
      >
        <Chevron dir="right" />
      </IntentLink>

      {open && (
        <ul
          id={listId}
          className="absolute left-0 right-0 rounded-sm border bg-white overflow-y-auto"
          style={{
            top: 'calc(100% + 4px)',
            minWidth: 260,
            maxHeight: '60vh',
            borderColor: 'var(--chalk-dim)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            zIndex: 60,
          }}
        >
          {items.map((item, i) => {
            const isCurrent = i === index
            return (
              <li key={item.href} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--chalk-dim)' }}>
                <IntentLink
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isCurrent ? 'page' : undefined}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--chalk)] transition-colors"
                  style={{ background: isCurrent ? 'var(--chalk)' : undefined }}
                >
                  <span aria-hidden="true" style={{ width: 20, flexShrink: 0 }}>{item.flag ?? ''}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate" style={{ fontSize: '0.9rem', color: 'var(--ink)', fontWeight: isCurrent ? 600 : 400 }}>
                      {item.title}
                    </span>
                    <span className="block truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                      {item.subtitle}
                    </span>
                  </span>
                  <StatusChip status={item.status} />
                </IntentLink>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
