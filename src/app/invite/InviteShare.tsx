'use client'

import { useState } from 'react'

export default function InviteShare({
  url,
  inviterName,
}: {
  url: string
  inviterName: string
}) {
  const [copied, setCopied] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  const shareText = `Join me on Quiet Please — predict tennis, earn points, compete with friends. Free to play.`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setShareError('Could not copy — try selecting the link manually.')
    }
  }

  async function handleShare() {
    // Web Share API is mobile-first; on desktop it typically isn't defined.
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: 'Quiet Please',
          text:  `${inviterName} invited you to Quiet Please — predict tennis for free.`,
          url,
        })
      } catch (err) {
        // User cancelled, or permission denied — silently ignore.
        if ((err as Error)?.name !== 'AbortError') {
          setShareError('Could not open the share sheet.')
        }
      }
    } else {
      // Fall back to copy on platforms without the Share API.
      handleCopy()
    }
  }

  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator

  return (
    <div className="flex flex-col gap-3">
      {/* Link preview + copy */}
      <div
        className="bg-white border rounded-sm flex items-center gap-2"
        style={{ borderColor: 'var(--chalk-dim)', padding: '10px 12px' }}
      >
        <code
          className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            color: 'var(--ink)',
          }}
        >
          {url}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            padding: '6px 10px',
            borderRadius: '2px',
            border: '1px solid var(--chalk-dim)',
            background: copied ? 'var(--court)' : 'white',
            color: copied ? '#fff' : 'var(--ink)',
            cursor: 'pointer',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            transition: 'all 0.15s ease',
          }}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>

      {/* Primary share — only shown on clients that support the Share API. */}
      {canNativeShare && (
        <button
          type="button"
          onClick={handleShare}
          className="w-full"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1rem',
            padding: '12px 18px',
            borderRadius: '2px',
            background: 'var(--court)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Share invite →
        </button>
      )}

      {shareError && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#c84b31' }}>
          {shareError}
        </p>
      )}
    </div>
  )
}
