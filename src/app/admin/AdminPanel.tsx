'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { triggerCron, sendTestNotification, searchUsersForAutoPredict, toggleAutoPredict, updatePredictionMode, rerunTournamentPoints, getPastTournaments, getScoringStatus } from './actions'
import type { ScoringTournament, CronRun, AutoPredictStats, AppSettings, AdminTournament } from './actions'
import type { PredictionMode } from '@/lib/app-settings'
import { NOTIFICATION_TYPES } from './constants'
import type { NotificationType } from './constants'

// ── Cron jobs ─────────────────────────────────────────────────────────────────

const ENDPOINTS = [
  { key: 'auto-predict',     label: 'Auto-Predict',     description: 'Generate predictions for auto-predict users + bot gap-fill', scheduleUtcHour: 9.5,  disabled: true  },
] as const

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

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'tournaments' | 'past-tournaments' | 'award-points' | 'auto-predict' | 'cron-jobs' | 'test-notifications' | 'settings'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'tournaments',        label: 'Tournaments',       icon: '🎾' },
  { key: 'past-tournaments',   label: 'Past Tournaments',  icon: '📦' },
  { key: 'award-points',       label: 'Award Points',      icon: '⭐' },
  { key: 'auto-predict',       label: 'Auto-Predict',      icon: '🤖' },
  { key: 'cron-jobs',          label: 'Cron Jobs',         icon: '⚙️' },
  { key: 'test-notifications', label: 'Notifications',     icon: '🔔' },
  { key: 'settings',           label: 'Settings',          icon: '🔧' },
]

// ── Tournament card ───────────────────────────────────────────────────────────

const pill = {
  fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)',
  background: 'var(--chalk)', padding: '1px 6px', borderRadius: '2px',
} as const

function TournamentCard({ t }: { t: AdminTournament }) {
  return (
    <div className="bg-white rounded-sm border p-4" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex-1 min-w-0">
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)', marginBottom: '2px' }}>
            {t.flag_emoji && <span style={{ marginRight: '5px' }}>{t.flag_emoji}</span>}
            {t.location ?? t.name}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {t.location && <span style={pill}>{t.name}</span>}
            <span style={pill}>{t.tour}</span>
            <span style={pill}>{t.category}</span>
            {t.surface && <span style={pill}>{t.surface}</span>}
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
        <div className="flex gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
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
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminPanel({ tournaments, cronRuns, autoPredictStats, appSettings }: { tournaments: AdminTournament[]; cronRuns: CronRun[]; autoPredictStats: AutoPredictStats; appSettings: AppSettings }) {
  const [activeTab, setActiveTab] = useState<Tab>('tournaments')
  const [tournamentSearch, setTournamentSearch] = useState('')

  // ── Scoring status — fetched after paint, not with the page ─────────────────
  // Its cost grows with user count, so it must not sit on the critical path.
  // Loading on mount (rather than on tab open) keeps the pending-work banner
  // visible without the admin having to go looking for it.
  const [scoringStatus, setScoringStatus] = useState<ScoringTournament[]>([])
  const [scoringLoading, setScoringLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getScoringStatus()
      .then(rows => { if (!cancelled) setScoringStatus(rows) })
      .catch(err => console.error('[admin] scoring status failed:', err))
      .finally(() => { if (!cancelled) setScoringLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ── Past tournaments (archive) — fetched on demand, never on initial load ────
  const [pastTournaments, setPastTournaments] = useState<AdminTournament[]>([])
  const [pastLoaded,  setPastLoaded]  = useState(false)
  const [pastLoading, setPastLoading] = useState(false)
  const [pastHasMore, setPastHasMore] = useState(false)
  const [pastSearch,  setPastSearch]  = useState('')
  const [pastSearchTimer, setPastSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  async function loadPastTournaments(search: string) {
    setPastLoading(true)
    try {
      const { tournaments: rows, hasMore } = await getPastTournaments(search)
      setPastTournaments(rows)
      setPastHasMore(hasMore)
      setPastLoaded(true)
    } finally {
      setPastLoading(false)
    }
  }

  function handleTabChange(tab: Tab) {
    setActiveTab(tab)
    // First visit to the archive triggers the only fetch it ever needs.
    if (tab === 'past-tournaments' && !pastLoaded && !pastLoading) loadPastTournaments('')
  }

  function handlePastSearch(q: string) {
    setPastSearch(q)
    if (pastSearchTimer) clearTimeout(pastSearchTimer)
    // Search runs against the DB, so the archive is reachable past the page limit.
    setPastSearchTimer(setTimeout(() => loadPastTournaments(q), 300))
  }

  // ── Cron state ──────────────────────────────────────────────────────────────
  const [cronStatuses, setCronStatuses] = useState<Record<EndpointKey, AsyncStatus>>(
    Object.fromEntries(ENDPOINTS.map(e => [e.key, { type: 'idle' }])) as Record<EndpointKey, AsyncStatus>
  )
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

  // ── Per-tournament re-run state ─────────────────────────────────────────────
  const [rerunTarget, setRerunTarget] = useState<string | null>(null)  // awaiting confirm
  const [rerunStatuses, setRerunStatuses] = useState<Record<string, AsyncStatus>>({})

  async function handleRerunTournament(id: string) {
    setRerunTarget(null)
    setRerunStatuses(s => ({ ...s, [id]: { type: 'loading' } }))
    try {
      const res = await rerunTournamentPoints(id)
      setRerunStatuses(s => ({
        ...s,
        [id]: {
          type: res.ok ? 'success' : 'error',
          message: JSON.stringify(
            res.ok ? { erased: res.erased, rerun: res.rerun } : { error: res.error, erased: res.erased },
            null, 2,
          ),
        },
      }))
    } catch (err) {
      setRerunStatuses(s => ({ ...s, [id]: { type: 'error', message: String(err) } }))
    }
  }

  // ── Test notifications state ────────────────────────────────────────────────
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

  // ── Derived data ────────────────────────────────────────────────────────────
  // Pending work = correct picks the cron hasn't turned into ledger rows, plus
  // predictions whose stored total disagrees with the ledger. Matches nobody
  // predicted are not admin work and deliberately do not appear here.
  const pendingCount = scoringStatus.reduce((sum, t) => sum + t.unscoredPicks + t.driftPredictions, 0)

  const filteredTournaments = tournamentSearch.trim()
    ? tournaments.filter(t => {
        const q = tournamentSearch.toLowerCase()
        return (t.name.toLowerCase().includes(q) || (t.location ?? '').toLowerCase().includes(q))
      })
    : tournaments

  // ── Tab badge helpers ───────────────────────────────────────────────────────
  function getBadge(tab: Tab): string | null {
    if (tab === 'tournaments') return `${tournaments.length}`
    if (tab === 'award-points' && pendingCount > 0) return `${pendingCount}`
    if (tab === 'auto-predict') return `${autoPredictStats.enabledCount}`
    return null
  }

  // ── Auto-predict state ──────────────────────────────────────────────────────
  const [apSearch, setApSearch] = useState('')
  const [apUsers, setApUsers] = useState<Array<{ id: string; username: string; auto_predict_enabled: boolean }>>([])
  const [apSearching, setApSearching] = useState(false)
  const [apToggling, setApToggling] = useState<string | null>(null)
  const [apCronStatus, setApCronStatus] = useState<AsyncStatus>({ type: 'idle' })
  const [apSearchTimer, setApSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  async function handleApSearch(q: string) {
    setApSearch(q)
    if (apSearchTimer) clearTimeout(apSearchTimer)
    setApSearchTimer(setTimeout(async () => {
      setApSearching(true)
      try {
        const { users } = await searchUsersForAutoPredict(q)
        setApUsers(users)
      } finally {
        setApSearching(false)
      }
    }, 300))
  }

  async function handleApToggle(userId: string, enabled: boolean) {
    setApToggling(userId)
    const result = await toggleAutoPredict(userId, enabled)
    if (result.ok) {
      setApUsers(prev => prev.map(u => u.id === userId ? { ...u, auto_predict_enabled: enabled } : u))
    } else {
      console.error('[auto-predict] toggle failed:', result.error)
      alert(`Failed to toggle: ${result.error}`)
    }
    setApToggling(null)
  }

  async function handleRunAutoPredict() {
    setApCronStatus({ type: 'loading' })
    try {
      const { ok, data } = await triggerCron('auto-predict')
      setApCronStatus({ type: ok ? 'success' : 'error', message: JSON.stringify(data, null, 2) })
    } catch (err) {
      setApCronStatus({ type: 'error', message: String(err) })
    }
  }

  // ── Settings state ─────────────────────────────────────────────────────────
  const initMode: PredictionMode = appSettings.prediction_mode === 'pre_tournament' ? 'pre_tournament'
    : appSettings.prediction_mode === 'manual_lock' ? 'manual_lock'
    : 'anytime'
  const [savedMode, setSavedMode] = useState<PredictionMode>(initMode)
  const [pendingMode, setPendingMode] = useState<PredictionMode>(initMode)
  const [settingsStatus, setSettingsStatus] = useState<AsyncStatus>({ type: 'idle' })

  async function handleSavePredictionMode() {
    setSettingsStatus({ type: 'loading' })
    try {
      const result = await updatePredictionMode(pendingMode)
      if (result.ok) {
        setSavedMode(pendingMode)
        setSettingsStatus({ type: 'success', message: `Saved — prediction mode is now "${pendingMode}"` })
      } else {
        setSettingsStatus({ type: 'error', message: result.error })
      }
    } catch (err) {
      setSettingsStatus({ type: 'error', message: String(err) })
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
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

      {/* ── Unawarded points banner ── */}
      {(() => {
        const pending = scoringStatus.filter(t => t.unscoredPicks + t.driftPredictions > 0)
        if (pending.length === 0) return null
        const totalPending = pending.reduce((sum, t) => sum + t.unscoredPicks + t.driftPredictions, 0)
        return (
          <div style={{ background: '#fef3c7', borderBottom: '1px solid #fde68a', padding: '12px 24px' }}>
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#92400e', margin: 0 }}>
                {totalPending} correct pick{totalPending !== 1 ? 's' : ''} not awarded across {pending.map(t => t.location ?? t.name).join(', ')}
              </p>
              <button
                onClick={() => { setActiveTab('award-points'); handleRunAwardPoints() }}
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

        {/* ── Tab grid ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-8">
          {TABS.map(tab => {
            const isActive = activeTab === tab.key
            const badge = getBadge(tab.key)
            return (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className="flex items-center gap-2 px-4 py-3 rounded-sm border transition-colors text-left"
                style={{
                  background: isActive ? 'white' : 'transparent',
                  borderColor: isActive ? 'var(--ink)' : 'var(--chalk-dim)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '1rem' }}>{tab.icon}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: isActive ? 'var(--ink)' : 'var(--muted)', fontWeight: isActive ? 600 : 400 }}>
                  {tab.label}
                </span>
                {badge && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
                    color: tab.key === 'award-points' ? '#92400e' : 'var(--muted)',
                    background: tab.key === 'award-points' ? '#fef3c7' : 'var(--chalk)',
                    padding: '1px 6px', borderRadius: '9999px', marginLeft: 'auto',
                  }}>
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
          <Link
            href="/admin/players"
            className="flex items-center gap-2 px-4 py-3 rounded-sm border transition-colors"
            style={{ borderColor: 'var(--chalk-dim)', background: 'transparent', textDecoration: 'none' }}
          >
            <span style={{ fontSize: '1rem' }}>👤</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', color: 'var(--muted)' }}>
              Manage Players
            </span>
          </Link>
        </div>

        {/* ── Tournaments tab ── */}
        {activeTab === 'tournaments' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
                Manual Tournaments
              </h2>
              <Link
                href="/admin/tournaments/new"
                className="px-3 py-1.5 text-sm rounded-sm transition-opacity hover:opacity-90"
                style={{ background: 'var(--court)', color: 'white', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
              >
                + Create
              </Link>
            </div>

            {/* Search bar */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="Search tournaments…"
                value={tournamentSearch}
                onChange={e => setTournamentSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-sm border"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', borderColor: 'var(--chalk-dim)', background: 'white', color: 'var(--ink)' }}
              />
              {tournamentSearch && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '4px' }}>
                  {filteredTournaments.length} of {tournaments.length} tournaments
                </p>
              )}
            </div>

            {filteredTournaments.length === 0 ? (
              <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                  {tournamentSearch ? 'No tournaments match your search.' : 'No manual tournaments yet. Click "+ Create" to get started.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredTournaments.map(t => <TournamentCard key={t.id} t={t} />)}
              </div>
            )}
          </div>
        )}

        {/* ── Past Tournaments tab ── */}
        {activeTab === 'past-tournaments' && (
          <div>
            <h2 className="mb-1" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
              Past Tournaments
            </h2>
            <p className="mb-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
              Completed more than a week ago. Loaded only when you open this tab.
            </p>

            {/* Search bar — queries the database, so it reaches beyond the 50 shown */}
            <div className="mb-3">
              <input
                type="text"
                placeholder="Search past tournaments…"
                value={pastSearch}
                onChange={e => handlePastSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-sm border"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', borderColor: 'var(--chalk-dim)', background: 'white', color: 'var(--ink)' }}
              />
            </div>

            {pastLoading ? (
              <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>Loading…</p>
              </div>
            ) : pastTournaments.length === 0 ? (
              <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                  {pastSearch ? 'No past tournaments match your search.' : 'No past tournaments yet.'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {pastTournaments.map(t => <TournamentCard key={t.id} t={t} />)}
                </div>
                {pastHasMore && (
                  <p className="mt-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                    Showing the 50 most recent. Use search to find older ones.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Award Points tab ── */}
        {activeTab === 'award-points' && (
          <div>
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

            {scoringLoading ? (
              <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Checking award status…
                </p>
              </div>
            ) : scoringStatus.length === 0 ? (
              <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                  No active tournaments with results to score.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {scoringStatus.map(t => {
                  const pendingWork = t.unscoredPicks + t.driftPredictions
                  const hasPending = pendingWork > 0
                  const allScored = !hasPending && t.totalResults > 0
                  const rerunStatus = rerunStatuses[t.id]
                  const isRerunning = rerunStatus?.type === 'loading'
                  const isConfirming = rerunTarget === t.id
                  return (
                    <div key={t.id} className="bg-white rounded-sm border p-4" style={{ borderColor: hasPending ? '#fde68a' : 'var(--chalk-dim)' }}>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                        <div className="sm:flex-1 min-w-0">
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
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)' }}>
                              {t.correctPicks} correct picks
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                          {allScored ? (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#166534', background: '#dcfce7', padding: '4px 10px', borderRadius: '9999px' }}>
                              ✓ All awarded
                            </span>
                          ) : hasPending ? (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#92400e', background: '#fef3c7', padding: '4px 10px', borderRadius: '9999px' }}>
                              {t.unscoredPicks > 0 && `${t.unscoredPicks} not awarded`}
                              {t.unscoredPicks > 0 && t.driftPredictions > 0 && ' · '}
                              {t.driftPredictions > 0 && `${t.driftPredictions} total${t.driftPredictions !== 1 ? 's' : ''} drifted`}
                            </span>
                          ) : (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>
                              No results yet
                            </span>
                          )}
                          {isConfirming ? (
                            <>
                              <button
                                onClick={() => handleRerunTournament(t.id)}
                                className="px-3 py-1 text-xs font-medium rounded-sm transition-opacity hover:opacity-90"
                                style={{ background: '#dc2626', color: 'white' }}
                              >
                                Erase & re-run
                              </button>
                              <button
                                onClick={() => setRerunTarget(null)}
                                className="px-3 py-1 text-xs rounded-sm border transition-opacity hover:opacity-70"
                                style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)' }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setRerunTarget(t.id)}
                              disabled={isRerunning || t.totalResults === 0 || awardStatus.type === 'loading'}
                              className="px-3 py-1 text-xs rounded-sm border transition-opacity hover:opacity-70 disabled:opacity-40"
                              style={{ borderColor: 'var(--chalk-dim)', color: 'var(--ink)' }}
                            >
                              {isRerunning ? 'Re-running…' : '↻ Re-run points'}
                            </button>
                          )}
                        </div>
                      </div>

                      {isConfirming && (
                        <p className="mt-2" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#991b1b', lineHeight: 1.5 }}>
                          Erases ALL points for this tournament (ledger, rankings, leagues, trophies),
                          reopens finalized challenges, then re-scores from the current results.
                          Silent: no notifications or emails are sent.
                        </p>
                      )}

                      {rerunStatus?.message && (
                        <div
                          className="mt-3 p-3 rounded-sm overflow-x-auto"
                          style={{
                            background: rerunStatus.type === 'error' ? '#fee2e2' : '#f0fdf4',
                            borderLeft: `3px solid ${rerunStatus.type === 'error' ? '#ef4444' : '#22c55e'}`,
                          }}
                        >
                          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: rerunStatus.type === 'error' ? '#991b1b' : '#166534', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {rerunStatus.message}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Cron Jobs tab ── */}
        {activeTab === 'cron-jobs' && (
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Cron Jobs
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

            {/* Recent Cron Runs */}
            {cronRuns.length > 0 && (
              <div className="mt-8">
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', letterSpacing: '-0.01em', marginBottom: '0.5rem' }}>
                  Recent runs
                </h3>
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
          </div>
        )}

        {/* ── Test Notifications tab ── */}
        {/* ── Auto-Predict tab ── */}
        {activeTab === 'auto-predict' && (
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', marginBottom: '0.5rem' }}>Auto-Predict</h2>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
              Toggle auto-predictions per user. Enabled users can configure their priority players on their profile.
              Running also makes every bot fill picks for open matches where both players are known
              (priority player first, otherwise random).
            </p>

            {/* Run button */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={handleRunAutoPredict}
                disabled={apCronStatus.type === 'loading'}
                className="px-4 py-2 text-sm font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--court)', color: 'white' }}
              >
                {apCronStatus.type === 'loading' ? 'Running…' : 'Run Auto-Predict Now'}
              </button>
              {apCronStatus.type !== 'idle' && apCronStatus.type !== 'loading' && (
                <pre
                  className="mt-3 p-3 rounded-sm border overflow-x-auto"
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.65rem', lineHeight: 1.5,
                    color: apCronStatus.type === 'error' ? '#991b1b' : '#166534',
                    background: apCronStatus.type === 'error' ? '#fef2f2' : '#f0fdf4',
                    borderColor: apCronStatus.type === 'error' ? '#fecaca' : '#bbf7d0',
                    maxHeight: '300px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}
                >
                  {apCronStatus.type === 'success' ? '✓ ' : '✗ '}{apCronStatus.message}
                </pre>
              )}
            </div>

            {/* User search */}
            <input
              type="text"
              value={apSearch}
              onChange={e => handleApSearch(e.target.value)}
              placeholder="Search users by username..."
              className="w-full px-4 py-2.5 border rounded-sm mb-4"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', borderColor: 'var(--chalk-dim)', outline: 'none' }}
            />

            {apSearching && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>Searching...</p>
            )}

            {/* User list */}
            {apUsers.length > 0 && (
              <div className="border rounded-sm overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
                {apUsers.map(u => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between px-4 py-3 border-b last:border-b-0"
                    style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {u.username}
                    </span>
                    <button
                      onClick={() => handleApToggle(u.id, !u.auto_predict_enabled)}
                      disabled={apToggling === u.id}
                      className="px-3 py-1 text-xs font-medium rounded-sm transition-opacity"
                      style={{
                        background: u.auto_predict_enabled ? '#dcfce7' : '#f3f4f6',
                        color: u.auto_predict_enabled ? '#166534' : 'var(--muted)',
                        border: `1px solid ${u.auto_predict_enabled ? '#bbf7d0' : 'var(--chalk-dim)'}`,
                        fontFamily: 'var(--font-mono)',
                        opacity: apToggling === u.id ? 0.5 : 1,
                      }}
                    >
                      {u.auto_predict_enabled ? 'Enabled ✓' : 'Disabled'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Recent runs */}
            {autoPredictStats.recentRuns.length > 0 && (
              <div className="mt-8">
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', marginBottom: '0.5rem' }}>Recent Runs</h3>
                <div className="border rounded-sm overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
                  <div className="overflow-x-auto">
                    <div className="min-w-[400px]">
                      <div className="grid grid-cols-12 px-4 py-2 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafafa' }}>
                        <span className="col-span-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Trigger</span>
                        <span className="col-span-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Users</span>
                        <span className="col-span-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Created</span>
                        <span className="col-span-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Updated</span>
                      </div>
                      {autoPredictStats.recentRuns.map(run => (
                        <div key={run.id} className="grid grid-cols-12 px-4 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
                          <span className="col-span-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{run.triggered_by}</span>
                          <span className="col-span-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{run.users_processed}</span>
                          <span className="col-span-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{run.predictions_created}</span>
                          <span className="col-span-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>{timeAgo(run.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'test-notifications' && (
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Test Notifications
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
        )}

        {/* ── Settings tab ── */}
        {activeTab === 'settings' && (
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em', marginBottom: '0.75rem' }}>
              Settings
            </h2>

            {/* Prediction Mode */}
            <div className="bg-white rounded-sm border p-5 mb-4" style={{ borderColor: 'var(--chalk-dim)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', marginBottom: '4px' }}>
                Prediction Mode
              </h3>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '16px' }}>
                Controls when users can submit predictions for tournaments. Does not affect challenges.
              </p>

              <div className="flex flex-col gap-3">
                {([
                  {
                    value: 'anytime' as PredictionMode,
                    label: 'Allow predictions anytime',
                    description: 'Users can predict during "accepting predictions" and "in progress" status. Requires real-time match data to lock played matches.',
                    color: '#166534',
                    bg: '#dcfce7',
                    border: '#bbf7d0',
                  },
                  {
                    value: 'pre_tournament' as PredictionMode,
                    label: 'Only before tournament starts',
                    description: 'Users can only predict during "accepting predictions" status. Once the first match starts (in progress), predictions close. Safe mode — no real-time API needed.',
                    color: '#92400e',
                    bg: '#fef3c7',
                    border: '#fde68a',
                  },
                  {
                    value: 'manual_lock' as PredictionMode,
                    label: 'Manual match lock',
                    description: 'You manually lock each match from the results page before it starts. Predictions stay open for unlocked matches. Missed matches show the actual winner for the next round.',
                    color: '#4338ca',
                    bg: '#eef2ff',
                    border: '#c7d2fe',
                  },
                ]).map(opt => {
                  const isSelected = pendingMode === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { setPendingMode(opt.value); setSettingsStatus({ type: 'idle' }) }}
                      disabled={settingsStatus.type === 'loading'}
                      className="text-left p-4 rounded-sm border transition-all"
                      style={{
                        borderColor: isSelected ? opt.border : 'var(--chalk-dim)',
                        background: isSelected ? opt.bg : 'transparent',
                        opacity: settingsStatus.type === 'loading' ? 0.6 : 1,
                        cursor: 'pointer',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span style={{
                          width: '16px', height: '16px', borderRadius: '50%',
                          border: `2px solid ${isSelected ? opt.color : 'var(--chalk-dim)'}`,
                          background: isSelected ? opt.color : 'transparent',
                          display: 'inline-block', flexShrink: 0,
                        }} />
                        <span style={{
                          fontFamily: 'var(--font-display)', fontSize: '0.9rem',
                          color: isSelected ? opt.color : 'var(--ink)',
                          fontWeight: isSelected ? 600 : 400,
                        }}>
                          {opt.label}
                        </span>
                      </div>
                      <p style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                        color: isSelected ? opt.color : 'var(--muted)',
                        marginLeft: '24px', lineHeight: 1.5,
                      }}>
                        {opt.description}
                      </p>
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-4 mt-4">
                <button
                  onClick={handleSavePredictionMode}
                  disabled={settingsStatus.type === 'loading' || pendingMode === savedMode}
                  className="px-5 py-2 rounded-sm text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'var(--court)', color: 'white', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', cursor: pendingMode === savedMode ? 'default' : 'pointer' }}
                >
                  {settingsStatus.type === 'loading' ? 'Saving…' : 'Save Changes'}
                </button>
                {settingsStatus.type !== 'idle' && settingsStatus.type !== 'loading' && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
                    color: settingsStatus.type === 'error' ? '#991b1b' : '#166534',
                  }}>
                    {settingsStatus.type === 'success' ? '✓ ' : '✗ '}{settingsStatus.message}
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                <strong>Impact:</strong> &quot;Anytime&quot; and &quot;pre-tournament&quot; modes affect tournament predictions and auto-predict only —
                challenges are always open for <code>accepting_predictions</code> and <code>in_progress</code> tournaments.
                <br/><br/>
                <strong>&quot;Manual match lock&quot;</strong> is different: admin-locked matches are blocked for <strong>all prediction types</strong> including challenges.
                Lock matches from the tournament results page before they start. Users who miss a locked match can still predict subsequent rounds using the actual winner.
              </p>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
