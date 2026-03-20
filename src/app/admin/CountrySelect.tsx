'use client'

import { useState, useRef, useEffect } from 'react'
import { COUNTRIES, codeToFlag } from './countries'

interface CountrySelectProps {
  value: string                   // country name (e.g. "United States")
  onChange: (name: string) => void
  inputStyle?: React.CSSProperties
}

/**
 * Searchable country dropdown with flag emojis.
 * Accepts and emits the full country name as value.
 */
export default function CountrySelect({ value, onChange, inputStyle = {} }: CountrySelectProps) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Sync external value changes
  useEffect(() => { setQuery(value) }, [value])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = query.trim()
    ? COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.code.toLowerCase().includes(query.toLowerCase()),
      )
    : COUNTRIES

  function select(name: string) {
    setQuery(name)
    onChange(name)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search country…"
        style={{ ...inputStyle, width: '100%' }}
      />
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            zIndex: 50, maxHeight: '200px', overflowY: 'auto',
            background: 'white', border: '1px solid var(--chalk-dim)',
            borderTop: 'none', borderRadius: '0 0 2px 2px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
              No countries found
            </div>
          ) : (
            filtered.map(c => (
              <button
                key={c.code}
                type="button"
                onClick={() => select(c.name)}
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 transition-colors"
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
                  color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '8px',
                  background: value === c.name ? 'var(--chalk)' : 'transparent',
                }}
              >
                <span style={{ fontSize: '1rem' }}>{codeToFlag(c.code)}</span>
                <span>{c.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
