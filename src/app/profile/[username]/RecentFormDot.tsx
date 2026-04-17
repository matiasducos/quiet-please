'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

interface RecentFormDotProps {
  letter:          string
  color:           string
  tournamentId:    string
  tournamentName:  string
  tournamentFlag?: string | null
  meaning:         string
}

/**
 * One circle in the "Recent form" strip on the profile page.
 *
 * Hover (desktop) or tap (mobile) reveals a popover with:
 *   - the tournament name
 *   - what the letter means ("Your pick became champion", etc.)
 *   - a link through to the tournament page
 *
 * Native <Link> click still works as a tap-through on mobile because we
 * keep the dot itself a <button> and the "View tournament" action a <Link>
 * inside the popover.
 */
export default function RecentFormDot({
  letter, color, tournamentId, tournamentName, tournamentFlag, meaning,
}: RecentFormDotProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  // Close on outside click (mobile: otherwise the popover stays open)
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  const ariaLabel = `${tournamentName} — ${meaning}`

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        title={ariaLabel}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(v => !v)
        }}
        style={{
          width: '34px', height: '34px', borderRadius: '50%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.72rem',
          color: '#fff', background: color, border: 'none', cursor: 'pointer',
          padding: 0,
        }}
      >
        {letter}
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            minWidth: '220px',
            maxWidth: '260px',
            background: '#fff',
            border: '1px solid var(--chalk-dim)',
            borderRadius: '4px',
            padding: '10px 12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            pointerEvents: 'auto',
          }}
        >
          {/* Arrow */}
          <span
            aria-hidden
            style={{
              position: 'absolute', top: '-5px', left: '50%', transform: 'translateX(-50%) rotate(45deg)',
              width: '8px', height: '8px', background: '#fff',
              borderTop: '1px solid var(--chalk-dim)', borderLeft: '1px solid var(--chalk-dim)',
            }}
          />
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.92rem', color: 'var(--ink)', lineHeight: 1.15, marginBottom: '3px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            {tournamentFlag && (
              <span aria-hidden style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.95rem', flexShrink: 0 }}>
                {tournamentFlag}
              </span>
            )}
            <span>{tournamentName}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.4, marginBottom: '8px' }}>
            {meaning}
          </div>
          <Link
            href={`/tournaments/${tournamentId}`}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--court)', textDecoration: 'none', letterSpacing: '0.03em' }}
          >
            View tournament →
          </Link>
        </div>
      )}
    </span>
  )
}
