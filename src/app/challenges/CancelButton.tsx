'use client'

import { useTransition } from 'react'
import { cancelChallenge } from './[id]/actions'

export default function CancelButton({ challengeId }: { challengeId: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const fd = new FormData()
          fd.set('challenge_id', challengeId)
          await cancelChallenge(fd)
        })
      }}
      className="px-3 py-1.5 text-xs rounded-sm border hover:bg-gray-50 transition-colors disabled:opacity-50"
      style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white', whiteSpace: 'nowrap' }}
    >
      {pending ? 'Cancelling…' : 'Cancel'}
    </button>
  )
}
