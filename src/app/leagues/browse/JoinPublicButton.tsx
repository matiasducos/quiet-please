'use client'

import { useState } from 'react'
import { joinPublicLeague } from '../[id]/actions'

export default function JoinPublicButton({ leagueId }: { leagueId: string }) {
  const [loading, setLoading] = useState(false)

  async function handleJoin() {
    setLoading(true)
    const result = await joinPublicLeague(leagueId)
    if (result?.error) {
      alert(result.error)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleJoin}
      disabled={loading}
      className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50"
      style={{ background: 'var(--court)' }}
    >
      {loading ? 'Joining…' : 'Join'}
    </button>
  )
}
