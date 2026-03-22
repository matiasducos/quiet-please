'use client'

import { useState } from 'react'
import { kickMember } from './actions'

export default function KickButton({ leagueId, userId, username }: { leagueId: string; userId: string; username: string }) {
  const [loading, setLoading] = useState(false)

  async function handleKick() {
    if (!confirm(`Remove ${username} from this league? They can rejoin later.`)) return
    setLoading(true)
    const result = await kickMember(leagueId, userId)
    if (result?.error) {
      alert(result.error)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleKick}
      disabled={loading}
      className="px-2 py-0.5 rounded-sm text-xs transition-colors hover:opacity-80 disabled:opacity-40"
      style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca' }}
    >
      {loading ? '…' : 'Remove'}
    </button>
  )
}
