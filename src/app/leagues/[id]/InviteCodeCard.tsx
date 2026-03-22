'use client'

import { useState } from 'react'

export default function InviteCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    const url = `${window.location.origin}/leagues/join?code=${code}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="px-4 py-3 bg-white rounded-sm border text-center" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: '4px' }}>INVITE CODE</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', color: 'var(--court)', letterSpacing: '0.1em' }}>{code}</div>
      <button
        onClick={copyLink}
        className="mt-2 px-3 py-1 rounded-sm text-xs transition-colors hover:opacity-80"
        style={{ color: copied ? 'var(--court)' : 'var(--muted)', background: copied ? '#eaf3de' : 'var(--chalk-dim)' }}
      >
        {copied ? 'Link copied ✓' : 'Copy invite link'}
      </button>
    </div>
  )
}
