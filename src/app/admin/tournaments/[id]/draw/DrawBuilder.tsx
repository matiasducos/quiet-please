'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import Link from 'next/link'
import { searchPlayers, createPlayer, buildDraw } from '../../../actions'

type PlayerOption = { external_id: string; name: string; country: string }

interface DrawBuilderProps {
  tournamentId: string
  tournamentName: string
  drawSize: number
  tour: 'ATP' | 'WTA'
}

// ── Searchable player combobox ─────────────────────────────────────────────────

function PlayerCombobox({
  value,
  onChange,
  tour,
  placeholder,
  existingSelections,
}: {
  value: PlayerOption | 'BYE' | null
  onChange: (p: PlayerOption | 'BYE' | null) => void
  tour: 'ATP' | 'WTA'
  placeholder: string
  existingSelections: Set<string>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlayerOption[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCountry, setNewCountry] = useState('')
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setShowNewForm(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const { players } = await searchPlayers(q, tour)
      setResults(players)
    } finally {
      setSearching(false)
    }
  }, [tour])

  function handleInputChange(val: string) {
    setQuery(val)
    setOpen(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(val), 250)
  }

  function selectPlayer(p: PlayerOption) {
    onChange(p)
    setQuery('')
    setOpen(false)
    setResults([])
  }

  function selectBye() {
    onChange('BYE')
    setQuery('')
    setOpen(false)
    setResults([])
  }

  function clearSelection() {
    onChange(null)
    setQuery('')
  }

  async function handleCreatePlayer(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const { ok, player } = await createPlayer({ name: newName.trim(), country: newCountry.trim(), tour })
      if (ok && player) {
        selectPlayer({ external_id: player.external_id, name: player.name, country: player.country })
        setNewName('')
        setNewCountry('')
        setShowNewForm(false)
      }
    } finally {
      setCreating(false)
    }
  }

  // Show selected value
  if (value === 'BYE') {
    return (
      <div className="flex items-center gap-2">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic' }}>BYE</span>
        <button type="button" onClick={clearSelection} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#991b1b', cursor: 'pointer', background: 'none', border: 'none' }}>✕</button>
      </div>
    )
  }

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--ink)' }}>{value.name}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>{value.country}</span>
        <button type="button" onClick={clearSelection} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#991b1b', cursor: 'pointer', background: 'none', border: 'none' }}>✕</button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <input
        value={query}
        onChange={e => handleInputChange(e.target.value)}
        onFocus={() => { if (query.trim()) setOpen(true) }}
        placeholder={placeholder}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
          padding: '4px 8px', border: '1px solid var(--chalk-dim)',
          borderRadius: '2px', width: '100%', background: 'white',
        }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'white', border: '1px solid var(--chalk-dim)',
          borderRadius: '2px', maxHeight: '200px', overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        }}>
          {/* BYE option */}
          <div
            onClick={selectBye}
            style={{
              padding: '6px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
              color: 'var(--muted)', fontStyle: 'italic', borderBottom: '1px solid var(--chalk-dim)',
            }}
            onMouseOver={e => (e.currentTarget.style.background = 'var(--chalk)')}
            onMouseOut={e => (e.currentTarget.style.background = 'white')}
          >
            BYE
          </div>

          {searching && (
            <div style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
              Searching...
            </div>
          )}

          {results.map(p => {
            const alreadyUsed = existingSelections.has(p.external_id)
            return (
              <div
                key={p.external_id}
                onClick={() => !alreadyUsed && selectPlayer(p)}
                style={{
                  padding: '6px 8px', cursor: alreadyUsed ? 'default' : 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                  opacity: alreadyUsed ? 0.4 : 1,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
                onMouseOver={e => { if (!alreadyUsed) e.currentTarget.style.background = 'var(--chalk)' }}
                onMouseOut={e => (e.currentTarget.style.background = 'white')}
              >
                <span style={{ color: 'var(--ink)' }}>{p.name}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{p.country}</span>
              </div>
            )
          })}

          {!searching && query.trim() && results.length === 0 && (
            <div style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
              No players found
            </div>
          )}

          {/* Create new player */}
          {!showNewForm ? (
            <div
              onClick={() => { setShowNewForm(true); setNewName(query) }}
              style={{
                padding: '6px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                color: 'var(--court)', borderTop: '1px solid var(--chalk-dim)',
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'var(--chalk)')}
              onMouseOut={e => (e.currentTarget.style.background = 'white')}
            >
              + Create new player
            </div>
          ) : (
            <form onSubmit={handleCreatePlayer} style={{ padding: '8px', borderTop: '1px solid var(--chalk-dim)', display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Name"
                autoFocus
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', padding: '3px 6px', border: '1px solid var(--chalk-dim)', borderRadius: '2px', flex: 1 }}
              />
              <input
                value={newCountry}
                onChange={e => setNewCountry(e.target.value)}
                placeholder="CTY"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', padding: '3px 6px', border: '1px solid var(--chalk-dim)', borderRadius: '2px', width: '50px' }}
              />
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.65rem', padding: '3px 8px',
                  background: 'var(--court)', color: 'white', border: 'none', borderRadius: '2px',
                  cursor: 'pointer', opacity: creating ? 0.5 : 1,
                }}
              >
                {creating ? '...' : 'Add'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main DrawBuilder ──────────────────────────────────────────────────────────

export default function DrawBuilder({ tournamentId, tournamentName, drawSize, tour }: DrawBuilderProps) {
  const matchCount = drawSize / 2
  type Slot = PlayerOption | 'BYE' | null

  const [slots, setSlots] = useState<Array<{ player1: Slot; player2: Slot }>>(
    Array.from({ length: matchCount }, () => ({ player1: null, player2: null }))
  )

  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })

  // Track all selected player external_ids to prevent duplicates
  const existingSelections = new Set<string>()
  for (const slot of slots) {
    if (slot.player1 && slot.player1 !== 'BYE') existingSelections.add(slot.player1.external_id)
    if (slot.player2 && slot.player2 !== 'BYE') existingSelections.add(slot.player2.external_id)
  }

  function updateSlot(index: number, side: 'player1' | 'player2', value: Slot) {
    setSlots(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [side]: value }
      return next
    })
  }

  // Count filled slots
  const filledCount = slots.filter(s => s.player1 !== null && s.player2 !== null).length

  async function handleSave() {
    setStatus({ type: 'loading' })
    try {
      const payload = slots.map(s => ({
        player1ExternalId: s.player1 === 'BYE' ? null : (s.player1?.external_id ?? null),
        player2ExternalId: s.player2 === 'BYE' ? null : (s.player2?.external_id ?? null),
      }))
      const { ok, error, matchCount: mc } = await buildDraw(tournamentId, payload)
      if (ok) {
        setStatus({ type: 'success', message: `Draw saved with ${mc} matches. Predictions are now open.` })
      } else {
        setStatus({ type: 'error', message: error ?? 'Failed to save draw' })
      }
    } catch (err) {
      setStatus({ type: 'error', message: String(err) })
    }
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Build Draw
          </span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {tournamentName}
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Build the first-round draw ({matchCount} matches, {drawSize}-player bracket). Select players or mark as BYE.
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            {filledCount}/{matchCount} matches filled
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {slots.map((slot, i) => (
            <div key={i} className="bg-white rounded-sm border p-3" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="flex items-center gap-3">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', width: '28px', textAlign: 'right', flexShrink: 0 }}>
                  M{i + 1}
                </span>
                <div style={{ flex: 1 }}>
                  <PlayerCombobox
                    value={slot.player1}
                    onChange={v => updateSlot(i, 'player1', v)}
                    tour={tour}
                    placeholder="Player 1..."
                    existingSelections={existingSelections}
                  />
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>vs</span>
                <div style={{ flex: 1 }}>
                  <PlayerCombobox
                    value={slot.player2}
                    onChange={v => updateSlot(i, 'player2', v)}
                    tour={tour}
                    placeholder="Player 2..."
                    existingSelections={existingSelections}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {status.type === 'error' && (
          <div className="mt-4 p-3 rounded-sm" style={{ background: '#fee2e2', borderLeft: '3px solid #ef4444' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#991b1b' }}>
              {status.message}
            </p>
          </div>
        )}

        {status.type === 'success' && (
          <div className="mt-4 p-3 rounded-sm" style={{ background: '#f0fdf4', borderLeft: '3px solid #22c55e' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#166534' }}>
              {status.message}
            </p>
            <div className="flex gap-3 mt-2">
              <Link
                href={`/admin/tournaments/${tournamentId}/results`}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--court)' }}
              >
                Enter Results &rarr;
              </Link>
              <Link
                href="/admin"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}
              >
                Back to Admin
              </Link>
            </div>
          </div>
        )}

        {status.type !== 'success' && (
          <button
            onClick={handleSave}
            disabled={status.type === 'loading' || filledCount === 0}
            className="mt-6 px-6 py-2 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--court)', color: 'white' }}
          >
            {status.type === 'loading' ? 'Saving...' : `Save Draw (${filledCount}/${matchCount} matches)`}
          </button>
        )}
      </div>
    </main>
  )
}
