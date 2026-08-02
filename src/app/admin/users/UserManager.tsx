'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { listUsers, getUserDeletionImpact, adminDeleteUser } from './actions'
import type { AdminUser, UserDeletionImpact } from './actions'

const mono = { fontFamily: 'var(--font-mono)' } as const
const input = {
  ...mono, fontSize: '0.8rem', padding: '6px 10px',
  border: '1px solid var(--chalk-dim)', borderRadius: '2px',
  background: 'white', color: 'var(--ink)',
} as const

const DANGER = '#991b1b'

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── One row: view, then delete behind an impact preview and a typed confirm ───

function UserRow({ user, onDeleted }: { user: AdminUser; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [impact, setImpact] = useState<UserDeletionImpact | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // No prop->state sync effect: the list keys rows by user.id, so a different
  // user is always a different component instance with fresh state.

  async function startDelete() {
    setConfirming(true); setBusy(true); setError(null)
    setImpact(await getUserDeletionImpact(user.id))
    setBusy(false)
  }

  async function confirmDelete() {
    setBusy(true); setError(null)
    const res = await adminDeleteUser(user.id, typed)
    setBusy(false)
    if (res.ok) onDeleted()
    else setError(res.error ?? 'Failed to delete')
  }

  function cancel() {
    setConfirming(false); setImpact(null); setTyped(''); setError(null)
  }

  if (confirming) {
    const matches = typed.trim() === (user.username ?? '')
    return (
      <div className="rounded-sm border p-3" style={{ borderColor: '#fca5a5', background: '#fef2f2' }}>
        <p style={{ ...mono, fontSize: '0.8rem', color: DANGER, marginBottom: '8px' }}>
          Delete <strong>{user.username ?? user.email}</strong> permanently?
        </p>

        {busy && !impact ? (
          <p style={{ ...mono, fontSize: '0.7rem', color: DANGER }}>Working out what this would remove…</p>
        ) : impact ? (
          <>
            {impact.isAdmin && (
              <p style={{ ...mono, fontSize: '0.7rem', color: DANGER, marginBottom: '8px' }}>
                <strong>This account is in ADMIN_USER_IDS.</strong> The delete will be refused.
              </p>
            )}
            <div style={{ ...mono, fontSize: '0.7rem', color: DANGER, lineHeight: 1.6, marginBottom: '10px' }}>
              <div>{impact.predictions} bracket{impact.predictions === 1 ? '' : 's'}, {impact.ledgerRows} ledger row{impact.ledgerRows === 1 ? '' : 's'}, {impact.rankingPoints.toLocaleString()} ranking points</div>
              <div>{impact.achievements} achievement{impact.achievements === 1 ? '' : 's'}, {impact.friendships} friendship{impact.friendships === 1 ? '' : 's'}, {impact.challenges} challenge{impact.challenges === 1 ? '' : 's'}</div>
              <div>{impact.memberships} league membership{impact.memberships === 1 ? '' : 's'}</div>

              {impact.ownedLeagues.length > 0 && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #fca5a5' }}>
                  <div style={{ marginBottom: '3px' }}>Owns {impact.ownedLeagues.length} league{impact.ownedLeagues.length === 1 ? '' : 's'}:</div>
                  {impact.ownedLeagues.map(l => (
                    // Branch on the member count, never on nextOwner: a name we
                    // failed to resolve must not render as "sole member" and
                    // tell you nobody else is affected.
                    <div key={l.id} style={{ paddingLeft: '10px' }}>
                      · <strong>{l.name}</strong>{' '}
                      {l.otherMembers === 0
                        ? <>→ deactivated (sole member)</>
                        : <>→ passes to <strong>{l.nextOwner ?? 'its longest-standing member'}</strong>{' '}
                          ({l.otherMembers} other member{l.otherMembers === 1 ? '' : 's'})</>}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ color: 'var(--muted)', marginTop: '8px' }}>
                Immediate and irreversible — this skips the 7-day grace period the
                self-serve deletion gives users.
              </div>
            </div>

            <label style={{ ...mono, fontSize: '0.7rem', color: DANGER, display: 'block', marginBottom: '4px' }}>
              Type <strong>{user.username ?? '(no username)'}</strong> to confirm
            </label>
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
              style={{ ...input, width: '100%', maxWidth: '260px', marginBottom: '10px', borderColor: '#fca5a5' }}
            />
          </>
        ) : (
          <p style={{ ...mono, fontSize: '0.7rem', color: DANGER, marginBottom: '10px' }}>
            Could not load this account — it may already be gone.
          </p>
        )}

        {error && <p style={{ ...mono, fontSize: '0.7rem', color: DANGER, marginBottom: '6px' }}>{error}</p>}

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={confirmDelete}
            disabled={busy || !impact || !matches || impact.isAdmin}
            className="px-3 py-1 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: '#dc2626', color: 'white' }}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
          <button
            onClick={cancel}
            disabled={busy}
            className="px-3 py-1 text-xs rounded-sm border transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ ...mono, borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 md:gap-3 rounded-sm border bg-white px-3 py-2"
      style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex-1 min-w-0">
        <div style={{ ...mono, fontSize: '0.78rem', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.username ?? <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>no username</span>}
          {!user.username_is_set && (
            <span style={{ ...mono, fontSize: '0.6rem', color: 'var(--muted)', marginLeft: '6px' }}>unset</span>
          )}
          {user.deletion_requested_at && (
            <span style={{ ...mono, fontSize: '0.6rem', color: DANGER, marginLeft: '6px' }}>
              deletion pending
            </span>
          )}
        </div>
        <div style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.email}
        </div>
      </div>
      <span style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', flexShrink: 0 }} className="hidden sm:inline">
        {shortDate(user.created_at)}
      </span>
      <span style={{ ...mono, fontSize: '0.65rem', color: 'var(--ink)', flexShrink: 0, minWidth: '52px', textAlign: 'right' }}>
        {user.ranking_points.toLocaleString()}
      </span>
      <button onClick={startDelete}
        className="px-2 py-1 rounded-sm border transition-opacity hover:opacity-70 flex-shrink-0"
        style={{ ...mono, fontSize: '0.65rem', borderColor: '#fca5a5', color: DANGER, background: 'white' }}>
        Delete
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UserManager() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (opts: { search: string; page: number }) => {
    setLoading(true)
    try {
      const res = await listUsers({ search: opts.search, page: opts.page })
      setUsers(res.users)
      setTotal(res.total)
      setPageSize(res.pageSize)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load({ search, page }) }, [load, search, page])

  function handleSearch(value: string) {
    if (searchTimer) clearTimeout(searchTimer)
    // Reset to the first page — page 4 of a new search is meaningless.
    setSearchTimer(setTimeout(() => { setPage(0); setSearch(value) }, 300))
  }

  const refresh = () => load({ search, page })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeFrom = total === 0 ? 0 : page * pageSize + 1
  const rangeTo = total === 0 ? 0 : Math.min((page + 1) * pageSize, total)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <nav className="border-b bg-white sticky top-0 z-50" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-6 py-4">
          <Link href="/admin" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)' }}>
            &larr; Admin
          </Link>
          <span style={{ ...mono, fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Users
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Manage Users
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
            {total.toLocaleString()} account{total === 1 ? '' : 's'}. Deleting is immediate and cannot be undone.
          </p>
        </div>

        <input
          type="search"
          placeholder="Search username or email…"
          onChange={e => handleSearch(e.target.value)}
          style={{ ...input, width: '100%', marginBottom: '16px' }}
        />

        {loading ? (
          <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>Loading…</p>
        ) : users.length === 0 ? (
          <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>No accounts match that search.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {users.map(u => <UserRow key={u.id} user={u} onDeleted={refresh} />)}
          </div>
        )}

        {totalPages > 1 && (
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
              {rangeFrom}–{rangeTo} of {total.toLocaleString()}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
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
