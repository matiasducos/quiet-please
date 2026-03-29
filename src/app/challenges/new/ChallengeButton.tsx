'use client'

import { useState } from 'react'
import { createChallenge } from './actions'

export default function ChallengeButton({ friendId, tournamentId }: { friendId: string; tournamentId: string }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div>
      <form
        action={async (formData) => {
          if (submitting) return
          setSubmitting(true)
          setError(null)
          const result = await createChallenge(formData)
          // redirect() throws and never returns — if we reach here, it's an error
          setSubmitting(false)
          if (result?.error) setError(result.error)
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
      {error && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#c84b31', marginTop: '6px', maxWidth: '180px', lineHeight: 1.4 }}>
          {error}
        </p>
      )}
    </div>
  )
}
