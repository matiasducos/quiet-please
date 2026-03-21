'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { createPlayer, searchPlayers, seedPlayersFromDraws, seedPlayersFromApi } from '../actions'

type Player = { id: string; external_id: string; name: string; country: string; tour: string }

export default function PlayerManager() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Player[]>([])
  const [searching, setSearching] = useState(false)

  // Add player form
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [tour, setTour] = useState<'ATP' | 'WTA'>('ATP')
  const [adding, setAdding] = useState(false)
  const [addStatus, setAddStatus] = useState<{ type: 'idle' | 'success' | 'error'; message?: string }>({ type: 'idle' })

  // Seed from draws
  const [seedStatus, setSeedStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })

  async function handleSeed() {
    setSeedStatus({ type: 'loading' })
    try {
      const { ok, imported, error } = await seedPlayersFromDraws()
      if (ok) {
        setSeedStatus({ type: 'success', message: `Imported ${imported} players from existing draws` })
      } else {
        setSeedStatus({ type: 'error', message: error ?? 'Failed' })
      }
    } catch (err) {
      setSeedStatus({ type: 'error', message: String(err) })
    }
  }

  // Seed from API (legacy — scans fixtures)
  const [apiSeedStatus, setApiSeedStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' })

  async function handleApiSeed() {
    setApiSeedStatus({ type: 'loading' })
    try {
      const { ok, imported, tournamentsScanned, error } = await seedPlayersFromApi()
      if (ok) {
        setApiSeedStatus({ type: 'success', message: `Imported ${imported} players from ${tournamentsScanned} tournaments` })
      } else {
        setApiSeedStatus({ type: 'error', message: error ?? 'Failed' })
      }
    } catch (err) {
      setApiSeedStatus({ type: 'error', message: String(err) })
    }
  }

  // Reset & full import from get_players API (progressive batches)
  const [resetImportStatus, setResetImportStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string; progress?: string }>({ type: 'idle' })

  async function callImportApi(body: Record<string, unknown>) {
    const res = await fetch('/api/admin/import-players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Server error ${res.status}. ${text.length < 200 ? text : 'Request failed.'}`)
    }
    return res.json()
  }

  async function handleResetAndImport() {
    if (!confirm('This will delete ALL existing players and re-import from the Tennis API. Continue?')) return
    setResetImportStatus({ type: 'loading', progress: 'Deleting players & fetching tournament list…' })
    try {
      // Phase 1: Delete all players + get tournament list
      const init = await callImportApi({ action: 'init' })
      if (!init.ok) {
        setResetImportStatus({ type: 'error', message: init.error ?? 'Init failed' })
        return
      }

      const tournaments: { key: string; tour: string }[] = init.tournaments ?? []
      if (tournaments.length === 0) {
        setResetImportStatus({ type: 'success', message: `Deleted ${init.deleted ?? 0} players. No tournaments found to import from.` })
        return
      }

      // Phase 2: Process tournaments in batches of 10
      const BATCH_SIZE = 10
      let totalImported = 0
      let totalErrors = 0

      for (let i = 0; i < tournaments.length; i += BATCH_SIZE) {
        const batch = tournaments.slice(i, i + BATCH_SIZE)
        const batchNum = Math.floor(i / BATCH_SIZE) + 1
        const totalBatches = Math.ceil(tournaments.length / BATCH_SIZE)
        setResetImportStatus({
          type: 'loading',
          progress: `Batch ${batchNum}/${totalBatches} — ${totalImported} players imported so far…`,
        })

        const result = await callImportApi({ action: 'batch', tournaments: batch })
        if (!result.ok) {
          setResetImportStatus({ type: 'error', message: `Batch ${batchNum} failed: ${result.error}. ${totalImported} players imported before failure.` })
          return
        }
        totalImported += result.imported ?? 0
        totalErrors += result.errors ?? 0
      }

      setResetImportStatus({
        type: 'success',
        message: `Deleted ${init.deleted ?? 0}, imported ${totalImported} players from ${tournaments.length} tournaments${totalErrors ? ` (${totalErrors} API errors)` : ''}`,
      })
      if (query.trim()) doSearch(query)
    } catch (err) {
      setResetImportStatus({ type: 'error', message: String(err) })
    }
  }

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    try {
      const { players } = await searchPlayers(q)
      setResults(players)
    } finally {
      setSearching(false)
    }
  }, [])

  // Debounced search
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  function handleQueryChange(value: string) {
    setQuery(value)
    if (timer) clearTimeout(timer)
    setTimer(setTimeout(() => doSearch(value), 300))
  }

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setAdding(true)
    setAddStatus({ type: 'idle' })
    try {
      const { ok, player, error } = await createPlayer({ name: name.trim(), country: country.trim(), tour })
      if (ok && player) {
        setAddStatus({ type: 'success', message: `Added ${player.name} (${player.external_id})` })
        setName('')
        setCountry('')
        // Refresh search if there's an active query
        if (query.trim()) doSearch(query)
      } else {
        setAddStatus({ type: 'error', message: error ?? 'Failed to create player' })
      }
    } catch (err) {
      setAddStatus({ type: 'error', message: String(err) })
    } finally {
      setAdding(false)
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
            Players
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Manage Players
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Add players to the registry for use when building draws.
          </p>
        </div>

        {/* Reset & Import from API */}
        <div className="bg-white rounded-sm border p-5 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '4px' }}>
            Reset &amp; Import from Tennis API
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '12px' }}>
            Deletes all existing players, then fetches every ATP &amp; WTA player via <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>get_players</code> per tournament. This may take a few minutes.
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleResetAndImport}
                disabled={resetImportStatus.type === 'loading'}
                className="px-4 py-1.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: '#991b1b', color: 'white' }}
              >
                {resetImportStatus.type === 'loading' ? 'Importing…' : 'Delete All & Re-import'}
              </button>
              {resetImportStatus.type !== 'idle' && resetImportStatus.type !== 'loading' && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                  color: resetImportStatus.type === 'error' ? '#991b1b' : '#166534',
                }}>
                  {resetImportStatus.type === 'success' ? '✓ ' : '✗ '}{resetImportStatus.message}
                </span>
              )}
            </div>
            {resetImportStatus.type === 'loading' && resetImportStatus.progress && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                {resetImportStatus.progress}
              </span>
            )}
          </div>
        </div>

        {/* Seed from draws */}
        <div className="bg-white rounded-sm border p-5 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '4px' }}>
            Import from existing draws
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '12px' }}>
            Extract all players from synced tournament draws into the player registry.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSeed}
              disabled={seedStatus.type === 'loading'}
              className="px-4 py-1.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)', color: 'white' }}
            >
              {seedStatus.type === 'loading' ? 'Importing...' : 'Import Players'}
            </button>
            {seedStatus.type !== 'idle' && seedStatus.type !== 'loading' && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                color: seedStatus.type === 'error' ? '#991b1b' : '#166534',
              }}>
                {seedStatus.type === 'success' ? '✓ ' : '✗ '}{seedStatus.message}
              </span>
            )}
          </div>
        </div>

        {/* Seed from API (legacy — scans fixtures) */}
        <div className="bg-white rounded-sm border p-5 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '4px' }}>
            Fetch from Tennis API (fixtures scan)
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '12px' }}>
            Scan ATP &amp; WTA tournament fixtures to import players. Adds without deleting.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleApiSeed}
              disabled={apiSeedStatus.type === 'loading'}
              className="px-4 py-1.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)', color: 'white' }}
            >
              {apiSeedStatus.type === 'loading' ? 'Fetching...' : 'Fetch Players'}
            </button>
            {apiSeedStatus.type !== 'idle' && apiSeedStatus.type !== 'loading' && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                color: apiSeedStatus.type === 'error' ? '#991b1b' : '#166534',
              }}>
                {apiSeedStatus.type === 'success' ? '✓ ' : '✗ '}{apiSeedStatus.message}
              </span>
            )}
          </div>
        </div>

        {/* Add Player */}
        <div className="bg-white rounded-sm border p-5 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '12px' }}>
            Add player
          </p>
          <form onSubmit={handleAddPlayer} className="flex items-end gap-3 flex-wrap">
            <div>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Carlos Alcaraz"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '6px 10px', border: '1px solid var(--chalk-dim)', borderRadius: '2px', width: '200px' }}
              />
            </div>
            <div>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Country</label>
              <input
                value={country}
                onChange={e => setCountry(e.target.value)}
                placeholder="ESP"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '6px 10px', border: '1px solid var(--chalk-dim)', borderRadius: '2px', width: '80px' }}
              />
            </div>
            <div>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Tour</label>
              <select
                value={tour}
                onChange={e => setTour(e.target.value as 'ATP' | 'WTA')}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '6px 10px', border: '1px solid var(--chalk-dim)', borderRadius: '2px', background: 'white', cursor: 'pointer' }}
              >
                <option value="ATP">ATP</option>
                <option value="WTA">WTA</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={adding || !name.trim()}
              className="px-4 py-1.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)', color: 'white' }}
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
          </form>
          {addStatus.type !== 'idle' && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: addStatus.type === 'error' ? '#991b1b' : '#166534', marginTop: '8px' }}>
              {addStatus.type === 'success' ? '✓ ' : '✗ '}{addStatus.message}
            </p>
          )}
        </div>

        {/* Search */}
        <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '12px' }}>
            Search players
          </p>
          <input
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Search by name..."
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '6px 10px', border: '1px solid var(--chalk-dim)', borderRadius: '2px', width: '100%', marginBottom: '12px' }}
          />

          {searching && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>Searching...</p>
          )}

          {results.length > 0 && (
            <div className="flex flex-col gap-1">
              {results.map(p => (
                <div key={p.id} className="flex items-center gap-3 py-2 px-2 rounded-sm" style={{ background: 'var(--chalk)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)', flex: 1 }}>
                    {p.name}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                    {p.country}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: 'white', padding: '2px 6px', borderRadius: '2px', border: '1px solid var(--chalk-dim)' }}>
                    {p.tour}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                    {p.external_id}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!searching && query.trim() && results.length === 0 && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>No players found</p>
          )}
        </div>
      </div>
    </main>
  )
}
