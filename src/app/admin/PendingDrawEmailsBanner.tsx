'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { sendDrawEmailsNow, type SendDrawEmailsState } from './actions'
import type { PendingDrawAnnouncement } from '@/lib/announce-draw-open'

function SendButton({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1 text-xs font-medium rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40 flex-shrink-0"
      style={{ background: '#1e40af', color: 'white' }}
    >
      {pending ? 'Sending…' : count > 1 ? 'Send one email' : 'Send email'}
    </button>
  )
}

/**
 * Publishing a draw notifies users in-app but leaves the email pending, so
 * draws built in one sitting go out as one email per user (migration 109).
 * This is the "I'm done publishing" button. If nobody clicks it, the daily
 * expire-points cron sends it the next morning (04:00 UTC).
 */
export default function PendingDrawEmailsBanner({ pending }: { pending: PendingDrawAnnouncement[] }) {
  const [state, formAction] = useActionState<SendDrawEmailsState, FormData>(
    sendDrawEmailsNow,
    { status: 'idle' },
  )

  const bar = (children: React.ReactNode) => (
    <div style={{ background: '#dbeafe', borderBottom: '1px solid #bfdbfe' }} className="px-4 md:px-6 py-3">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        {children}
      </div>
    </div>
  )
  const text = { fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#1e3a8a', margin: 0 }

  if (pending.length === 0) {
    if (state.status !== 'done') return null
    return bar(
      <p style={text}>
        {state.sent.length > 0
          ? `✓ Emailed ${state.emailed} user${state.emailed !== 1 ? 's' : ''} about ${state.sent.join(' & ')}` +
            (state.reminded ? `, plus ${state.reminded} reminder${state.reminded !== 1 ? 's' : ''}` : '')
          : 'Nothing left to send.'}
        {state.skipped.length > 0 && ` — skipped ${state.skipped.join(', ')} (no longer open)`}
      </p>,
    )
  }

  const names = pending.map(t => `${t.flagEmoji ? `${t.flagEmoji} ` : ''}${t.name}`).join(', ')
  return bar(
    <>
      <p style={text}>
        {pending.length} draw{pending.length !== 1 ? 's' : ''} published, email not sent yet: {names}.
        {' '}Publish any other draws first — they&apos;ll share one email.
      </p>
      <form action={formAction}>
        <SendButton count={pending.length} />
      </form>
    </>,
  )
}
