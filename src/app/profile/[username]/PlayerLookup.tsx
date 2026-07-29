'use client'

import { useState, useMemo, useTransition } from 'react'
import { nameToFlag } from '@/app/admin/countries'
import InfoBubble from '@/components/InfoBubble'
import type { PlayerStat } from '@/components/PredictionStats'
import { getPlayerDetail, type PlayerDetail } from './actions'
import PlayerDetailView from './PlayerDetailView'

const mono = { fontFamily: 'var(--font-mono)' } as const

const inputStyle = {
  ...mono, fontSize: '0.8rem', padding: '8px 10px',
  border: '1px solid var(--chalk-dim)', borderRadius: '2px',
  background: 'white', color: 'var(--ink)', width: '100%',
} as const

export default function PlayerLookup({
  players,
  profileUserId,
  isOwnProfile,
  username,
}: {
  players: PlayerStat[]
  profileUserId: string
  isOwnProfile: boolean
  username: string
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<PlayerStat | null>(null)
  const [detail, setDetail] = useState<PlayerDetail | null>(null)
  const [pending, startTransition] = useTransition()

  // The picked-player list is small (136 for the heaviest user today), so
  // filtering happens here rather than round-tripping on every keystroke.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return players.filter(p => (p.name ?? '').toLowerCase().includes(q)).slice(0, 8)
  }, [query, players])

  // The viewer's own baseline, so a player's return has something to read against.
  const overallAvg = useMemo(() => {
    const picks = players.reduce((s, p) => s + p.picks, 0)
    const pts   = players.reduce((s, p) => s + p.points, 0)
    return picks > 0 ? pts / picks : 0
  }, [players])

  function select(p: PlayerStat) {
    setSelected(p)
    setQuery('')
    setDetail(null)
    startTransition(async () => {
      setDetail(await getPlayerDetail(profileUserId, p.external_id))
    })
  }

  const who = isOwnProfile ? 'you' : username

  return (
    <div className="bg-white rounded-sm border p-4 md:p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
      <h3 className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', marginBottom: '2px' }}>
        Look up a player
        <InfoBubble label="look up a player">
          Search any player {who} {isOwnProfile ? 'have' : 'has'} picked, for a full breakdown by
          round and by tournament. <strong>dead</strong> counts picks for rounds the player never
          reached — a bracket is filled in before play, so backing someone deep costs a pick per
          round whether or not they got there.
        </InfoBubble>
      </h3>
      <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '10px' }}>
        {players.length} player{players.length === 1 ? '' : 's'} picked all time
      </p>

      <div style={{ position: 'relative' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search picked players"
          style={inputStyle}
        />
        {matches.length > 0 && (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
              background: 'white', border: '1px solid var(--chalk-dim)', borderRadius: '2px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)', maxHeight: '260px', overflowY: 'auto',
            }}
          >
            {matches.map(p => (
              <button
                key={p.external_id}
                onClick={() => select(p)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80"
                style={{ ...mono, fontSize: '0.75rem', background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <span aria-hidden="true" style={{ width: '1.1em', textAlign: 'center', flexShrink: 0 }}>
                  {nameToFlag(p.country) ?? ''}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>
                  {p.name ?? p.external_id}
                </span>
                <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{p.picks} pk</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {query.trim() && matches.length === 0 && (
        <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', marginTop: '8px' }}>
          No picked player matches that. Only players {who} {isOwnProfile ? 'have' : 'has'} actually
          picked appear here.
        </p>
      )}

      {selected && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <span aria-hidden="true" style={{ fontSize: '1rem' }}>{nameToFlag(selected.country) ?? ''}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--ink)', flex: 1, minWidth: 0 }}>
              {selected.name ?? selected.external_id}
            </span>
            <button
              onClick={() => { setSelected(null); setDetail(null) }}
              style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              clear
            </button>
          </div>

          {pending || !detail ? (
            <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>Loading…</p>
          ) : !detail.ok ? (
            <p style={{ ...mono, fontSize: '0.7rem', color: '#991b1b' }}>Could not load this player&apos;s breakdown.</p>
          ) : (
            <PlayerDetailView detail={detail} overallAvg={overallAvg} isOwnProfile={isOwnProfile} />
          )}
        </div>
      )}
    </div>
  )
}
