'use client'

import { useState } from 'react'

interface Props {
  month: string        // e.g. "March 2026"
  count: number        // number of tournaments in this month
  defaultOpen: boolean // current/future months open; past months closed
  children: React.ReactNode
}

export default function TournamentMonthGroup({ month, count, defaultOpen, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-8">
      {/* ── Month header ──────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between mb-4 group"
        style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left' }}
      >
        <div className="flex items-baseline gap-3">
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.35rem',
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              lineHeight: 1,
            }}
          >
            {month}
          </h2>
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

        {/* Chevron — rotates when closed */}
        <span
          style={{
            display: 'inline-block',
            color: 'var(--muted)',
            fontSize: '0.75rem',
            transition: 'transform 0.2s ease',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            marginRight: '2px',
          }}
        >
          ▾
        </span>
      </button>

      {/* Divider */}
      <div style={{ height: '1px', background: 'var(--chalk-dim)', marginBottom: '1rem' }} />

      {/* Cards grid */}
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {children}
        </div>
      )}
    </div>
  )
}
