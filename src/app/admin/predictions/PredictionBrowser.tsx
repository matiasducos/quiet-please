'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  listTournamentPredictions,
  getPredictionOverview,
  adminUnlockPrediction,
} from './actions'
import type {
  AdminPredictionRow,
  AdminPredictionTournament,
  AdminPredictionOverview,
  PredictionScope,
  EntrantFilter,
} from './actions'

const mono = { fontFamily: 'var(--font-mono)' } as const
const control = {
  ...mono, fontSize: '0.8rem', padding: '6px 10px',
  border: '1px solid var(--chalk-dim)', borderRadius: '2px',
  background: 'white', color: 'var(--ink)',
} as const

const ALERT = '#991b1b'

function when(iso: string) {
  const d = new Date(iso)
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

// ── Small segmented control, used for both filters ───────────────────────────

function Segmented<T extends string>({
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

function Chip({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'alert' | 'court' }) {
  const colors = {
    muted: { color: 'var(--muted)', background: 'var(--chalk)' },
    alert: { color: ALERT, background: '#fee2e2' },
    court: { color: 'var(--court)', background: '#eef4ff' },
  }[tone]
  return (
    <span style={{ ...mono, fontSize: '0.6rem', padding: '1px 6px', borderRadius: '9999px', ...colors }}>
      {text}
    </span>
  )
}

// ── One bracket ──────────────────────────────────────────────────────────────

const OK_TONE = '#166534'

function PredictionRow({
  row,
  showTournament,
  onUnlocked,
}: {
  row: AdminPredictionRow
  showTournament: boolean
  /** Lets the page patch this row in place instead of refetching 25 brackets. */
  onUnlocked: (predictionId: string) => void
}) {
  // Deliberately the admin route and not the public `/picks/<username>` one:
  // that URL is keyed by series slug and resolves to whichever edition is
  // currently featured, so auditing an old edition through it would show the
  // wrong year's bracket. A prediction id is exact.
  const href = `/admin/predictions/${row.predictionId}`

  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  // Set only after the database has refused for `opponent_locked`. The override
  // is never offered up front — an admin should have to be told what the poker
  // rule is protecting before they decide to step over it.
  const [canForce, setCanForce] = useState(false)

  // Nothing to unlock is not the same as nothing locked: a bracket can carry
  // round locks with is_fully_locked false, and that is the state 095 was
  // written for.
  const hasLocks = row.isFullyLocked || row.committedLockCount > 0

  async function run(force: boolean) {
    setBusy(true)
    setNote(null)
    try {
      const res = await adminUnlockPrediction(row.predictionId, { allowRevealedChallenge: force })
      if (!res.ok) {
        setNote({ tone: 'err', text: res.message })
        // Keep the confirm panel open so the override sits next to the reason
        // it is needed, rather than making the admin start again.
        if (res.error === 'opponent_locked') setCanForce(true)
        else setConfirming(false)
        return
      }
      setConfirming(false)
      setCanForce(false)
      setNote({
        tone: 'ok',
        text: res.noOp
          ? 'Already open — nothing was locked, so nothing changed.'
          : `Unlocked. ${res.withdrawn} commitment${res.withdrawn === 1 ? '' : 's'} released` +
            (res.kept > 0 ? `, ${res.kept} kept on played matches.` : '.'),
      })
      onUnlocked(row.predictionId)
    } catch (err) {
      setNote({ tone: 'err', text: err instanceof Error ? err.message : 'Unlock failed' })
    } finally {
      setBusy(false)
    }
  }

  const lockLabel = row.isFullyLocked
    ? 'locked'
    : row.committedLockCount > 0
      ? `${row.committedLockCount} committed`
      : 'still editable'

  return (
    <div className="rounded-sm border bg-white px-3 py-2.5" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span style={{ ...mono, fontSize: '0.78rem', color: 'var(--ink)' }}>
              {row.username ?? <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>no username</span>}
            </span>
            {row.isBot && <Chip text="bot" />}
            {row.challengeId && <Chip text="challenge" tone="court" />}
            {row.unlockCount > 0 && <Chip text={`reopened ×${row.unlockCount}`} />}
            {row.latePickCount > 0 && <Chip text={`${row.latePickCount} after lock`} tone="alert" />}
          </div>
          <div style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showTournament ? row.tournamentLabel || '—' : row.email}
          </div>
        </div>

        <Link
          href={href}
          className="px-2 py-1 rounded-sm border transition-opacity hover:opacity-70 flex-shrink-0"
          style={{ ...mono, fontSize: '0.65rem', borderColor: 'var(--chalk-dim)', color: 'var(--ink)', background: 'white' }}
        >
          View bracket
        </Link>
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5" style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)' }}>
        <span>{row.pickCount} pick{row.pickCount === 1 ? '' : 's'}</span>
        {row.autoPickCount > 0 && <span>{row.autoPickCount} auto</span>}
        <span>{row.pointsEarned} pt{row.pointsEarned === 1 ? '' : 's'}</span>
        <span style={{ color: hasLocks ? 'var(--court)' : 'var(--muted)' }}>{lockLabel}</span>
        <span>edited {when(row.updatedAt)}</span>

        {hasLocks && !confirming && (
          <button
            onClick={() => { setNote(null); setConfirming(true) }}
            className="px-2 py-0.5 rounded-sm border transition-opacity hover:opacity-70"
            style={{ ...mono, fontSize: '0.65rem', borderColor: 'var(--chalk-dim)', color: 'var(--ink)', background: 'white', cursor: 'pointer' }}
          >
            Unlock
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-2 rounded-sm px-2.5 py-2" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
          <p style={{ ...mono, fontSize: '0.65rem', color: '#92400e', margin: 0, lineHeight: 1.5 }}>
            Reopens this bracket for <strong>{row.username ?? row.email}</strong>. Commitments on
            unplayed matches are released, which gives back the streak multiplier on those picks
            until they are locked again; locks on matches already played are kept, and no points
            already awarded change.
          </p>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <button
              onClick={() => run(canForce)}
              disabled={busy}
              className="px-2.5 py-1 rounded-sm transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ ...mono, fontSize: '0.65rem', background: '#92400e', color: 'white', border: 'none', cursor: 'pointer' }}
            >
              {busy ? 'Unlocking…' : canForce ? 'Unlock anyway' : 'Confirm unlock'}
            </button>
            <button
              onClick={() => { setConfirming(false); setCanForce(false); setNote(null) }}
              disabled={busy}
              className="px-2.5 py-1 rounded-sm border transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{ ...mono, fontSize: '0.65rem', borderColor: '#fde68a', color: '#92400e', background: 'white', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {note && (
        <p style={{ ...mono, fontSize: '0.65rem', marginTop: '6px', lineHeight: 1.5, color: note.tone === 'ok' ? OK_TONE : ALERT }}>
          {note.text}
        </p>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PredictionBrowser({ tournaments }: { tournaments: AdminPredictionTournament[] }) {
  const [tournamentId, setTournamentId] = useState<string>('all')
  const [scope, setScope] = useState<PredictionScope>('all')
  // Bots outnumber humans roughly 20:1 on a real draw, and none of them can
  // cheat — so the default view is the one an admin actually came to read.
  const [entrants, setEntrants] = useState<EntrantFilter>('humans')
  const [sort, setSort] = useState<'recent' | 'points'>('recent')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<AdminPredictionRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [overview, setOverview] = useState<AdminPredictionOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listTournamentPredictions({ tournamentId, search, page, scope, entrants, sort })
      setRows(res.rows)
      setHasMore(res.hasMore)
      setPageSize(res.pageSize)
      if (!res.ok) setError(res.error ?? 'Query failed')
    } finally {
      setLoading(false)
    }
  }, [tournamentId, search, page, scope, entrants, sort])

  useEffect(() => { load() }, [load])

  // The overview ignores the search box, so it reloads only when the set does.
  useEffect(() => {
    let cancelled = false
    getPredictionOverview({ tournamentId, scope }).then(o => { if (!cancelled) setOverview(o) })
    return () => { cancelled = true }
  }, [tournamentId, scope])

  // Patch the one row instead of reloading the page: a refetch would reorder
  // the list under the admin (it is sorted by updated_at, which the unlock just
  // moved) and lose the result message they have not read yet.
  const handleUnlocked = useCallback((predictionId: string) => {
    setRows(prev => prev.map(r =>
      r.predictionId === predictionId
        ? { ...r, isFullyLocked: false, committedLockCount: 0, unlockCount: r.unlockCount + 1 }
        : r,
    ))
    setOverview(prev =>
      prev && prev.locked !== null ? { ...prev, locked: Math.max(0, prev.locked - 1) } : prev,
    )
  }, [])

  function handleSearch(value: string) {
    if (searchTimer) clearTimeout(searchTimer)
    setSearchTimer(setTimeout(() => { setPage(0); setSearch(value) }, 300))
  }

  // Any filter change invalidates the page number — page 4 of a new set is
  // meaningless, and past the end PostgREST answers 416 with no count.
  function reset<T>(setter: (v: T) => void) {
    return (v: T) => { setPage(0); setter(v) }
  }

  const rangeFrom = rows.length === 0 ? 0 : page * pageSize + 1
  const rangeTo = page * pageSize + rows.length
  const showTournament = tournamentId === 'all'

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-6 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span style={{ ...mono, fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Predictions
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            All Predictions
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Every user&apos;s bracket, in every tournament — including brackets that are still
            open and normally hidden from other players.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2 mb-4">
          <select
            value={tournamentId}
            onChange={e => { setPage(0); setTournamentId(e.target.value) }}
            style={{ ...control, width: '100%' }}
          >
            <option value="all">All tournaments — most recently edited first</option>
            {tournaments.map(t => (
              <option key={t.id} value={t.id}>
                {[t.flagEmoji, t.location ?? t.name, t.tour, `· ${t.status.replace(/_/g, ' ')}`]
                  .filter(Boolean).join(' ')}
              </option>
            ))}
          </select>

          <input
            type="search"
            placeholder="Search username…"
            onChange={e => handleSearch(e.target.value)}
            style={{ ...control, width: '100%' }}
          />

          <div className="flex gap-2 flex-wrap">
            <Segmented
              value={entrants}
              onChange={reset(setEntrants)}
              options={[
                { key: 'humans', label: 'Humans' },
                { key: 'bots', label: 'Bots' },
                { key: 'all', label: 'Everyone' },
              ]}
            />
            <Segmented
              value={scope}
              onChange={reset(setScope)}
              options={[
                { key: 'all', label: 'All brackets' },
                { key: 'global', label: 'Global' },
                { key: 'challenge', label: 'Challenge' },
              ]}
            />
            <Segmented
              value={sort}
              onChange={reset(setSort)}
              options={[
                { key: 'recent', label: 'Last edited' },
                { key: 'points', label: 'Points' },
              ]}
            />
          </div>
        </div>

        {/* Overview — the whole set, before the search box narrows it */}
        {overview && (
          <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '12px' }}>
            {overview.approximate ? '~' : ''}{overview.total.toLocaleString()} bracket{overview.total === 1 ? '' : 's'}
            {overview.bots !== null && (
              <>
                {' · '}{(overview.total - overview.bots).toLocaleString()} from humans
                {' · '}{overview.bots.toLocaleString()} from bots
              </>
            )}
            {overview.locked !== null && <>{' · '}{overview.locked.toLocaleString()} locked</>}
            {overview.approximate && ' · estimated; pick a tournament for exact counts'}
          </p>
        )}

        {error && (
          <p style={{ ...mono, fontSize: '0.75rem', color: ALERT, marginBottom: '12px' }}>{error}</p>
        )}

        {loading ? (
          <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>No brackets match these filters.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map(r => (
              <PredictionRow
                key={r.predictionId}
                row={r}
                showTournament={showTournament}
                onUnlocked={handleUnlocked}
              />
            ))}
          </div>
        )}

        {(page > 0 || hasMore) && (
          <div className="flex items-center gap-3 mt-6 flex-wrap">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 rounded-sm border transition-opacity hover:opacity-70 disabled:opacity-30"
              style={{ ...mono, fontSize: '0.7rem', borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}
            >
              ← Prev
            </button>
            <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>
              {rangeFrom}–{rangeTo}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMore}
              className="px-3 py-1 rounded-sm border transition-opacity hover:opacity-70 disabled:opacity-30"
              style={{ ...mono, fontSize: '0.7rem', borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
