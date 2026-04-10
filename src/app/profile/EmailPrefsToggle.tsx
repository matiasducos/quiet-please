'use client'

import { useState } from 'react'
import { updateEmailPreferences } from './actions'
import {
  type EmailPreferences,
  type EmailPrefKey,
  EMAIL_PREF_KEYS,
  EMAIL_PREF_LABELS,
  DEFAULT_EMAIL_PREFERENCES,
} from '@/lib/email-preferences'

function Toggle({ enabled, disabled }: { enabled: boolean; disabled?: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      width: '28px',
      height: '16px',
      borderRadius: '8px',
      background: enabled ? 'var(--court)' : '#d1d5db',
      position: 'relative',
      transition: 'background 0.2s',
      flexShrink: 0,
      opacity: disabled ? 0.4 : 1,
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
  )
}

export default function EmailPrefsToggle({
  initialPreferences,
}: {
  initialPreferences: EmailPreferences
}) {
  const [prefs, setPrefs] = useState<EmailPreferences>(initialPreferences)
  const [saving, setSaving] = useState(false)

  const allEnabled = EMAIL_PREF_KEYS.every(k => prefs[k])
  const someEnabled = EMAIL_PREF_KEYS.some(k => prefs[k])

  async function save(next: EmailPreferences) {
    const prev = prefs
    setSaving(true)
    setPrefs(next)
    const { ok } = await updateEmailPreferences(next)
    if (!ok) setPrefs(prev)
    setSaving(false)
  }

  function handleMasterToggle() {
    if (allEnabled) {
      // Turn all off
      const next = { ...prefs }
      for (const k of EMAIL_PREF_KEYS) next[k] = false
      save(next)
    } else {
      // Turn all on
      save({ ...DEFAULT_EMAIL_PREFERENCES })
    }
  }

  function handleToggle(key: EmailPrefKey) {
    save({ ...prefs, [key]: !prefs[key] })
  }

  return (
    <div
      className="bg-white rounded-sm border overflow-hidden"
      style={{ borderColor: 'var(--chalk-dim)', opacity: saving ? 0.6 : 1, transition: 'opacity 0.15s' }}
    >
      {/* Master toggle */}
      <button
        onClick={handleMasterToggle}
        disabled={saving}
        className="w-full flex items-center justify-between px-4 py-3 border-b hover:bg-gray-50 transition-colors"
        style={{ borderColor: 'var(--chalk-dim)', cursor: saving ? 'wait' : 'pointer' }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)', fontWeight: 500 }}>
          Email notifications
        </span>
        <Toggle enabled={someEnabled} />
      </button>

      {/* Individual toggles */}
      {EMAIL_PREF_KEYS.map(key => (
        <button
          key={key}
          onClick={() => handleToggle(key)}
          disabled={saving}
          className="w-full flex items-center justify-between px-4 py-2.5 border-b last:border-0 hover:bg-gray-50 transition-colors"
          style={{ borderColor: 'var(--chalk-dim)', cursor: saving ? 'wait' : 'pointer' }}
        >
          <div className="text-left">
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--ink)' }}>
              {EMAIL_PREF_LABELS[key].label}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.4, marginTop: '1px' }}>
              {EMAIL_PREF_LABELS[key].description}
            </div>
          </div>
          <Toggle enabled={prefs[key]} />
        </button>
      ))}
    </div>
  )
}
