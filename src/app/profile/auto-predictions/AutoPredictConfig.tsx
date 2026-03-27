'use client'

import { useState, useCallback, useRef } from 'react'
import type { AutoPredictConfig as Config } from './actions'
import { searchPlayersForAutoPredict, saveAutoPredictList, removeAutoPredictOverride } from './actions'

type PlayerSlot = { externalId: string; name: string; priority: number }
type RealSurface = 'hard' | 'clay' | 'grass'
type Tour = 'ATP' | 'WTA'

const SURFACES: { key: RealSurface; label: string }[] = [
  { key: 'hard', label: 'Hard' },
  { key: 'clay', label: 'Clay' },
  { key: 'grass', label: 'Grass' },
]

const monoSm = { fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }
const monoXs = { fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }

export default function AutoPredictConfig({ initialConfig }: { initialConfig: Config }) {
  const [config, setConfig] = useState(initialConfig)

  return (
    <div className="mt-8 space-y-10">
      <TourSection
        tour="ATP"
        surfaces={config.atp}
        onUpdate={(surfaces) => setConfig(c => ({ ...c, atp: surfaces }))}
      />
      <TourSection
        tour="WTA"
        surfaces={config.wta}
        onUpdate={(surfaces) => setConfig(c => ({ ...c, wta: surfaces }))}
      />
    </div>
  )
}

function TourSection({
  tour,
  surfaces,
  onUpdate,
}: {
  tour: Tour
  surfaces: { default: PlayerSlot[]; hard: PlayerSlot[]; clay: PlayerSlot[]; grass: PlayerSlot[] }
  onUpdate: (s: typeof surfaces) => void
}) {
  const [expandedOverrides, setExpandedOverrides] = useState<Set<RealSurface>>(
    new Set(SURFACES.filter(s => surfaces[s.key].length > 0).map(s => s.key))
  )

  const toggleOverride = (surface: RealSurface) => {
    setExpandedOverrides(prev => {
      const next = new Set(prev)
      if (next.has(surface)) {
        next.delete(surface)
      } else {
        next.add(surface)
      }
      return next
    })
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em' }}>
        {tour}
      </h2>

      {/* Default list */}
      <div className="mt-3">
        <p style={{ ...monoXs, color: 'var(--muted)', marginBottom: '0.5rem' }}>
          Default — applies to all surfaces without an override
        </p>
        <PlayerList
          tour={tour}
          surface={null}
          players={surfaces.default}
          onSaved={(players) => onUpdate({ ...surfaces, default: players })}
        />
      </div>

      {/* Surface overrides */}
      <div className="mt-6">
        <p style={{ ...monoXs, color: 'var(--muted)', marginBottom: '0.5rem' }}>
          Surface overrides
        </p>
        <div className="space-y-2">
          {SURFACES.map(({ key, label }) => (
            <div key={key} className="border rounded-sm" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
              <button
                onClick={() => toggleOverride(key)}
                className="w-full flex items-center justify-between px-4 py-3 hover:opacity-80"
                style={monoSm}
              >
                <span>{label}</span>
                <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                  {surfaces[key].length > 0 ? `${surfaces[key].length} player${surfaces[key].length !== 1 ? 's' : ''}` : 'Using default'}
                  {' '}{expandedOverrides.has(key) ? '▾' : '▸'}
                </span>
              </button>
              {expandedOverrides.has(key) && (
                <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--chalk-dim)' }}>
                  <PlayerList
                    tour={tour}
                    surface={key}
                    players={surfaces[key]}
                    onSaved={(players) => onUpdate({ ...surfaces, [key]: players })}
                    onRemoveOverride={async () => {
                      await removeAutoPredictOverride(tour, key)
                      onUpdate({ ...surfaces, [key]: [] })
                      toggleOverride(key)
                    }}
                    hasOverride={surfaces[key].length > 0}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PlayerList({
  tour,
  surface,
  players: initialPlayers,
  onSaved,
  onRemoveOverride,
  hasOverride,
}: {
  tour: Tour
  surface: 'hard' | 'clay' | 'grass' | null
  players: PlayerSlot[]
  onSaved: (players: PlayerSlot[]) => void
  onRemoveOverride?: () => Promise<void>
  hasOverride?: boolean
}) {
  const [players, setPlayers] = useState<PlayerSlot[]>(initialPlayers)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message?: string }>({ type: 'idle' })
  const [addingSlot, setAddingSlot] = useState(false)

  const isDirty = JSON.stringify(players) !== JSON.stringify(initialPlayers)

  const handleSave = async () => {
    setSaving(true)
    setStatus({ type: 'idle' })
    const result = await saveAutoPredictList(tour, surface, players)
    setSaving(false)
    if (result.ok) {
      setStatus({ type: 'success', message: 'Saved' })
      onSaved(players)
      setTimeout(() => setStatus({ type: 'idle' }), 2000)
    } else {
      setStatus({ type: 'error', message: result.error ?? 'Save failed' })
    }
  }

  const removePlayer = (externalId: string) => {
    const filtered = players.filter(p => p.externalId !== externalId)
    // Re-assign priorities to be contiguous
    setPlayers(filtered.map((p, i) => ({ ...p, priority: i + 1 })))
  }

  const addPlayer = (player: { external_id: string; name: string }) => {
    if (players.length >= 5) return
    if (players.some(p => p.externalId === player.external_id)) return
    setPlayers([...players, {
      externalId: player.external_id,
      name: player.name,
      priority: players.length + 1,
    }])
    setAddingSlot(false)
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    const next = [...players]
    const temp = next[index - 1]
    next[index - 1] = { ...next[index], priority: index }
    next[index] = { ...temp, priority: index + 1 }
    setPlayers(next)
  }

  const moveDown = (index: number) => {
    if (index === players.length - 1) return
    const next = [...players]
    const temp = next[index + 1]
    next[index + 1] = { ...next[index], priority: index + 2 }
    next[index] = { ...temp, priority: index + 1 }
    setPlayers(next)
  }

  return (
    <div className="mt-2">
      {players.length === 0 && !addingSlot && (
        <p style={{ ...monoXs, color: 'var(--muted)', padding: '0.5rem 0' }}>
          No players selected
        </p>
      )}

      {/* Player slots */}
      <div className="space-y-1.5">
        {players.map((p, i) => (
          <div
            key={p.externalId}
            className="flex items-center gap-2 px-3 py-2 border rounded-sm"
            style={{ borderColor: 'var(--chalk-dim)', background: '#fafafa' }}
          >
            <span
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-white"
              style={{ background: 'var(--court)', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}
            >
              {p.priority}
            </span>
            <span className="flex-1 truncate" style={monoSm}>
              {p.name}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => moveUp(i)}
                disabled={i === 0}
                className="px-1.5 py-0.5 rounded-sm border"
                style={{ ...monoXs, borderColor: 'var(--chalk-dim)', opacity: i === 0 ? 0.3 : 1 }}
                title="Move up"
              >
                ↑
              </button>
              <button
                onClick={() => moveDown(i)}
                disabled={i === players.length - 1}
                className="px-1.5 py-0.5 rounded-sm border"
                style={{ ...monoXs, borderColor: 'var(--chalk-dim)', opacity: i === players.length - 1 ? 0.3 : 1 }}
                title="Move down"
              >
                ↓
              </button>
              <button
                onClick={() => removePlayer(p.externalId)}
                className="px-1.5 py-0.5 rounded-sm border"
                style={{ ...monoXs, borderColor: '#fecaca', color: '#dc2626' }}
                title="Remove"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add player search */}
      {addingSlot ? (
        <PlayerSearch
          tour={tour}
          exclude={players.map(p => p.externalId)}
          onSelect={addPlayer}
          onCancel={() => setAddingSlot(false)}
        />
      ) : players.length < 5 && (
        <button
          onClick={() => setAddingSlot(true)}
          className="mt-2 px-3 py-1.5 border rounded-sm hover:opacity-80"
          style={{ ...monoXs, borderColor: 'var(--chalk-dim)', color: 'var(--court)' }}
        >
          + Add player
        </button>
      )}

      {/* Save / Remove override */}
      <div className="flex items-center gap-3 mt-3">
        {isDirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-sm text-white hover:opacity-90"
            style={{ ...monoSm, background: 'var(--court)', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
        {hasOverride && onRemoveOverride && (
          <button
            onClick={onRemoveOverride}
            className="px-3 py-1.5 rounded-sm border hover:opacity-80"
            style={{ ...monoXs, borderColor: '#fecaca', color: '#dc2626' }}
          >
            Remove override
          </button>
        )}
        {status.type === 'success' && (
          <span style={{ ...monoXs, color: '#16a34a' }}>{status.message}</span>
        )}
        {status.type === 'error' && (
          <span style={{ ...monoXs, color: '#dc2626' }}>{status.message}</span>
        )}
      </div>
    </div>
  )
}

function PlayerSearch({
  tour,
  exclude,
  onSelect,
  onCancel,
}: {
  tour: Tour
  exclude: string[]
  onSelect: (player: { external_id: string; name: string }) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ external_id: string; name: string; country: string }>>([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const { players } = await searchPlayersForAutoPredict(q, tour)
      setResults(players.filter(p => !exclude.includes(p.external_id)))
    } finally {
      setSearching(false)
    }
  }, [tour, exclude])

  const handleChange = (value: string) => {
    setQuery(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(value), 300)
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={e => handleChange(e.target.value)}
          placeholder="Search player name..."
          className="flex-1 px-3 py-2 border rounded-sm"
          style={{ ...monoSm, borderColor: 'var(--chalk-dim)', outline: 'none' }}
        />
        <button
          onClick={onCancel}
          className="px-3 py-2 border rounded-sm hover:opacity-80"
          style={{ ...monoXs, borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
        >
          Cancel
        </button>
      </div>

      {searching && (
        <p style={{ ...monoXs, color: 'var(--muted)', padding: '0.5rem 0' }}>Searching...</p>
      )}

      {!searching && query.trim() && results.length === 0 && (
        <p style={{ ...monoXs, color: 'var(--muted)', padding: '0.5rem 0' }}>No players found</p>
      )}

      {results.length > 0 && (
        <div
          className="mt-1 border rounded-sm max-h-48 overflow-y-auto"
          style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}
        >
          {results.map(p => (
            <button
              key={p.external_id}
              onClick={() => onSelect(p)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
              style={{ ...monoSm, borderColor: 'var(--chalk-dim)' }}
            >
              {p.name}
              <span style={{ color: 'var(--muted)', marginLeft: '0.5rem', fontSize: '0.7rem' }}>
                {p.country}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
