'use client'

import { useState } from 'react'
import { leaveLeague, deleteLeague } from './actions'

export function LeaveButton({ leagueId, isOwner, memberCount }: { leagueId: string; isOwner: boolean; memberCount: number }) {
  const [loading, setLoading] = useState(false)

  async function handleLeave() {
    const ownerMsg = isOwner && memberCount > 1
      ? 'You are the owner. Ownership will transfer to the longest-standing member.'
      : isOwner
        ? 'You are the only member. The league will be deleted.'
        : ''

    if (!confirm(`Leave this league?${ownerMsg ? ' ' + ownerMsg : ''}`)) return
    setLoading(true)
    const result = await leaveLeague(leagueId)
    if (result?.error) {
      alert(result.error)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleLeave}
      disabled={loading}
      className="px-4 py-2 text-sm rounded-sm border transition-colors hover:opacity-80 disabled:opacity-40"
      style={{ color: 'var(--muted)', borderColor: 'var(--chalk-dim)', background: 'white' }}
    >
      {loading ? 'Leaving…' : 'Leave league'}
    </button>
  )
}

export function DeleteLeagueButton({ leagueId, memberCount }: { leagueId: string; memberCount: number }) {
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    const msg = memberCount > 1
      ? `This will permanently delete the league and remove all ${memberCount} members. This cannot be undone.`
      : 'This will permanently delete the league. This cannot be undone.'

    if (!confirm(msg)) return
    setLoading(true)
    const result = await deleteLeague(leagueId)
    if (result?.error) {
      alert(result.error)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="px-4 py-2 text-sm rounded-sm border transition-colors hover:opacity-80 disabled:opacity-40"
      style={{ color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}
    >
      {loading ? 'Deleting…' : 'Delete league'}
    </button>
  )
}
