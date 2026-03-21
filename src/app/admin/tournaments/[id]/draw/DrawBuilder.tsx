'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import Link from 'next/link'
import { searchPlayers, createPlayer, buildDraw } from '../../../actions'

type PlayerOption = { external_id: string; name: string; country: string }

interface DrawBuilderProps {
  tournamentId: string
  tournamentName: string
  tournamentLocation?: string | null
  flagEmoji?: string | null
  drawSize: number
  tour: 'ATP' | 'WTA'
  existingSlots?: Array<{
    player1: PlayerOption | 'BYE' | null
    player2: PlayerOption | 'BYE' | null
  }>
}

const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']
const ROUND_LABELS: Record<string, string> = {
  R128: 'R128', R64: 'R64', R32: 'R32',
  R16: 'R16', QF: 'Quarterfinals', SF: 'Semifinals', F: 'Final',
}

// Compute which rounds exist for a given draw size
function getRounds(drawSize: number): string[] {
  const startMap: Record<number, number> = { 128: 0, 64: 1, 32: 2 }
  const startIdx = startMap[drawSize] ?? 2
  return ROUND_ORDER.slice(startIdx)
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
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic' }}>BYE</span>
        <button type="button" onClick={clearSelection} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#991b1b', cursor: 'pointer', background: 'none', border: 'none' }}>✕</button>
      </div>
    )
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', letterSpacing: '-0.01em', color: 'var(--ink)' }}>{value.name}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>{value.country}</span>
        <button type="button" onClick={clearSelection} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#991b1b', cursor: 'pointer', background: 'none', border: 'none', marginLeft: 'auto' }}>✕</button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => handleInputChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
          padding: '8px 12px', border: 'none',
          width: '100%', background: 'transparent',
          outline: 'none',
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

// ── Match card (editable first-round slot) ──────────────────────────────────────

function MatchCard({
  matchNumber,
  player1,
  player2,
  onChangeP1,
  onChangeP2,
  tour,
  existingSelections,
}: {
  matchNumber: number
  player1: PlayerOption | 'BYE' | null
  player2: PlayerOption | 'BYE' | null
  onChangeP1: (v: PlayerOption | 'BYE' | null) => void
  onChangeP2: (v: PlayerOption | 'BYE' | null) => void
  tour: 'ATP' | 'WTA'
  existingSelections: Set<string>
}) {
  const isFilled = player1 !== null && player2 !== null

  return (
    <div
      className="bg-white rounded-sm border"
      style={{
        borderColor: isFilled ? 'var(--court)' : 'var(--chalk-dim)',
        borderLeftWidth: '3px',
        borderLeftColor: isFilled ? 'var(--court)' : 'transparent',
      }}
    >
      {/* Match header */}
      <div className="px-3 py-1.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>
          MATCH {matchNumber}
        </span>
        {isFilled && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--court)', letterSpacing: '0.04em' }}>
            ✓
          </span>
        )}
      </div>

      {/* Player 1 */}
      <div className="border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        <PlayerCombobox
          value={player1}
          onChange={onChangeP1}
          tour={tour}
          placeholder="Player 1..."
          existingSelections={existingSelections}
        />
      </div>

      {/* VS divider */}
      <div className="flex items-center justify-center py-0.5" style={{ background: '#fafaf8' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>VS</span>
      </div>

      {/* Player 2 */}
      <div>
        <PlayerCombobox
          value={player2}
          onChange={onChangeP2}
          tour={tour}
          placeholder="Player 2..."
          existingSelections={existingSelections}
        />
      </div>
    </div>
  )
}

// ── TBD match card (later rounds, non-editable) ─────────────────────────────────

function TBDMatchCard({ matchNumber }: { matchNumber: number }) {
  return (
    <div className="bg-white rounded-sm border" style={{ borderColor: 'var(--chalk-dim)', opacity: 0.5 }}>
      <div className="px-3 py-1.5 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.05em' }}>
          MATCH {matchNumber}
        </span>
      </div>
      <div className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--muted)' }}>TBD</span>
      </div>
      <div className="flex items-center justify-center py-0.5" style={{ background: '#fafaf8' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>VS</span>
      </div>
      <div className="px-3 py-2.5">
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--muted)' }}>TBD</span>
      </div>
    </div>
  )
}

// ── Bracket connector (right-side ⊣ shape) ──────────────────────────────────────

function BracketConnector() {
  return (
    <div style={{ width: '20px', position: 'relative', flexShrink: 0, alignSelf: 'stretch' }}>
      <div style={{
        position: 'absolute',
        top: '25%',
        bottom: '25%',
        left: '4px',
        right: 0,
        borderTop: '1.5px solid var(--muted)',
        borderRight: '1.5px solid var(--muted)',
        borderBottom: '1.5px solid var(--muted)',
        borderRadius: '0 3px 3px 0',
      }} />
    </div>
  )
}

// ── Main DrawBuilder ──────────────────────────────────────────────────────────

export default function DrawBuilder({ tournamentId, tournamentName, tournamentLocation, flagEmoji, drawSize, tour, existingSlots }: DrawBuilderProps) {
  const matchCount = drawSize / 2
  type Slot = PlayerOption | 'BYE' | null

  const rounds = getRounds(drawSize)
  const firstRound = rounds[0]
  const [activeRound, setActiveRound] = useState(firstRound)

  // Compute match counts per round
  const matchesByRound: Record<string, number> = {}
  let roundMatchCount = matchCount
  for (const round of rounds) {
    matchesByRound[round] = roundMatchCount
    roundMatchCount = Math.ceil(roundMatchCount / 2)
  }

  // State for first-round matches — initialized from existing draw data if available
  const [slots, setSlots] = useState<Array<{ player1: Slot; player2: Slot }>>(() => {
    if (existingSlots && existingSlots.length === matchCount) {
      return existingSlots
    }
    return Array.from({ length: matchCount }, () => ({ player1: null, player2: null }))
  })

  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })
  const [lastSaveMessage, setLastSaveMessage] = useState<string | null>(null)

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
        setLastSaveMessage(`Draw saved with ${mc} matches. Predictions are now open.`)
        setStatus({ type: 'idle' })  // Reset so Save button stays visible for further edits
      } else {
        setStatus({ type: 'error', message: error ?? 'Failed to save draw' })
      }
    } catch (err) {
      setStatus({ type: 'error', message: String(err) })
    }
  }

  // Group matches into bracket pairs for active round
  function getGroups(): number[][] {
    const count = matchesByRound[activeRound] ?? 0
    const groups: number[][] = []
    for (let i = 0; i < count; i += 2) {
      if (i + 1 < count) {
        groups.push([i, i + 1])
      } else {
        groups.push([i])
      }
    }
    return groups
  }

  // Compute global match number offset for non-first rounds
  function getGlobalMatchOffset(round: string): number {
    let offset = 0
    for (const r of rounds) {
      if (r === round) return offset
      offset += matchesByRound[r]
    }
    return offset
  }

  const isFirstRound = activeRound === firstRound
  const groups = getGroups()
  const globalOffset = getGlobalMatchOffset(activeRound)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      {/* Sticky top: nav + round tabs */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-6 py-4">
            <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
              &larr; Admin
            </Link>
            <div className="flex items-center gap-3">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                {filledCount}/{matchCount} matches
              </span>
              <button
                onClick={handleSave}
                disabled={status.type === 'loading' || filledCount === 0}
                className="px-4 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--court)', color: 'white' }}
              >
                {status.type === 'loading' ? 'Saving...' : 'Save Draw'}
              </button>
            </div>
          </div>
        </nav>

        {/* Round tabs */}
        <div className="border-b bg-white overflow-x-auto" style={{ borderColor: 'var(--chalk-dim)', scrollbarWidth: 'none' }}>
          <div className="max-w-5xl mx-auto flex px-4 md:px-6">
            {rounds.map(round => (
              <button
                key={round}
                onClick={() => setActiveRound(round)}
                className="px-5 py-3 text-xs whitespace-nowrap border-b-2 transition-colors flex-shrink-0"
                style={{
                  borderBottomColor: activeRound === round ? 'var(--court)' : 'transparent',
                  color: activeRound === round ? 'var(--court)' : 'var(--muted)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em',
                }}
              >
                {ROUND_LABELS[round] ?? round}
                {round === firstRound && (
                  <span style={{ marginLeft: '4px', fontSize: '0.6rem', opacity: 0.6 }}>
                    ({matchesByRound[round]})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-5">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
            {flagEmoji && <span style={{ marginRight: '6px' }}>{flagEmoji}</span>}
            {tournamentLocation ?? tournamentName}
          </h1>
          {tournamentLocation && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px' }}>{tournamentName}</p>
          )}
          <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
            {isFirstRound
              ? `Build the first-round draw (${matchCount} matches, ${drawSize}-player bracket). Select players or mark as BYE.`
              : `${ROUND_LABELS[activeRound] ?? activeRound} — ${matchesByRound[activeRound]} matches. These are filled automatically when results are entered.`
            }
          </p>
        </div>
      </div>

      {/* Match cards */}
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">
        <div className="flex flex-col gap-6">
          {groups.map((group, gi) => (
            <div key={gi} className="flex items-stretch">
              {/* Match cards column */}
              <div className="flex flex-col gap-3 flex-1">
                {group.map(idx => {
                  const matchNum = globalOffset + idx + 1

                  if (isFirstRound) {
                    return (
                      <MatchCard
                        key={idx}
                        matchNumber={matchNum}
                        player1={slots[idx].player1}
                        player2={slots[idx].player2}
                        onChangeP1={v => updateSlot(idx, 'player1', v)}
                        onChangeP2={v => updateSlot(idx, 'player2', v)}
                        tour={tour}
                        existingSelections={existingSelections}
                      />
                    )
                  }

                  return <TBDMatchCard key={idx} matchNumber={matchNum} />
                })}
              </div>

              {/* Bracket connector between paired matches */}
              {group.length === 2 && <BracketConnector />}
            </div>
          ))}
        </div>

        {/* Round navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => {
              const idx = rounds.indexOf(activeRound)
              if (idx > 0) setActiveRound(rounds[idx - 1])
            }}
            disabled={rounds.indexOf(activeRound) === 0}
            className="px-4 py-2 text-sm rounded-sm border transition-colors disabled:opacity-30"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
          >
            ← Previous
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
            {ROUND_LABELS[activeRound] ?? activeRound}
          </span>
          <button
            onClick={() => {
              const idx = rounds.indexOf(activeRound)
              if (idx < rounds.length - 1) setActiveRound(rounds[idx + 1])
            }}
            disabled={rounds.indexOf(activeRound) === rounds.length - 1}
            className="px-4 py-2 text-sm rounded-sm border transition-colors disabled:opacity-30"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
          >
            Next →
          </button>
        </div>

        {/* Status messages */}
        {status.type === 'error' && (
          <div className="mt-4 p-3 rounded-sm" style={{ background: '#fee2e2', borderLeft: '3px solid #ef4444' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#991b1b' }}>
              {status.message}
            </p>
          </div>
        )}

        {lastSaveMessage && (
          <div className="mt-4 p-3 rounded-sm" style={{ background: '#f0fdf4', borderLeft: '3px solid #22c55e' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#166534' }}>
              {lastSaveMessage}
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

        {/* Bottom save button — always visible */}
        <div className="mt-8 pt-6 border-t flex items-center justify-between" style={{ borderColor: 'var(--chalk-dim)' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            {filledCount} of {matchCount} matches filled
          </span>
          <button
            onClick={handleSave}
            disabled={status.type === 'loading' || filledCount === 0}
            className="px-6 py-2.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--court)', color: 'white' }}
          >
            {status.type === 'loading' ? 'Saving...' : 'Save Draw'}
          </button>
        </div>
      </div>
    </main>
  )
}
