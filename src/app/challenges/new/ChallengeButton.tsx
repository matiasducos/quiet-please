'use client'

import { useState } from 'react'
import { createChallenge } from './actions'
import type { ScopeOption } from '@/lib/challenges/scope'

const mono = { fontFamily: 'var(--font-mono)' } as const

/**
 * Step 3 — how much of the draw to play for, then create.
 *
 * The scope choice lives on its own step rather than as a control on each
 * tournament card: the options depend on how far that tournament has actually
 * got, which needs its draw and its results, and fetching those for sixty
 * tournaments to render a list would be absurd.
 *
 * The button says "Create and pick" because that is what happens — the
 * challenge lands as a draft and the challenger goes straight to their bracket.
 * Nothing is sent to anyone until they press send on the next screen.
 */
export default function ChallengeButton({
  friendId,
  tournamentId,
  friendUsername,
  scopes,
}: {
  friendId: string
  tournamentId: string
  friendUsername: string
  scopes: ScopeOption[]
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<string>(() => {
    // Default to the smallest contest on offer. The full draw is 127 matches at
    // a slam and is why challenges do not get finished; when there is a shorter
    // option it is almost always the one two people will actually complete.
    const smallest = scopes.reduce<ScopeOption | null>(
      (best, o) => (!best || o.matchCount < best.matchCount ? o : best),
      null,
    )
    return smallest?.round ?? ''
  })

  return (
    <form
      action={async (formData) => {
        if (submitting) return
        setSubmitting(true)
        setError(null)
        const result = await createChallenge(formData)
        // redirect() throws and never returns — reaching here means an error
        setSubmitting(false)
        if (result?.error) setError(result.error)
      }}
    >
      <input type="hidden" name="friend_id" value={friendId} />
      <input type="hidden" name="tournament_id" value={tournamentId} />
      <input type="hidden" name="scope_round" value={scope} />

      {/* Stated, not chosen. `availableScopes` returns exactly one legal option
          at a time — you cannot pick a quarterfinal before you know who is in
          it — so a radio group here would be a choice of one. If a second axis
          ever offers a real alternative, the list below grows into one. */}
      {scopes.length === 1 ? (
        <div
          className="rounded-sm border px-4 py-3 mb-6"
          style={{ borderColor: 'var(--chalk-dim)', background: '#f4f9ee' }}
        >
          <p style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '2px' }}>
            {scopes[0].label}
            <span style={{ ...mono, fontSize: '0.72rem', color: 'var(--muted)' }}>
              {' · '}{scopes[0].matchCount} match{scopes[0].matchCount === 1 ? '' : 'es'} each
            </span>
          </p>
          <p style={{ ...mono, fontSize: '0.66rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            {scopes[0].round
              ? 'The rounds before this one have been played, so the contest starts here.'
              : 'The whole draw — a round can only be played on its own once the players who reach it are known.'}
          </p>
        </div>
      ) : (
        <fieldset className="mb-6">
          <legend
            style={{ ...mono, fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.6rem' }}
          >
            How much of the draw
          </legend>
          <div className="flex flex-col gap-2">
            {scopes.map(option => {
              const value = option.round ?? ''
              const active = scope === value
              return (
                <label
                  key={value || 'full'}
                  className="flex items-center gap-3 rounded-sm border px-4 py-3 cursor-pointer"
                  style={{
                    borderColor: active ? 'var(--court)' : 'var(--chalk-dim)',
                    background: active ? '#f4f9ee' : 'white',
                  }}
                >
                  <input
                    type="radio"
                    name="scope_choice"
                    value={value}
                    checked={active}
                    onChange={() => setScope(value)}
                    style={{ accentColor: 'var(--court)', flexShrink: 0 }}
                  />
                  <span className="flex-1 min-w-0">
                    <span style={{ fontSize: '0.9rem', color: 'var(--ink)', display: 'block' }}>
                      {option.label}
                    </span>
                    <span style={{ ...mono, fontSize: '0.66rem', color: 'var(--muted)' }}>
                      {option.matchCount} match{option.matchCount === 1 ? '' : 'es'} each
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium text-white rounded-sm hover:opacity-90 disabled:opacity-40"
        style={{ background: 'var(--court)' }}
      >
        {submitting ? 'Creating…' : 'Create and pick →'}
      </button>
      <p style={{ ...mono, fontSize: '0.66rem', color: 'var(--muted)', marginTop: '0.6rem', lineHeight: 1.6 }}>
        {friendUsername} hears nothing until you have made your picks and pressed send.
      </p>

      {error && (
        <p style={{ ...mono, fontSize: '0.7rem', color: '#c84b31', marginTop: '0.75rem', lineHeight: 1.4 }}>
          {error}
        </p>
      )}
    </form>
  )
}
