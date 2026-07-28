'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createPlayer, listPlayers, updatePlayer, deletePlayer, getPlayerUsage } from '../actions'
import type { AdminPlayer } from '../actions'
import { nameToFlag } from '@/app/admin/countries'

type TourFilter = 'all' | 'ATP' | 'WTA'
type Status = { type: 'idle' | 'success' | 'error'; message?: string }

const mono = { fontFamily: 'var(--font-mono)' } as const
const input = {
  ...mono, fontSize: '0.8rem', padding: '6px 10px',
  border: '1px solid var(--chalk-dim)', borderRadius: '2px',
  background: 'white', color: 'var(--ink)',
} as const

// ── One row: view, inline edit, delete-with-usage confirm ─────────────────────

function PlayerRow({ player, onChanged }: { player: AdminPlayer; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName]       = useState(player.name)
  const [country, setCountry] = useState(player.country)
  const [tour, setTour]       = useState<'ATP' | 'WTA'>(player.tour === 'WTA' ? 'WTA' : 'ATP')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Delete flow: click → look up usage → confirm → delete
  const [confirming, setConfirming] = useState(false)
  const [usage, setUsage] = useState<{ drawCount: number; resultCount: number } | null>(null)

  // No prop->state sync effect needed: the list keys rows by player.id, so a
  // different player is always a different component instance with fresh state.

  async function save() {
    setBusy(true); setError(null)
    const { ok, error } = await updatePlayer(player.id, { name, country, tour })
    setBusy(false)
    if (ok) { setEditing(false); onChanged() } else setError(error ?? 'Failed to save')
  }

  function cancel() {
    setName(player.name); setCountry(player.country)
    setTour(player.tour === 'WTA' ? 'WTA' : 'ATP')
    setEditing(false); setError(null)
  }

  async function startDelete() {
    setConfirming(true); setBusy(true)
    const u = await getPlayerUsage(player.external_id)
    setUsage({ drawCount: u.drawCount, resultCount: u.resultCount })
    setBusy(false)
  }

  async function confirmDelete() {
    setBusy(true); setError(null)
    const { ok, error } = await deletePlayer(player.id)
    setBusy(false)
    if (ok) { onChanged() } else { setError(error ?? 'Failed to delete'); setConfirming(false) }
  }

  const flag = nameToFlag(player.country)

  if (confirming) {
    return (
      <div className="rounded-sm border p-3" style={{ borderColor: '#fca5a5', background: '#fef2f2' }}>
        <p style={{ ...mono, fontSize: '0.8rem', color: '#991b1b', marginBottom: '6px' }}>
          Delete <strong>{player.name}</strong>?
        </p>
        {busy && !usage ? (
          <p style={{ ...mono, fontSize: '0.7rem', color: '#991b1b' }}>Checking where this player is used…</p>
        ) : (
          <div style={{ ...mono, fontSize: '0.7rem', color: '#991b1b', lineHeight: 1.6, marginBottom: '10px' }}>
            <div>used in {usage?.drawCount ?? 0} draw{usage?.drawCount === 1 ? '' : 's'}</div>
            <div>appears in {usage?.resultCount ?? 0} match result{usage?.resultCount === 1 ? '' : 's'}</div>
            <div style={{ color: 'var(--muted)', marginTop: '4px' }}>
              Existing draws keep their own copy and will not break.
            </div>
          </div>
        )}
        {error && <p style={{ ...mono, fontSize: '0.7rem', color: '#991b1b', marginBottom: '6px' }}>{error}</p>}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={confirmDelete}
            disabled={busy}
            className="px-3 py-1 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: '#dc2626', color: 'white' }}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
          <button
            onClick={() => { setConfirming(false); setUsage(null) }}
            disabled={busy}
            className="px-3 py-1 text-xs rounded-sm border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (editing) {
    return (
      <div className="rounded-sm border p-3" style={{ borderColor: 'var(--court)', background: 'white' }}>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 min-w-0">
            <label style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
              style={{ ...input, width: '100%' }} />
          </div>
          <div className="sm:w-40">
            <label style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>Country</label>
            <input value={country} onChange={e => setCountry(e.target.value)} placeholder="Spain"
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
              style={{ ...input, width: '100%' }} />
          </div>
          <div className="sm:w-24">
            <label style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>Tour</label>
            <select value={tour} onChange={e => setTour(e.target.value as 'ATP' | 'WTA')}
              style={{ ...input, width: '100%', cursor: 'pointer' }}>
              <option value="ATP">ATP</option>
              <option value="WTA">WTA</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy || !name.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)', color: 'white' }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancel} disabled={busy}
              className="px-3 py-1.5 text-xs rounded-sm border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}>
              Cancel
            </button>
          </div>
        </div>
        {error && <p style={{ ...mono, fontSize: '0.7rem', color: '#991b1b', marginTop: '6px' }}>{error}</p>}
        <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginTop: '6px' }}>
          Draws already built keep their own copy of the name and country — edits here do not change them.
        </p>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-sm" style={{ background: 'var(--chalk)' }}>
      <span style={{ ...mono, fontSize: '0.8rem', color: 'var(--ink)', flex: 1, minWidth: 0 }}>
        {player.name}
      </span>
      <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>
        {flag && <span style={{ marginRight: '3px' }}>{flag}</span>}
        {player.country || '—'}
      </span>
      <span style={{
        ...mono, fontSize: '0.65rem', color: 'var(--muted)', background: 'white',
        padding: '2px 6px', borderRadius: '2px', border: '1px solid var(--chalk-dim)',
      }}>
        {player.tour}
      </span>
      <button onClick={() => setEditing(true)}
        className="px-2 py-1 rounded-sm border transition-opacity hover:opacity-70"
        style={{ ...mono, fontSize: '0.65rem', borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}>
        Edit
      </button>
      <button onClick={startDelete}
        className="px-2 py-1 rounded-sm border transition-opacity hover:opacity-70"
        style={{ ...mono, fontSize: '0.65rem', borderColor: '#fca5a5', color: '#991b1b', background: 'white' }}>
        Delete
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlayerManager() {
  const [players, setPlayers] = useState<AdminPlayer[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [tourFilter, setTourFilter] = useState<TourFilter>('all')
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (opts: { search: string; tour: TourFilter; page: number }) => {
    setLoading(true)
    try {
      const res = await listPlayers({
        search: opts.search,
        tour: opts.tour === 'all' ? undefined : opts.tour,
        page: opts.page,
      })
      setPlayers(res.players)
      setTotal(res.total)
      setPageSize(res.pageSize)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load({ search, tour: tourFilter, page }) }, [load, search, tourFilter, page])

  function handleSearch(value: string) {
    if (searchTimer) clearTimeout(searchTimer)
    // Reset to the first page — page 4 of a new search is meaningless.
    setSearchTimer(setTimeout(() => { setPage(0); setSearch(value) }, 300))
  }

  function handleTour(t: TourFilter) { setPage(0); setTourFilter(t) }

  const refresh = () => load({ search, tour: tourFilter, page })

  // ── Add player ──────────────────────────────────────────────────────────────
  const [newName, setNewName] = useState('')
  const [newCountry, setNewCountry] = useState('')
  const [newTour, setNewTour] = useState<'ATP' | 'WTA'>('ATP')
  const [adding, setAdding] = useState(false)
  const [addStatus, setAddStatus] = useState<Status>({ type: 'idle' })

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true); setAddStatus({ type: 'idle' })
    try {
      const { ok, player, error } = await createPlayer({
        name: newName.trim(), country: newCountry.trim(), tour: newTour,
      })
      if (ok && player) {
        setAddStatus({ type: 'success', message: `Added ${player.name} (${player.external_id})` })
        setNewName(''); setNewCountry('')
        refresh()
      } else {
        setAddStatus({ type: 'error', message: error ?? 'Failed to create player' })
      }
    } catch (err) {
      setAddStatus({ type: 'error', message: String(err) })
    } finally {
      setAdding(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeFrom  = total === 0 ? 0 : page * pageSize + 1
  const rangeTo    = total === 0 ? 0 : Math.min((page + 1) * pageSize, total)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-6 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span style={{ ...mono, fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Players
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Manage Players
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            {total.toLocaleString()} player{total === 1 ? '' : 's'} in the registry.
          </p>
        </div>

        {/* Add player */}
        <div className="bg-white rounded-sm border p-4 md:p-5 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '12px' }}>
            Add player
          </p>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 min-w-0">
              <label style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Carlos Alcaraz"
                style={{ ...input, width: '100%' }} />
            </div>
            <div className="sm:w-40">
              <label style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Country</label>
              <input value={newCountry} onChange={e => setNewCountry(e.target.value)} placeholder="Spain"
                style={{ ...input, width: '100%' }} />
            </div>
            <div className="sm:w-24">
              <label style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Tour</label>
              <select value={newTour} onChange={e => setNewTour(e.target.value as 'ATP' | 'WTA')}
                style={{ ...input, width: '100%', cursor: 'pointer' }}>
                <option value="ATP">ATP</option>
                <option value="WTA">WTA</option>
              </select>
            </div>
            <button type="submit" disabled={adding || !newName.trim()}
              className="px-4 py-1.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)', color: 'white' }}>
              {adding ? 'Adding…' : 'Add'}
            </button>
          </form>
          {addStatus.type !== 'idle' && (
            <p style={{ ...mono, fontSize: '0.7rem', color: addStatus.type === 'error' ? '#991b1b' : '#166534', marginTop: '8px' }}>
              {addStatus.type === 'success' ? '✓ ' : '✗ '}{addStatus.message}
            </p>
          )}
        </div>

        {/* Registry */}
        <div className="bg-white rounded-sm border p-4 md:p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
            <input
              defaultValue={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search by name or ID…"
              style={{ ...input, flex: 1 }}
            />
            <div className="flex gap-1">
              {(['all', 'ATP', 'WTA'] as TourFilter[]).map(t => (
                <button key={t} onClick={() => handleTour(t)}
                  className="px-3 py-1.5 rounded-sm border transition-opacity hover:opacity-80"
                  style={{
                    ...mono, fontSize: '0.7rem',
                    borderColor: tourFilter === t ? 'var(--court)' : 'var(--chalk-dim)',
                    background:  tourFilter === t ? 'var(--court)' : 'white',
                    color:       tourFilter === t ? 'white' : 'var(--muted)',
                  }}>
                  {t === 'all' ? 'All' : t}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p style={{ ...mono, fontSize: '0.75rem', color: 'var(--muted)' }}>Loading…</p>
          ) : players.length === 0 ? (
            <p style={{ ...mono, fontSize: '0.75rem', color: 'var(--muted)' }}>
              {search ? 'No players match your search.' : 'No players in the registry yet.'}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                {players.map(p => <PlayerRow key={p.id} player={p} onChanged={refresh} />)}
              </div>

              <div className="flex items-center justify-between gap-2 mt-4 flex-wrap">
                <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>
                  {rangeFrom.toLocaleString()}–{rangeTo.toLocaleString()} of {total.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    className="px-3 py-1 rounded-sm border transition-opacity hover:opacity-70 disabled:opacity-30"
                    style={{ ...mono, fontSize: '0.7rem', borderColor: 'var(--chalk-dim)', color: 'var(--ink)', background: 'white' }}>
                    ← Prev
                  </button>
                  <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>
                    {page + 1} / {totalPages}
                  </span>
                  <button onClick={() => setPage(p => p + 1)} disabled={page + 1 >= totalPages}
                    className="px-3 py-1 rounded-sm border transition-opacity hover:opacity-70 disabled:opacity-30"
                    style={{ ...mono, fontSize: '0.7rem', borderColor: 'var(--chalk-dim)', color: 'var(--ink)', background: 'white' }}>
                    Next →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
