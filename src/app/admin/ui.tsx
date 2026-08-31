'use client'

/**
 * Small presentational pieces shared by the admin browsers.
 *
 * These started as local declarations inside PredictionBrowser; they are lifted
 * here so the leagues and challenges browsers read the same way rather than
 * growing their own near-identical copies.
 */

import { mono } from './format'

/**
 * Re-exported from a plain module, not declared here.
 *
 * Everything a `'use client'` file exports becomes a client reference, so a
 * server component can render it but never call it. Keeping these two in
 * format.ts is what lets the server-rendered admin pages use them; the
 * re-export keeps the `from '../ui'` imports in the client browsers working.
 */
export { mono, when } from './format'

export const control = {
  ...mono,
  fontSize: '0.8rem',
  padding: '6px 10px',
  border: '1px solid var(--chalk-dim)',
  borderRadius: '2px',
  background: 'white',
  color: 'var(--ink)',
} as const

export const ALERT = '#991b1b'

export function Segmented<T extends string>({
  value, options, onChange,
}: {
  value: T
  options: Array<{ key: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className="px-2.5 py-1.5 transition-opacity hover:opacity-80"
          style={{
            ...mono, fontSize: '0.68rem', whiteSpace: 'nowrap',
            background: value === o.key ? 'var(--ink)' : 'white',
            color: value === o.key ? 'white' : 'var(--muted)',
            border: 'none', cursor: 'pointer',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export type ChipTone = 'muted' | 'alert' | 'court' | 'good' | 'warn'

export function Chip({ text, tone = 'muted' }: { text: string; tone?: ChipTone }) {
  const colors = {
    muted: { color: 'var(--muted)', background: 'var(--chalk)' },
    alert: { color: ALERT, background: '#fee2e2' },
    court: { color: 'var(--court)', background: '#eef4ff' },
    good: { color: '#166534', background: '#edf7f0' },
    warn: { color: '#92400e', background: '#fef3c7' },
  }[tone]
  return (
    <span style={{ ...mono, fontSize: '0.6rem', padding: '1px 6px', borderRadius: '9999px', ...colors }}>
      {text}
    </span>
  )
}

/** The shared page chrome: back-to-admin bar with a section label. */
export function AdminHeader({ label }: { label: string }) {
  return (
    <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-6 py-4">
        <a href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
          &larr; Admin
        </a>
        <span style={{ ...mono, fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
    </nav>
  )
}

/**
 * Shown when an RPC is missing because its migration has not been applied yet.
 * The project is not linked locally, so migrations are run by hand in the
 * Supabase dashboard and there is a real window where this happens.
 */
export function MigrationNotice({ file }: { file: string }) {
  return (
    <div className="rounded-sm border px-4 py-3" style={{ borderColor: '#fbbf24', background: '#fffbeb' }}>
      <p style={{ ...mono, fontSize: '0.75rem', color: '#92400e', lineHeight: 1.6 }}>
        This page needs a database function that isn&apos;t there yet. Run{' '}
        <strong>{file}</strong> in the Supabase SQL editor, then reload.
      </p>
    </div>
  )
}

export function Pager({
  page, hasMore, onPrev, onNext, rangeFrom, rangeTo, total,
}: {
  page: number
  hasMore: boolean
  onPrev: () => void
  onNext: () => void
  rangeFrom: number
  rangeTo: number
  /** Omitted when the exact size of the set isn't known. */
  total?: number
}) {
  if (page === 0 && !hasMore) return null
  const btn = {
    ...mono, fontSize: '0.7rem', borderColor: 'var(--chalk-dim)',
    color: 'var(--muted)', background: 'white',
  } as const
  return (
    <div className="flex items-center gap-3 mt-6 flex-wrap">
      <button
        onClick={onPrev}
        disabled={page === 0}
        className="px-3 py-1 rounded-sm border transition-opacity hover:opacity-70 disabled:opacity-30"
        style={btn}
      >
        ← Prev
      </button>
      <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>
        {rangeFrom}–{rangeTo}{total !== undefined ? ` of ${total.toLocaleString()}` : ''}
      </span>
      <button
        onClick={onNext}
        disabled={!hasMore}
        className="px-3 py-1 rounded-sm border transition-opacity hover:opacity-70 disabled:opacity-30"
        style={btn}
      >
        Next →
      </button>
    </div>
  )
}
