'use client'

import { useState } from 'react'
import { createChallenge } from './actions'

export default function ChallengeButton({ friendId, tournamentId }: { friendId: string; tournamentId: string }) {
  const [submitting, setSubmitting] = useState(false)

  return (
    <form
      action={async (formData) => {
        if (submitting) return
        setSubmitting(true)
        await createChallenge(formData)
        // If we get here (no redirect), there was an error
        setSubmitting(false)
      }}
    >
      <input type="hidden" name="friend_id" value={friendId} />
      <input type="hidden" name="tournament_id" value={tournamentId} />
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-40"
        style={{ background: 'var(--court)' }}
      >
        {submitting ? 'Sending…' : 'Challenge →'}
      </button>
    </form>
  )
}
