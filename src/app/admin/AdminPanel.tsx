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
type Status = { type: 'idle' | 'loading' | 'success' | 'error'; message?: string }

export default function AdminPanel({ cronSecret }: { cronSecret: string }) {
  const [statuses, setStatuses] = useState<Record<EndpointKey, Status>>(
    Object.fromEntries(ENDPOINTS.map(e => [e.key, { type: 'idle' }])) as Record<EndpointKey, Status>
  )

  async function trigger(key: EndpointKey) {
    setStatuses(s => ({ ...s, [key]: { type: 'loading' } }))
    try {
      const res = await fetch(`/api/cron/${key}`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      })
      const json = await res.json()
      setStatuses(s => ({
        ...s,
        [key]: { type: res.ok ? 'success' : 'error', message: JSON.stringify(json, null, 2) },
      }))
    } catch (err) {
      setStatuses(s => ({ ...s, [key]: { type: 'error', message: String(err) } }))
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
            const status = statuses[endpoint.key]
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
                    onClick={() => trigger(endpoint.key)}
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
      </div>
    </main>
  )
}
