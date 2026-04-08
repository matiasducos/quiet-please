'use client'

import { useFormStatus } from 'react-dom'

export function AcceptButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1.5 text-xs font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ background: 'var(--court)' }}
    >
      {pending ? 'Accepting…' : 'Accept'}
    </button>
  )
}

export function AcceptRequestButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ background: 'var(--court)' }}
    >
      {pending ? 'Accepting…' : 'Accept request'}
    </button>
  )
}

export function DeclineButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1.5 text-xs rounded-sm border disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ borderColor: 'var(--chalk-dim)', color: 'var(--muted)', background: 'white' }}
    >
      {pending ? 'Declining…' : 'Decline'}
    </button>
  )
}
