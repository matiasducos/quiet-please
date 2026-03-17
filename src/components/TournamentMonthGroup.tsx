'use client'

import { useState } from 'react'

interface Props {
  month: string        // e.g. "March 2026"
  count: number
  defaultOpen: boolean
  children: React.ReactNode
}

export default function TournamentMonthGroup({ month, count, defaultOpen, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ marginBottom: '10px' }}>

      {/* ── Clickable header row ─────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between"
        style={{
          background: 'white',
          border: '1px solid var(--chalk-dim)',
          borderRadius: open ? '4px 4px 0 0' : '4px',
          padding: '14px 18px',
          textAlign: 'left',
          cursor: 'pointer',
          boxShadow: '0 2px 6px rgba(0,0,0,0.07)',
          transition: 'box-shadow 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.2rem',
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              lineHeight: 1,
            }}
          >
            {month}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.65rem',
              color: 'var(--muted)',
              letterSpacing: '0.04em',
            }}
          >
            {count} {count === 1 ? 'tournament' : 'tournaments'}
          </span>
        </div>

        {/* Chevron — rotates 90° when collapsed */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            background: 'var(--chalk)',
            color: open ? 'var(--court)' : 'var(--ink)',
            fontSize: '1rem',
            flexShrink: 0,
            transition: 'transform 0.2s ease, color 0.15s ease',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        >
          ▾
        </span>
      </button>

      {/* ── Expanded cards ───────────────────────────────────────────── */}
      {open && (
        <div
          style={{
            border: '1px solid var(--chalk-dim)',
            borderTop: 'none',
            borderRadius: '0 0 4px 4px',
            padding: '14px',
            background: 'var(--chalk)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
