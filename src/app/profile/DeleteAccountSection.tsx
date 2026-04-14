'use client'

import { useState, useTransition } from 'react'
import { requestAccountDeletion, cancelAccountDeletion } from './deletion-actions'

interface Props {
  username: string
  deletionRequestedAt: string | null
}

export default function DeleteAccountSection({ username, deletionRequestedAt }: Props) {
  const [phase, setPhase] = useState<'idle' | 'confirming'>(
    'idle'
  )
  const [confirmInput, setConfirmInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isPendingDeletion = !!deletionRequestedAt
  const deletionDate = deletionRequestedAt
    ? new Date(new Date(deletionRequestedAt).getTime() + 7 * 24 * 60 * 60 * 1000)
    : null

  const handleRequest = () => {
    const formData = new FormData()
    formData.set('confirm_username', confirmInput)
    startTransition(async () => {
      const result = await requestAccountDeletion(formData)
      if (result?.error) {
        setError(result.error)
      } else {
        setError(null)
        setPhase('idle')
        setConfirmInput('')
        // Page will revalidate and show the pending state
      }
    })
  }

  const handleCancel = () => {
    startTransition(async () => {
      const result = await cancelAccountDeletion()
      if (result?.error) {
        setError(result.error)
      } else {
        setError(null)
      }
    })
  }

  // ── Pending deletion state ────────────────────────────────────
  if (isPendingDeletion) {
    return (
      <div className="mt-10">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem', color: '#993C1D' }}>
          Account scheduled for deletion
        </h2>
        <div
          className="rounded-sm border px-5 py-4"
          style={{ borderColor: '#E8C47A', background: '#FFF9E6' }}
        >
          <p style={{ fontSize: '0.875rem', color: '#7A5C00', lineHeight: 1.55, marginBottom: '12px' }}>
            Your account and all associated data will be permanently deleted on{' '}
            <strong>
              {deletionDate?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </strong>
            . Until then, you can continue using the app normally.
          </p>
          <p style={{ fontSize: '0.8rem', color: '#7A5C00', lineHeight: 1.55, marginBottom: '16px' }}>
            Changed your mind? You can cancel the deletion at any time before the date above.
          </p>
          {error && (
            <p style={{ fontSize: '0.75rem', color: '#993C1D', fontFamily: 'var(--font-mono)', marginBottom: '8px' }}>
              {error}
            </p>
          )}
          <button
            onClick={handleCancel}
            disabled={isPending}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: 'var(--court)',
              background: 'white',
              border: '1px solid var(--court)',
              borderRadius: '3px',
              padding: '6px 16px',
              cursor: isPending ? 'default' : 'pointer',
              opacity: isPending ? 0.5 : 1,
            }}
          >
            {isPending ? 'Cancelling...' : 'Cancel deletion'}
          </button>
        </div>
      </div>
    )
  }

  // ── Idle state ────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="mt-10">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem' }}>
          Delete account
        </h2>
        <div
          className="bg-white rounded-sm border px-5 py-4"
          style={{ borderColor: 'var(--chalk-dim)' }}
        >
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.55, marginBottom: '12px' }}>
            Permanently delete your account, predictions, challenges, league and memberships. This action has a 7-day cooling-off period.
          </p>
          <button
            onClick={() => { setPhase('confirming'); setError(null) }}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: '#993C1D',
              background: 'none',
              border: '1px solid #E0B0A0',
              borderRadius: '3px',
              padding: '6px 16px',
              cursor: 'pointer',
            }}
          >
            Delete my account
          </button>
        </div>
      </div>
    )
  }

  // ── Confirming state ──────────────────────────────────────────
  return (
    <div className="mt-10">
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: '1rem', color: '#993C1D' }}>
        Confirm account deletion
      </h2>
      <div
        className="rounded-sm border px-5 py-4"
        style={{ borderColor: '#E0B0A0', background: '#FFF5F0' }}
      >
        <p style={{ fontSize: '0.875rem', color: '#993C1D', lineHeight: 1.55, marginBottom: '4px', fontWeight: 500 }}>
          This will permanently delete your account after 7 days.
        </p>
        <p style={{ fontSize: '0.8rem', color: '#7A4A30', lineHeight: 1.55, marginBottom: '16px' }}>
          All your predictions, points, challenges, friendships, league memberships, and messages will be removed. This cannot be undone.
        </p>
        <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#7A4A30', letterSpacing: '0.04em', marginBottom: '6px' }}>
          Type <strong>{username}</strong> to confirm
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={confirmInput}
            onChange={e => setConfirmInput(e.target.value)}
            placeholder={username}
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              border: '1px solid #E0B0A0',
              borderRadius: '3px',
              padding: '8px 12px',
              fontSize: '0.875rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--ink)',
              background: 'white',
              outline: 'none',
              maxWidth: '240px',
            }}
          />
          <button
            onClick={handleRequest}
            disabled={confirmInput !== username || isPending}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: 'white',
              background: confirmInput === username && !isPending ? '#993C1D' : 'var(--chalk-dim)',
              border: 'none',
              borderRadius: '3px',
              padding: '8px 16px',
              cursor: confirmInput === username && !isPending ? 'pointer' : 'default',
              transition: 'background 0.15s ease',
              flexShrink: 0,
            }}
          >
            {isPending ? 'Requesting...' : 'Delete'}
          </button>
        </div>
        {error && (
          <p style={{ fontSize: '0.75rem', color: '#993C1D', fontFamily: 'var(--font-mono)', marginTop: '8px' }}>
            {error}
          </p>
        )}
        <button
          onClick={() => { setPhase('idle'); setConfirmInput(''); setError(null) }}
          style={{
            display: 'block',
            marginTop: '12px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'var(--muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
