'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Small chat icon button that creates or opens a conversation with a friend.
 * Calls POST /api/messages/conversations to get/create the conversation,
 * then navigates to the chat view.
 */
export default function StartChatButton({ friendId }: { friendId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    if (loading) return
    setLoading(true)

    try {
      const res = await fetch('/api/messages/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId }),
      })

      if (!res.ok) return
      const data = await res.json()
      if (data.conversationId) {
        router.push(`/messages/${data.conversationId}`)
      }
    } catch {
      // Swallow — stays on friends page
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title="Message"
      className="px-3 py-1.5 text-xs rounded-sm border hover:border-current transition-colors"
      style={{
        borderColor: 'var(--chalk-dim)',
        color: loading ? 'var(--muted)' : 'var(--ink)',
        background: 'white',
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 17 17"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M3 3.5h11a1 1 0 011 1v7a1 1 0 01-1 1H6l-3 2.5V4.5a1 1 0 011-1z"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {loading ? '...' : 'Message'}
    </button>
  )
}
