'use client'

import { useState } from 'react'
import { sendChallenge } from './actions'

/**
 * Sends a drafted challenge. Disabled with a reason rather than hidden when
 * there is nothing to send — the button is the point of the draft screen, and a
 * missing one reads as a broken page rather than as "pick something first".
 */
export default function SendChallengeButton({
  challengeId,
  opponentUsername,
  canSend,
}: {
  challengeId: string
  opponentUsername: string
  canSend: boolean
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="w-full">
      <form
        action={async (formData) => {
          if (submitting) return
          setSubmitting(true)
          setError(null)
          const result = await sendChallenge(formData)
          // redirect() throws and never returns — reaching here means an error
          setSubmitting(false)
          if (result?.error) setError(result.error)
        }}
      >
        <input type="hidden" name="challenge_id" value={challengeId} />
        <button
          type="submit"
          disabled={submitting || !canSend}
          className="w-full sm:w-auto px-5 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--court)' }}
        >
          {submitting ? 'Sending…' : `Send to ${opponentUsername} →`}
        </button>
      </form>
      {!canSend && !error && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', marginTop: '6px', lineHeight: 1.5 }}>
          Make at least one pick first — an invite with an empty bracket gives them nothing to answer.
        </p>
      )}
      {error && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#c84b31', marginTop: '6px', lineHeight: 1.4 }}>
          {error}
        </p>
      )}
    </div>
  )
}
