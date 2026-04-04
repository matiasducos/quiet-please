'use client'

import { useState } from 'react'
import { toggleEmailNotifications } from './actions'

export default function EmailPrefsToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)

  async function handleToggle() {
    const next = !enabled
    setSaving(true)
    setEnabled(next) // optimistic
    const { ok } = await toggleEmailNotifications(next)
    if (!ok) setEnabled(enabled) // revert on failure
    setSaving(false)
  }

  return (
    <button
      onClick={handleToggle}
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 text-sm rounded-sm border hover:opacity-80 transition-opacity"
      style={{
        borderColor: 'var(--chalk-dim)',
        background: 'white',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.8rem',
        color: 'var(--muted)',
        opacity: saving ? 0.5 : 1,
        cursor: saving ? 'wait' : 'pointer',
      }}
    >
      <span style={{
        display: 'inline-block',
        width: '28px',
        height: '16px',
        borderRadius: '8px',
        background: enabled ? 'var(--court)' : '#d1d5db',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute',
          top: '2px',
          left: enabled ? '14px' : '2px',
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: 'white',
          transition: 'left 0.2s',
        }} />
      </span>
      Email notifications
    </button>
  )
}
