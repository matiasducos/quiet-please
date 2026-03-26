'use client'

import { useState } from 'react'
import Link from 'next/link'
import { triggerCron, sendTestNotification } from './actions'
import type { ScoringTournament, CronRun } from './actions'
import { NOTIFICATION_TYPES } from './constants'
import type { NotificationType } from './constants'

// ── Cron jobs ─────────────────────────────────────────────────────────────────

const ENDPOINTS = [
  { key: 'sync-tournaments', label: 'Sync Tournaments', description: 'Fetch ATP/WTA calendar and upsert tournaments',      scheduleUtcHour: 6,    disabled: true  },
  { key: 'sync-draws',       label: 'Sync Draws',       description: 'Fetch draws for upcoming tournaments, open predictions', scheduleUtcHour: 9,  disabled: true  },
  { key: 'sync-results',     label: 'Sync Results',     description: 'Fetch match results for in-progress tournaments',    scheduleUtcHour: 12,   disabled: true  },
  { key: 'sync-backfill',    label: 'Sync Backfill',    description: 'Process past tournaments (on-demand)',               scheduleUtcHour: null, disabled: true  },
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (days  > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins  > 0) return `${mins}m ago`
  return 'just now'
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ManualTournament {
  id: string; name: string; tour: string; category: string; status: string
  starts_at: string | null; surface: string | null
  has_draw: boolean
  flag_emoji: string | null; location: string | null
}

export default function AdminPanel({ tournaments, scoringStatus, cronRuns }: { tournaments: ManualTournament[]; scoringStatus: ScoringTournament[]; cronRuns: CronRun[] }) {
  // ── Cron state ──────────────────────────────────────────────────────────────
  const [cronStatuses, setCronStatuses] = useState<Record<EndpointKey, AsyncStatus>>(
    Object.fromEntries(ENDPOINTS.map(e => [e.key, { type: 'idle' }])) as Record<EndpointKey, AsyncStatus>
  )

  // Separate state for award-points (not in ENDPOINTS anymore)
  const [awardStatus, setAwardStatus] = useState<AsyncStatus>({ type: 'idle' })

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

  async function handleRunAwardPoints() {
    setAwardStatus({ type: 'loading' })
    try {
      const { ok, data } = await triggerCron('award-points')
      setAwardStatus({ type: ok ? 'success' : 'error', message: JSON.stringify(data, null, 2) })
    } catch (err) {
      setAwardStatus({ type: 'error', message: String(err) })
    }
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/dashboard" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            Quiet Please
          </Link>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Admin
          </span>
        </div>
      </nav>

      {/* ── Unscored results banner ── */}
      {(() => {
        const pending = scoringStatus.filter(t => t.pendingResults > 0)
        if (pending.length === 0) return null
        const totalPending = pending.reduce((sum, t) => sum + t.pendingResults, 0)
        return (
          <div style={{ background: '#fef3c7', borderBottom: '1px solid #fde68a', padding: '12px 24px' }}>
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#92400e', margin: 0 }}>
                {totalPending} unscored result{totalPending !== 1 ? 's' : ''} across {pending.map(t => t.location ?? t.name).join(', ')}
              </p>
              <button
                onClick={handleRunAwardPoints}
                disabled={awardStatus.type === 'loading'}
                className="px-3 py-1 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: '#92400e', color: 'white' }}
              >
                {awardStatus.type === 'loading' ? 'Running…' : 'Award Points Now'}
              </button>
            </div>
          </div>
        )
      })()}

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">

        <div className="mb-8">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Admin panel
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            Manual tournaments, cron jobs, and test notifications.
          </p>
        </div>

        {/* ── Tournaments ── */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
              Manual Tournaments
            </h2>
            <div className="flex gap-2">
              <Link
                href="/admin/players"
                className="px-3 py-1.5 text-sm rounded-sm transition-opacity hover:opacity-90"
                style={{ border: '1px solid var(--chalk-dim)', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
              >
                Manage Players
              </Link>
              <Link
                href="/admin/tournaments/new"
                className="px-3 py-1.5 text-sm rounded-sm transition-opacity hover:opacity-90"
                style={{ background: 'var(--court)', color: 'white', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
              >
                + Create Tournament
              </Link>
            </div>
          </div>

          {tournaments.length === 0 ? (
            <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                No manual tournaments yet. Click &quot;+ Create Tournament&quot; to get started.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {tournaments.map(t => (
                <div key={t.id} className="bg-white rounded-sm border p-4" style={{ borderColor: 'var(--chalk-dim)' }}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '2px' }}>
                        {t.flag_emoji && <span style={{ marginRight: '5px' }}>{t.flag_emoji}</span>}
                        {t.location ?? t.name}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {t.location && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: 'var(--chalk)', padding: '1px 6px', borderRadius: '2px' }}>
                            {t.name}
                          </span>
                        )}
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: 'var(--chalk)', padding: '1px 6px', borderRadius: '2px' }}>
                          {t.tour}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: 'var(--chalk)', padding: '1px 6px', borderRadius: '2px' }}>
                          {t.category}
                        </span>
                        {t.surface && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', background: 'var(--chalk)', padding: '1px 6px', borderRadius: '2px' }}>
                            {t.surface}
                          </span>
                        )}
                        {t.starts_at && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                            {new Date(t.starts_at).toLocaleDateString()}
                          </span>
                        )}
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.04em', textTransform: 'uppercase',
                          color: t.status === 'completed' ? '#166534' : t.status === 'in_progress' ? '#92400e' : 'var(--muted)',
                          background: t.status === 'completed' ? '#dcfce7' : t.status === 'in_progress' ? '#fef3c7' : 'var(--chalk)',
                          padding: '1px 6px', borderRadius: '2px',
                        }}>
                          {t.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Link
                        href={`/admin/tournaments/${t.id}/edit`}
                        className="px-3 py-1.5 rounded-sm transition-opacity hover:opacity-90"
                        style={{ border: '1px solid var(--chalk-dim)', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/tournaments/${t.id}/draw`}
                        className="px-3 py-1.5 rounded-sm transition-opacity hover:opacity-90"
                        style={{ background: t.has_draw ? '#111' : 'var(--court)', color: 'white', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
                      >
                        {t.has_draw ? 'Edit Draw' : 'Build Draw'}
                      </Link>
                      {t.has_draw && (
                        <Link
                          href={`/admin/tournaments/${t.id}/results`}
                          className="px-3 py-1.5 rounded-sm transition-opacity hover:opacity-90"
                          style={{ border: '1px solid var(--chalk-dim)', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
                        >
                          {t.status === 'completed' ? 'View Results' : 'Enter Results'}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Award Points ── */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
              Award Points
            </h2>
            <button
              onClick={handleRunAwardPoints}
              disabled={awardStatus.type === 'loading'}
              className="px-4 py-1.5 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--court)', color: 'white' }}
            >
              {awardStatus.type === 'loading' ? 'Running…' : 'Run Award Points'}
            </button>
          </div>

          {awardStatus.message && (
            <div
              className="mb-3 p-3 rounded-sm overflow-x-auto"
              style={{
                background: awardStatus.type === 'error' ? '#fee2e2' : '#f0fdf4',
                borderLeft: `3px solid ${awardStatus.type === 'error' ? '#ef4444' : '#22c55e'}`,
              }}
            >
              <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: awardStatus.type === 'error' ? '#991b1b' : '#166534', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {awardStatus.message}
              </pre>
            </div>
          )}

          {scoringStatus.length === 0 ? (
            <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                No active tournaments with results to score.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {scoringStatus.map(t => {
                const allScored = t.pendingResults === 0 && t.totalResults > 0
                const hasPending = t.pendingResults > 0
                return (
                  <div key={t.id} className="bg-white rounded-sm border p-4" style={{ borderColor: hasPending ? '#fde68a' : 'var(--chalk-dim)' }}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '2px' }}>
                          {t.flag_emoji && <span style={{ marginRight: '5px' }}>{t.flag_emoji}</span>}
                          {t.location ?? t.name}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.04em', textTransform: 'uppercase',
                            color: t.status === 'completed' ? '#166534' : '#92400e',
                            background: t.status === 'completed' ? '#dcfce7' : '#fef3c7',
                            padding: '1px 6px', borderRadius: '2px',
                          }}>
                            {t.status.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                            {t.totalResults} results
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {allScored ? (
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                            color: '#166534', background: '#dcfce7',
                            padding: '4px 10px', borderRadius: '9999px',
                          }}>
                            All scored
                          </span>
                        ) : hasPending ? (
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                            color: '#92400e', background: '#fef3c7',
                            padding: '4px 10px', borderRadius: '9999px',
                          }}>
                            {t.pendingResults} unscored
                          </span>
                        ) : (
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                            color: 'var(--muted)',
                          }}>
                            No results yet
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Cron jobs ── */}
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
          Cron jobs
        </h2>
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
                    disabled={status.type === 'loading' || endpoint.disabled}
                    className="px-4 py-2 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 flex-shrink-0"
                    style={{ background: 'var(--court)', color: 'white' }}
                  >
                    {status.type === 'loading' ? 'Running…' : endpoint.disabled ? 'Disabled' : 'Run'}
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

        {/* ── Recent Cron Runs ── */}
        {cronRuns.length > 0 && (
          <div className="mt-8">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Recent cron runs
            </h2>
            <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="overflow-x-auto">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafaf8', borderBottom: '1px solid var(--chalk-dim)' }}>
                      {['Job', 'Status', 'Duration', 'When', 'Summary'].map(h => (
                        <th key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'left', padding: '8px 12px', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cronRuns.map(run => {
                      const statusColor = run.status === 'success' ? '#166534' : run.status === 'error' ? '#991b1b' : '#92400e'
                      const statusBg = run.status === 'success' ? '#dcfce7' : run.status === 'error' ? '#fee2e2' : '#fef3c7'
                      const ago = timeAgo(run.started_at)
                      const duration = run.duration_ms != null ? (run.duration_ms < 1000 ? `${run.duration_ms}ms` : `${(run.duration_ms / 1000).toFixed(1)}s`) : '—'
                      const summaryStr = run.error
                        ? run.error
                        : run.summary
                          ? Object.entries(run.summary).filter(([k]) => k !== 'message' && k !== 'points_by_user').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).substring(0, 60) : v}`).join(', ')
                          : '—'
                      return (
                        <tr key={run.id} style={{ borderBottom: '1px solid var(--chalk-dim)' }}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--ink)', padding: '8px 12px', whiteSpace: 'nowrap' }}>
                            {run.job_name}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: statusColor, background: statusBg, padding: '2px 8px', borderRadius: '2px' }}>
                              {run.status}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', padding: '8px 12px', whiteSpace: 'nowrap' }}>
                            {duration}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', padding: '8px 12px', whiteSpace: 'nowrap' }}>
                            {ago}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: run.error ? '#991b1b' : 'var(--muted)', padding: '8px 12px', maxWidth: '300px' }} className="truncate">
                            {summaryStr}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

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
