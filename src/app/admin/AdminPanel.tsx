'use client'

import { useState } from 'react'
import Link from 'next/link'

const ENDPOINTS = [
  { key: 'sync-tournaments', label: 'Sync Tournaments', description: 'Fetch ATP/WTA calendar and upsert tournaments' },
  { key: 'sync-draws',       label: 'Sync Draws',       description: 'Fetch draws for upcoming tournaments, open predictions' },
  { key: 'sync-results',     label: 'Sync Results',     description: 'Fetch match results for in-progress tournaments' },
  { key: 'award-points',     label: 'Award Points',     description: 'Score correct predictions and update leaderboards' },
  { key: 'sync-backfill',    label: 'Sync Backfill',    description: 'Process past tournaments (on-demand)' },
] as const

type EndpointKey = typeof ENDPOINTS[number]['key']
type CronStatus = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string }

const STATUSES = ['upcoming', 'in_progress', 'completed'] as const
type TournamentStatus = typeof STATUSES[number]

const STATUS_LABELS: Record<TournamentStatus, string> = {
  upcoming:    'Upcoming',
  in_progress: 'In Progress',
  completed:   'Completed',
}

const STATUS_COLORS: Record<TournamentStatus, { bg: string; color: string }> = {
  upcoming:    { bg: '#f1f5f9', color: '#64748b' },
  in_progress: { bg: '#dcfce7', color: '#166534' },
  completed:   { bg: '#e2e8f0', color: '#475569' },
}

interface Tournament {
  id: string
  name: string
  status: string
  start_date: string
  tour: string
}

type OverrideState = {
  selected: TournamentStatus
  result: { type: 'idle' | 'loading' | 'success' | 'error'; message?: string }
}

export default function AdminPanel({
  cronSecret,
  tournaments,
}: {
  cronSecret: string
  tournaments: Tournament[]
}) {
  const [cronStatuses, setCronStatuses] = useState<Record<EndpointKey, CronStatus>>(
    Object.fromEntries(ENDPOINTS.map(e => [e.key, { type: 'idle' }])) as Record<EndpointKey, CronStatus>
  )

  const [overrides, setOverrides] = useState<Record<string, OverrideState>>(
    Object.fromEntries(
      tournaments.map(t => [
        t.id,
        { selected: (STATUSES.includes(t.status as TournamentStatus) ? t.status : 'upcoming') as TournamentStatus, result: { type: 'idle' } },
      ])
    )
  )

  // ── Cron trigger ──────────────────────────────────────────────────────────
  async function triggerCron(key: EndpointKey) {
    setCronStatuses(s => ({ ...s, [key]: { type: 'loading' } }))
    try {
      const res = await fetch(`/api/cron/${key}`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      })
      const json = await res.json()
      setCronStatuses(s => ({
        ...s,
        [key]: { type: res.ok ? 'success' : 'error', message: JSON.stringify(json, null, 2) },
      }))
    } catch (err) {
      setCronStatuses(s => ({ ...s, [key]: { type: 'error', message: String(err) } }))
    }
  }

  // ── Tournament status override ─────────────────────────────────────────────
  function setSelected(id: string, status: TournamentStatus) {
    setOverrides(s => ({ ...s, [id]: { ...s[id], selected: status } }))
  }

  async function applyStatus(id: string) {
    setOverrides(s => ({ ...s, [id]: { ...s[id], result: { type: 'loading' } } }))
    try {
      const res = await fetch('/api/admin/set-tournament-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: id, status: overrides[id].selected }),
      })
      const json = await res.json()
      setOverrides(s => ({
        ...s,
        [id]: { ...s[id], result: { type: res.ok ? 'success' : 'error', message: res.ok ? `Set to "${overrides[id].selected}"` : json.error } },
      }))
    } catch (err) {
      setOverrides(s => ({ ...s, [id]: { ...s[id], result: { type: 'error', message: String(err) } } }))
    }
  }

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

      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10">

        {/* ── Cron jobs ── */}
        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Admin panel
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Manually trigger cron jobs.
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
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {endpoint.description}
                    </p>
                  </div>
                  <button
                    onClick={() => triggerCron(endpoint.key)}
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

        {/* ── Tournament status override ── */}
        <div className="mt-12">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Tournament status
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem', marginBottom: '1.25rem' }}>
            Override the status set by sync cron.
          </p>

          <div className="flex flex-col gap-3">
            {tournaments.length === 0 && (
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>No tournaments found.</p>
            )}
            {tournaments.map(t => {
              const ov = overrides[t.id]
              if (!ov) return null
              const currentStatusColor = STATUS_COLORS[t.status as TournamentStatus] ?? STATUS_COLORS.upcoming
              const result = ov.result

              return (
                <div key={t.id} className="bg-white rounded-sm border p-4" style={{ borderColor: 'var(--chalk-dim)' }}>
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Tour badge */}
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.65rem',
                        letterSpacing: '0.06em',
                        padding: '2px 6px',
                        borderRadius: '2px',
                        background: t.tour === 'ATP' ? '#dbeafe' : '#fce7f3',
                        color: t.tour === 'ATP' ? '#1e40af' : '#9d174d',
                        flexShrink: 0,
                      }}
                    >
                      {t.tour}
                    </span>

                    {/* Name + date */}
                    <div className="flex-1 min-w-0">
                      <span style={{ fontSize: '0.875rem', color: 'var(--ink)', fontWeight: 500 }}>
                        {t.name}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: '0.5rem' }}>
                        {t.start_date.slice(0, 10)}
                      </span>
                    </div>

                    {/* Current status badge */}
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.65rem',
                        letterSpacing: '0.04em',
                        padding: '2px 7px',
                        borderRadius: '2px',
                        background: currentStatusColor.bg,
                        color: currentStatusColor.color,
                        flexShrink: 0,
                      }}
                    >
                      {t.status}
                    </span>

                    {/* Select + button */}
                    <select
                      value={ov.selected}
                      onChange={e => setSelected(t.id, e.target.value as TournamentStatus)}
                      disabled={result.type === 'loading'}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.75rem',
                        padding: '4px 8px',
                        border: '1px solid var(--chalk-dim)',
                        borderRadius: '2px',
                        background: 'white',
                        color: 'var(--ink)',
                        cursor: 'pointer',
                      }}
                    >
                      {STATUSES.map(s => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>

                    <button
                      onClick={() => applyStatus(t.id)}
                      disabled={result.type === 'loading' || ov.selected === t.status}
                      className="px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 flex-shrink-0"
                      style={{ background: 'var(--ink)', color: 'white' }}
                    >
                      {result.type === 'loading' ? '…' : 'Set'}
                    </button>
                  </div>

                  {/* Inline result */}
                  {result.type !== 'idle' && result.type !== 'loading' && result.message && (
                    <div
                      className="mt-2 px-3 py-1.5 rounded-sm"
                      style={{
                        background: result.type === 'error' ? '#fee2e2' : '#f0fdf4',
                        borderLeft: `3px solid ${result.type === 'error' ? '#ef4444' : '#22c55e'}`,
                      }}
                    >
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: result.type === 'error' ? '#991b1b' : '#166534', margin: 0 }}>
                        {result.message}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </main>
  )
}
