'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

function ChatIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
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
  )
}

export default function ChatBubbleIcon({
  initialCount,
}: {
  initialCount: number
}) {
  const [unreadCount, setUnreadCount] = useState(initialCount)

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/unread-count')
      if (!res.ok) return
      const data = await res.json()
      setUnreadCount(data.count ?? 0)
    } catch {
      // Swallow — next poll will retry
    }
  }, [])

  useEffect(() => {
    // Start polling after initial render (server-side count is already shown)
    const interval = setInterval(fetchCount, 10_000)
    return () => clearInterval(interval)
  }, [fetchCount])

  return (
    <Link
      href="/messages"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--ink)',
        opacity: 0.7,
      }}
      title={
        unreadCount > 0
          ? `${unreadCount} unread message${unreadCount > 1 ? 's' : ''}`
          : 'Messages'
      }
    >
      <ChatIcon />
      {unreadCount > 0 && (
        <span
          style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#e8120c',
            display: 'block',
            border: '2px solid var(--chalk, #f5f2eb)',
          }}
          aria-label={`${unreadCount} unread`}
        />
      )}
    </Link>
  )
}
