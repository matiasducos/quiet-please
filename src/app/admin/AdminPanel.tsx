'use client'

import { useState } from 'react'
import Link from 'next/link'
import { triggerCron, setTournamentStatus, updateTournamentDetails, deleteTournament, sendTestNotification } from './actions'
import { NOTIFICATION_TYPES } from './constants'
import type { NotificationType } from './constants'
import DrawEditor from './DrawEditor'

// ── Cron jobs ─────────────────────────────────────────────────────────────────

const ENDPOINTS = [
  { key: 'sync-tournaments', label: 'Sync Tournaments', description: 'Fetch ATP/WTA calendar and upsert tournaments',      scheduleUtcHour: 6  },
  { key: 'sync-draws',       label: 'Sync Draws',       description: 'Fetch draws for upcoming tournaments, open predictions', scheduleUtcHour: 9  },
  { key: 'sync-results',     label: 'Sync Results',     description: 'Fetch match results for in-progress tournaments',    scheduleUtcHour: 12 },
  { key: 'award-points',     label: 'Award Points',     description: 'Score correct predictions and update leaderboards',  scheduleUtcHour: 18 },
  { key: 'sync-backfill',    label: 'Sync Backfill',    description: 'Process past tournaments (on-demand)',               scheduleUtcHour: null },
] as const

// Format a UTC hour as a local CET/CEST time string — auto-handles summer time.
function formatCronSchedule(utcHour: number | null): string {
  if (utcHour === null) return 'On-demand only'
  const d = new Date()
  d.setUTCHours(utcHour, 0, 0, 0)
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
  const tz   = d.toLocaleTimeString('en-GB', { timeZoneName: 'short', timeZone: 'Europe/Paris' }).split(' ').pop() ?? 'CET'
  return `Daily at ${time} ${tz}`
}

type EndpointKey = typeof ENDPOINTS[number]['key']
type AsyncStatus = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string }

// ── Tournament types ──────────────────────────────────────────────────────────

const STATUSES = ['upcoming', 'draw_published', 'accepting_predictions', 'in_progress', 'completed'] as const
type TournamentStatus = typeof STATUSES[number]

const STATUS_LABELS: Record<TournamentStatus, string> = {
  upcoming:               'Upcoming',
  draw_published:         'Draw Published',
  accepting_predictions:  'Accepting Predictions',
  in_progress:            'In Progress',
  completed:              'Completed',
}

const STATUS_COLORS: Record<TournamentStatus, { bg: string; color: string }> = {
  upcoming:               { bg: '#f1f5f9', color: '#64748b' },
  draw_published:         { bg: '#dbeafe', color: '#1e40af' },
  accepting_predictions:  { bg: '#fef3c7', color: '#92400e' },
  in_progress:            { bg: '#dcfce7', color: '#166534' },
  completed:              { bg: '#e2e8f0', color: '#475569' },
}

interface Tournament {
  id: string
  external_id: string
  name: string
  status: string
  starts_at: string | null
  ends_at: string | null
  draw_close_at: string | null
  surface: string | null
  tour: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10) // YYYY-MM-DD
}

function toDatetimeInput(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 16) // YYYY-MM-DDTHH:MM
}

// Convert a `YYYY-MM-DD` date input value → ISO timestamp (start of day UTC)
function fromDateInput(val: string): string | null {
  return val ? val + 'T00:00:00.000Z' : null
}

// Convert a `YYYY-MM-DDTHH:MM` datetime-local input → ISO timestamp
function fromDatetimeInput(val: string): string | null {
  return val ? val + ':00.000Z' : null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminPanel({ tournaments }: { tournaments: Tournament[] }) {
  // ── Cron state ──────────────────────────────────────────────────────────────
  const [cronStatuses, setCronStatuses] = useState<Record<EndpointKey, AsyncStatus>>(
    Object.fromEntries(ENDPOINTS.map(e => [e.key, { type: 'idle' }])) as Record<EndpointKey, AsyncStatus>
  )

  async function handleTriggerCron(key: EndpointKey) {
    setCronStatuses(s => ({ ...s, [key]: { type: 'loading' } }))
    try {
      const { ok, data } = await triggerCron(key)
      setCronStatuses(s => ({
        ...s,
        [key]: { type: ok ? 'success' : 'error', message: JSON.stringify(data, null, 2) },
      }))
    } catch (err) {
      setCronStatuses(s => ({ ...s, [key]: { type: 'error', message: String(err) } }))
    }
  }

  // ── Tournament state ─────────────────────────────────────────────────────────
  type StatusOverride = {
    selected: TournamentStatus
    result: AsyncStatus
  }
  type DetailsEdit = {
    open: boolean
    starts_at: string
    surface: string
    ends_at: string
    draw_close_at: string
    result: AsyncStatus
  }

  const [statusOverrides, setStatusOverrides] = useState<Record<string, StatusOverride>>(
    Object.fromEntries(
      tournaments.map(t => [
        t.id,
        {
          selected: (STATUSES.includes(t.status as TournamentStatus)
            ? t.status
            : 'upcoming') as TournamentStatus,
          result: { type: 'idle' },
        },
      ])
    )
  )

  const [detailsEdits, setDetailsEdits] = useState<Record<string, DetailsEdit>>(
    Object.fromEntries(
      tournaments.map(t => [
        t.id,
        {
          open: false,
          starts_at:     toDateInput(t.starts_at),
          surface:       t.surface       ?? '',
          ends_at:       toDateInput(t.ends_at),
          draw_close_at: toDatetimeInput(t.draw_close_at),
          result:        { type: 'idle' },
        },
      ])
    )
  )

  // ── Tournament filter ─────────────────────────────────────────────────────────
  const [filter, setFilter] = useState('')
  const filterLow = filter.toLowerCase()
  const visibleTournaments = filter
    ? tournaments.filter(t => t.name.toLowerCase().includes(filterLow))
    : tournaments

  // ── Delete state ─────────────────────────────────────────────────────────────
  type DeleteState = { confirming: boolean; deleting: boolean; deleted: boolean; error?: string }
  const [deleteStates, setDeleteStates] = useState<Record<string, DeleteState>>(
    Object.fromEntries(tournaments.map(t => [t.id, { confirming: false, deleting: false, deleted: false }]))
  )
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())

  // ── Draw editor open state ───────────────────────────────────────────────────
  const [drawEditorOpen, setDrawEditorOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(tournaments.map(t => [t.id, false]))
  )

  function toggleDrawEditor(id: string) {
    setDrawEditorOpen(s => ({ ...s, [id]: !s[id] }))
  }

  // ── Test notifications state ─────────────────────────────────────────────────
  const [testNotifType, setTestNotifType] = useState<NotificationType>('draw_open')
  const [testNotifStatus, setTestNotifStatus] = useState<AsyncStatus>({ type: 'idle' })

  async function handleSendTestNotification() {
    setTestNotifStatus({ type: 'loading' })
    try {
      const { ok, count, error } = await sendTestNotification(testNotifType)
      setTestNotifStatus({
        type:    ok ? 'success' : 'error',
        message: ok ? `Sent to ${count} user${count === 1 ? '' : 's'}` : error,
      })
    } catch (err) {
      setTestNotifStatus({ type: 'error', message: String(err) })
    }
  }

  // ── Status override handlers ─────────────────────────────────────────────────
  function setSelectedStatus(id: string, status: TournamentStatus) {
    setStatusOverrides(s => ({ ...s, [id]: { ...s[id], selected: status } }))
  }

  async function applyStatus(id: string) {
    setStatusOverrides(s => ({ ...s, [id]: { ...s[id], result: { type: 'loading' } } }))
    try {
      const { ok, error } = await setTournamentStatus(id, statusOverrides[id].selected)
      setStatusOverrides(s => ({
        ...s,
        [id]: {
          ...s[id],
          result: {
            type: ok ? 'success' : 'error',
            message: ok ? `Set to "${statusOverrides[id].selected}"` : error,
          },
        },
      }))
    } catch (err) {
      setStatusOverrides(s => ({ ...s, [id]: { ...s[id], result: { type: 'error', message: String(err) } } }))
    }
  }

  // ── Details edit handlers ────────────────────────────────────────────────────
  function toggleDetails(id: string) {
    setDetailsEdits(s => ({ ...s, [id]: { ...s[id], open: !s[id].open } }))
  }

  function setDetail<K extends keyof DetailsEdit>(id: string, key: K, val: DetailsEdit[K]) {
    setDetailsEdits(s => ({ ...s, [id]: { ...s[id], [key]: val } }))
  }

  async function saveDetails(id: string) {
    setDetailsEdits(s => ({ ...s, [id]: { ...s[id], result: { type: 'loading' } } }))
    try {
      const d = detailsEdits[id]
      const { ok, error } = await updateTournamentDetails(id, {
        starts_at:     fromDateInput(d.starts_at),
        surface:       d.surface       || null,
        ends_at:       fromDateInput(d.ends_at),
        draw_close_at: fromDatetimeInput(d.draw_close_at),
      })
      setDetailsEdits(s => ({
        ...s,
        [id]: { ...s[id], result: { type: ok ? 'success' : 'error', message: ok ? 'Saved' : error } },
      }))
    } catch (err) {
      setDetailsEdits(s => ({ ...s, [id]: { ...s[id], result: { type: 'error', message: String(err) } } }))
    }
  }

  // ── Delete handlers ──────────────────────────────────────────────────────────
  function confirmDelete(id: string) {
    setDeleteStates(s => ({ ...s, [id]: { ...s[id], confirming: true } }))
  }
  function cancelDelete(id: string) {
    setDeleteStates(s => ({ ...s, [id]: { ...s[id], confirming: false } }))
  }
  async function doDelete(id: string) {
    setDeleteStates(s => ({ ...s, [id]: { ...s[id], confirming: false, deleting: true } }))
    try {
      const { ok, error } = await deleteTournament(id)
      if (ok) {
        setDeleteStates(s => ({ ...s, [id]: { confirming: false, deleting: false, deleted: true } }))
        // Hide row after short delay so user sees feedback
        setTimeout(() => setHiddenIds(prev => new Set([...prev, id])), 800)
      } else {
        setDeleteStates(s => ({ ...s, [id]: { confirming: false, deleting: false, deleted: false, error } }))
      }
    } catch (err) {
      setDeleteStates(s => ({ ...s, [id]: { confirming: false, deleting: false, deleted: false, error: String(err) } }))
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            Quiet Please
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Admin
          </span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 md:px-8 py-10">

        {/* ── Cron jobs ── */}
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Admin panel
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Manually trigger cron jobs and manage tournament data.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {ENDPOINTS.map(endpoint => {
            const status = cronStatuses[endpoint.key]
            return (
              <div key={endpoint.key} className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '2px' }}>
                      {endpoint.label}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '2px' }}>
                      {endpoint.description}
                    </p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.03em' }}>
                      {formatCronSchedule(endpoint.scheduleUtcHour)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleTriggerCron(endpoint.key)}
                    disabled={status.type === 'loading'}
                    className="px-4 py-2 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 flex-shrink-0"
                    style={{ background: 'var(--court)', color: 'white' }}
                  >
                    {status.type === 'loading' ? 'Running…' : 'Run'}
                  </button>
                </div>

                {status.message && (
                  <div
                    className="mt-3 p-3 rounded-sm overflow-x-auto"
                    style={{
                      background: status.type === 'error' ? '#fee2e2' : '#f0fdf4',
                      borderLeft: `3px solid ${status.type === 'error' ? '#ef4444' : '#22c55e'}`,
                    }}
                  >
                    <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: status.type === 'error' ? '#991b1b' : '#166534', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {status.message}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Tournaments ── */}
        <div className="mt-12">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Tournaments
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem', marginBottom: '1rem' }}>
            Override status and set surface / dates for upcoming tournaments.
          </p>

          {/* Search filter */}
          <input
            type="text"
            placeholder="Filter by name…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{
              width: '100%', marginBottom: '1rem',
              fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
              padding: '7px 10px', border: '1px solid var(--chalk-dim)',
              borderRadius: '2px', background: 'white', color: 'var(--ink)',
              outline: 'none',
            }}
          />

          <div className="flex flex-col gap-3">
            {visibleTournaments.length === 0 && (
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                {filter ? `No tournaments matching "${filter}"` : 'No tournaments found.'}
              </p>
            )}
            {visibleTournaments.filter(t => !hiddenIds.has(t.id)).map(t => {
              const ov  = statusOverrides[t.id]
              const det = detailsEdits[t.id]
              const del = deleteStates[t.id]
              if (!ov || !det || !del) return null
              const currentStatusColor = STATUS_COLORS[t.status as TournamentStatus] ?? STATUS_COLORS.upcoming

              return (
                <div key={t.id} className="bg-white rounded-sm border p-4" style={{ borderColor: 'var(--chalk-dim)' }}>

                  {/* ── Row header ── */}
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Tour badge */}
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em',
                      padding: '2px 6px', borderRadius: '2px', flexShrink: 0,
                      background: t.tour === 'ATP' ? '#dbeafe' : '#fce7f3',
                      color:      t.tour === 'ATP' ? '#1e40af' : '#9d174d',
                    }}>
                      {t.tour}
                    </span>

                    {/* Name + date */}
                    <div className="flex-1 min-w-0">
                      <span style={{ fontSize: '0.875rem', color: 'var(--ink)', fontWeight: 500 }}>
                        {t.name}
                      </span>
                      {t.starts_at && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: '0.5rem' }}>
                          {t.starts_at.slice(0, 10)}
                        </span>
                      )}
                    </div>

                    {/* Current status badge */}
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.04em',
                      padding: '2px 7px', borderRadius: '2px', flexShrink: 0,
                      background: currentStatusColor.bg, color: currentStatusColor.color,
                    }}>
                      {t.status}
                    </span>

                    {/* Status select + Set button */}
                    <select
                      value={ov.selected}
                      onChange={e => setSelectedStatus(t.id, e.target.value as TournamentStatus)}
                      disabled={ov.result.type === 'loading'}
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                        padding: '4px 8px', border: '1px solid var(--chalk-dim)',
                        borderRadius: '2px', background: 'white', color: 'var(--ink)', cursor: 'pointer',
                      }}
                    >
                      {STATUSES.map(s => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>

                    <button
                      onClick={() => applyStatus(t.id)}
                      disabled={ov.result.type === 'loading' || ov.selected === t.status}
                      className="px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 flex-shrink-0"
                      style={{ background: 'var(--ink)', color: 'white' }}
                    >
                      {ov.result.type === 'loading' ? '…' : 'Set'}
                    </button>

                    {/* Edit details toggle */}
                    <button
                      onClick={() => toggleDetails(t.id)}
                      className="text-xs flex-shrink-0 transition-opacity hover:opacity-70"
                      style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      {det.open ? '▲ hide' : '▼ edit'}
                    </button>

                    {/* Draw editor toggle */}
                    <button
                      onClick={() => toggleDrawEditor(t.id)}
                      className="text-xs flex-shrink-0 transition-opacity hover:opacity-70"
                      style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      {drawEditorOpen[t.id] ? '▲ draw' : '▼ draw'}
                    </button>

                    {/* Delete — two-step */}
                    {del.deleted ? (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#166534' }}>✓ deleted</span>
                    ) : del.confirming ? (
                      <>
                        <button
                          onClick={() => doDelete(t.id)}
                          className="px-2 py-1 text-xs font-medium rounded-sm flex-shrink-0"
                          style={{ background: '#ef4444', color: 'white' }}
                        >
                          Confirm delete
                        </button>
                        <button
                          onClick={() => cancelDelete(t.id)}
                          className="text-xs flex-shrink-0 transition-opacity hover:opacity-70"
                          style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
                        >
                          cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => confirmDelete(t.id)}
                        disabled={del.deleting}
                        className="text-xs flex-shrink-0 transition-opacity hover:opacity-70 disabled:opacity-40"
                        style={{ color: '#ef4444', fontFamily: 'var(--font-mono)' }}
                      >
                        {del.deleting ? 'deleting…' : '✕ delete'}
                      </button>
                    )}
                  </div>

                  {/* Delete error */}
                  {del.error && (
                    <div className="mt-2 px-3 py-1.5 rounded-sm" style={{ background: '#fee2e2', borderLeft: '3px solid #ef4444' }}>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#991b1b', margin: 0 }}>
                        Delete failed: {del.error}
                      </p>
                    </div>
                  )}

                  {/* Status inline result */}
                  {ov.result.type !== 'idle' && ov.result.type !== 'loading' && ov.result.message && (
                    <div className="mt-2 px-3 py-1.5 rounded-sm" style={{
                      background: ov.result.type === 'error' ? '#fee2e2' : '#f0fdf4',
                      borderLeft: `3px solid ${ov.result.type === 'error' ? '#ef4444' : '#22c55e'}`,
                    }}>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: ov.result.type === 'error' ? '#991b1b' : '#166534', margin: 0 }}>
                        {ov.result.message}
                      </p>
                    </div>
                  )}

                  {/* ── Draw editor ── */}
                  {drawEditorOpen[t.id] && (
                    <DrawEditor
                      tournamentId={t.id}
                      externalId={t.external_id}
                      name={t.name}
                      status={t.status}
                      onClose={() => toggleDrawEditor(t.id)}
                    />
                  )}

                  {/* ── Details edit panel ── */}
                  {det.open && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--chalk-dim)' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
                        Surface, end date, and draw-close time. Leave blank to clear.
                      </p>

                      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                        {/* Starts at */}
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                            Starts at
                          </span>
                          <input
                            type="date"
                            value={det.starts_at}
                            onChange={e => setDetail(t.id, 'starts_at', e.target.value)}
                            style={{
                              fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                              padding: '5px 8px', border: '1px solid var(--chalk-dim)',
                              borderRadius: '2px', background: 'white', color: 'var(--ink)',
                            }}
                          />
                        </label>

                        {/* Surface */}
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                            Surface
                          </span>
                          <select
                            value={det.surface}
                            onChange={e => setDetail(t.id, 'surface', e.target.value)}
                            style={{
                              fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                              padding: '5px 8px', border: '1px solid var(--chalk-dim)',
                              borderRadius: '2px', background: 'white', color: 'var(--ink)',
                            }}
                          >
                            <option value="">— unset —</option>
                            <option value="hard">Hard</option>
                            <option value="clay">Clay</option>
                            <option value="grass">Grass</option>
                          </select>
                        </label>

                        {/* Ends at */}
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                            Ends at
                          </span>
                          <input
                            type="date"
                            value={det.ends_at}
                            onChange={e => setDetail(t.id, 'ends_at', e.target.value)}
                            style={{
                              fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                              padding: '5px 8px', border: '1px solid var(--chalk-dim)',
                              borderRadius: '2px', background: 'white', color: 'var(--ink)',
                            }}
                          />
                        </label>

                        {/* Draw close at */}
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase' }}>
                            Draw closes
                          </span>
                          <input
                            type="datetime-local"
                            value={det.draw_close_at}
                            onChange={e => setDetail(t.id, 'draw_close_at', e.target.value)}
                            style={{
                              fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                              padding: '5px 8px', border: '1px solid var(--chalk-dim)',
                              borderRadius: '2px', background: 'white', color: 'var(--ink)',
                            }}
                          />
                        </label>
                      </div>

                      <div className="flex items-center gap-3 mt-3">
                        <button
                          onClick={() => saveDetails(t.id)}
                          disabled={det.result.type === 'loading'}
                          className="px-4 py-1.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                          style={{ background: 'var(--court)', color: 'white' }}
                        >
                          {det.result.type === 'loading' ? 'Saving…' : 'Save details'}
                        </button>

                        {/* Inline result for details save */}
                        {det.result.type !== 'idle' && det.result.type !== 'loading' && det.result.message && (
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                            color: det.result.type === 'error' ? '#991b1b' : '#166534',
                          }}>
                            {det.result.type === 'success' ? '✓ ' : '✗ '}{det.result.message}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Test Notifications ── */}
        <div className="mt-10">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
            Test notifications
          </h2>
          <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '16px' }}>
              Sends a test notification of the selected type to <strong>all users</strong>.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={testNotifType}
                onChange={e => setTestNotifType(e.target.value as NotificationType)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                  padding: '6px 10px', border: '1px solid var(--chalk-dim)',
                  borderRadius: '2px', background: 'white', color: 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                {NOTIFICATION_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              <button
                onClick={handleSendTestNotification}
                disabled={testNotifStatus.type === 'loading'}
                className="px-4 py-1.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--court)', color: 'white' }}
              >
                {testNotifStatus.type === 'loading' ? 'Sending…' : 'Send to all users'}
              </button>

              {testNotifStatus.type !== 'idle' && testNotifStatus.type !== 'loading' && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                  color: testNotifStatus.type === 'error' ? '#991b1b' : '#166534',
                }}>
                  {testNotifStatus.type === 'success' ? '✓ ' : '✗ '}{testNotifStatus.message}
                </span>
              )}
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}
