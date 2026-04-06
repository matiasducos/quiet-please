'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'

type ConversationPreview = {
  id: string
  friend: { id: string; username: string; avatarUrl: string | null }
  lastMessage: { body: string; senderId: string; createdAt: string } | null
  unreadCount: number
  updatedAt: string
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

export default function ConversationList({ userId }: { userId: string }) {
  const [conversations, setConversations] = useState<ConversationPreview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const initialLoadDoneRef = useRef(false)

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/conversations')
      if (!res.ok) {
        // Only show error on initial load; polls can silently retry
        if (!initialLoadDoneRef.current) setError(true)
        return
      }
      const data = await res.json()
      setConversations(data.conversations ?? [])
      setError(false)
    } catch {
      if (!initialLoadDoneRef.current) setError(true)
    } finally {
      initialLoadDoneRef.current = true
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConversations()
    const interval = setInterval(fetchConversations, 10_000)
    return () => clearInterval(interval)
  }, [fetchConversations])

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="bg-white rounded-sm border px-5 py-4 animate-pulse"
            style={{ borderColor: 'var(--chalk-dim)' }}
          >
            <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
            <div className="h-3 bg-gray-50 rounded w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  if (error && conversations.length === 0) {
    return (
      <div
        className="bg-white rounded-sm border py-16 px-8 text-center"
        style={{ borderColor: 'var(--chalk-dim)' }}
      >
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
          Could not load conversations. Please try again later.
        </p>
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <div
        className="bg-white rounded-sm border py-16 px-8 text-center"
        style={{ borderColor: 'var(--chalk-dim)' }}
      >
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            color: 'var(--ink)',
            marginBottom: '0.5rem',
          }}
        >
          No conversations yet
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>
          Start chatting by messaging a friend from your{' '}
          <Link href="/friends" style={{ color: 'var(--court)', textDecoration: 'underline' }}>
            friends list
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {conversations.map(convo => {
        const isUnread = convo.unreadCount > 0
        const preview = convo.lastMessage
          ? convo.lastMessage.senderId === userId
            ? `You: ${convo.lastMessage.body}`
            : convo.lastMessage.body
          : 'No messages yet'

        return (
          <Link
            key={convo.id}
            href={`/messages/${convo.id}`}
            className="block bg-white rounded-sm border px-5 py-4 hover:border-current transition-colors"
            style={{
              borderColor: isUnread ? 'var(--court)' : 'var(--chalk-dim)',
              textDecoration: 'none',
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.85rem',
                      color: 'var(--ink)',
                      fontWeight: isUnread ? 600 : 400,
                    }}
                  >
                    {convo.friend.username}
                  </span>
                  {isUnread && (
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: 'var(--court)',
                        display: 'block',
                        flexShrink: 0,
                      }}
                    />
                  )}
                </div>
                <p
                  className="truncate"
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--muted)',
                    lineHeight: 1.4,
                    maxWidth: '100%',
                  }}
                >
                  {preview.length > 80 ? preview.slice(0, 80) + '…' : preview}
                </p>
              </div>

              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.7rem',
                  color: 'var(--muted)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {convo.lastMessage ? timeAgo(convo.lastMessage.createdAt) : ''}
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
