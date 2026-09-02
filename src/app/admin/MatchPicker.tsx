'use client'

import type { ReactNode } from 'react'

export interface PickerRow {
  id: string
  /** The matchup. A node, so the recap can mute its "d." and this one its "v". */
  title: ReactNode
  /** The evidence line under it. */
  subtitle: string
  /** Renders the subtitle in clay — the recap's upset badge. */
  alert?: boolean
}

/**
 * The checkbox list behind every match picker in the admin.
 *
 * Shared rather than written per picker because the lists have to behave
 * identically to be trustworthy: ticking past capacity must lock in all of
 * them, and "Reset to first N" has to mean the same thing on a recap as on an
 * up-next card. The rows differ only in what each line says, which is why that
 * is the one thing the caller supplies.
 *
 * It lives here, above the tournament routes, because it is no longer the
 * social studio's: the results page picks the ties that go into the points
 * email with the same control, and the two pickers choosing "which matches get
 * published" should not be able to drift apart in how they feel.
 */
export function MatchPicker({
  loading,
  error,
  capacity,
  chosenIds,
  rows,
  empty,
  onToggle,
  onReset,
  onClear,
}: {
  loading: boolean
  error?: string
  capacity: number
  chosenIds: string[]
  rows: PickerRow[]
  empty: string
  onToggle: (id: string) => void
  onReset: () => void
  onClear: () => void
}) {
  if (loading) {
    return (
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>Loading matches…</p>
    )
  }
  if (error) {
    return <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--clay)' }}>{error}</p>
  }

  return (
    <>
      <div
        className="flex flex-col gap-1 overflow-y-auto rounded-sm border bg-white p-1"
        style={{ borderColor: 'var(--chalk-dim)', maxHeight: '17rem' }}
      >
        {rows.map(r => {
          const checked = chosenIds.includes(r.id)
          // At capacity the unticked rows lock rather than silently dropping off
          // the card: the count in the label and the preview stay the same thing.
          const full = !checked && chosenIds.length >= capacity
          return (
            <label
              key={r.id}
              className="flex items-start gap-2 px-2 py-1.5 rounded-sm"
              style={{
                cursor: full ? 'not-allowed' : 'pointer',
                opacity: full ? 0.4 : 1,
                background: checked ? 'var(--chalk)' : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={full}
                onChange={() => onToggle(r.id)}
                className="mt-0.5 flex-shrink-0"
              />
              <span className="min-w-0 flex flex-col">
                <span
                  className="truncate"
                  style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--ink)' }}
                >
                  {r.title}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.6rem',
                    color: r.alert ? 'var(--clay)' : 'var(--muted)',
                  }}
                >
                  {r.subtitle}
                </span>
              </span>
            </label>
          )
        })}
        {rows.length === 0 && (
          <p className="px-2 py-1.5" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
            {empty}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onReset}
          className="text-left"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--court)' }}
        >
          Reset to first {capacity}
        </button>
        <button
          onClick={onClear}
          className="text-left"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}
        >
          Clear
        </button>
      </div>
    </>
  )
}

