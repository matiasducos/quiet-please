'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

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
  userId,
}: {
  initialCount: number
  userId: string
}) {
  const [unreadCount, setUnreadCount] = useState(initialCount)

  // Push, not poll.
  //
  // This used to fetch /api/messages/unread-count every 10 seconds, from the
  // nav, on every page. One signed-in user with a tab open for an hour was 360
  // serverless invocations, and the cost scaled with concurrent users rather
  // than with anything a user actually did — at 100 concurrent users it was
  // ~8.6 CPU-hours a day against a 4-hour monthly budget.
  //
  // The count now arrives from Postgres over a private Realtime topic, computed
  // by a trigger (migration 091). The badge costs zero Vercel invocations no
  // matter how long the tab stays open, so the whole growth curve is gone.
  //
  // `initialCount` still comes from the server render, so the badge is correct
  // in the first paint and this only ever applies deltas on top of it.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`user:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'unread' }, ({ payload }) => {
        const next = (payload as { count?: number })?.count
        if (typeof next === 'number') setUnreadCount(next)
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [userId])

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
