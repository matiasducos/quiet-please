'use client'

import { useState, useRef, useCallback } from 'react'

type Message = {
  id: string
  senderId: string
  body: string
  readAt: string | null
  createdAt: string
}

export default function MessageInput({
  conversationId,
  onMessageSent,
}: {
  conversationId: string
  onMessageSent: (msg: Message) => void
}) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px' // max ~4 lines
  }, [])

  const send = async () => {
    const trimmed = body.trim()
    if (!trimmed || sending) return
    if (trimmed.length > 2000) {
      setError('Message too long (max 2000 chars)')
      return
    }

    setSending(true)
    setError(null)

    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to send')
        return
      }

      const data = await res.json()
      onMessageSent(data.message)
      setBody('')

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } catch {
      setError('Failed to send')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div
      className="border-t bg-white px-4 md:px-8 py-3"
      style={{ borderColor: 'var(--chalk-dim)' }}
    >
      {error && (
        <p
          style={{
            fontSize: '0.75rem',
            color: '#993C1D',
            marginBottom: '6px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={e => {
            setBody(e.target.value)
            adjustHeight()
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={sending}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid var(--chalk-dim)',
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '0.875rem',
            fontFamily: 'inherit',
            lineHeight: 1.45,
            background: sending ? 'var(--chalk)' : 'white',
            color: 'var(--ink)',
            outline: 'none',
            minHeight: '38px',
            maxHeight: '120px',
            overflow: 'auto',
          }}
        />
        <button
          onClick={send}
          disabled={!body.trim() || sending}
          style={{
            background: body.trim() && !sending ? 'var(--court)' : 'var(--chalk-dim)',
            color: body.trim() && !sending ? 'white' : 'var(--muted)',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '0.8rem',
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
            cursor: body.trim() && !sending ? 'pointer' : 'default',
            lineHeight: 1,
            minHeight: '38px',
            transition: 'background 0.15s ease, color 0.15s ease',
            flexShrink: 0,
          }}
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
      <p
        style={{
          fontSize: '0.6rem',
          color: 'var(--muted)',
          marginTop: '4px',
          fontFamily: 'var(--font-mono)',
          textAlign: 'right',
        }}
      >
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}
