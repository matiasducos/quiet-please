'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import CountryFlag from './CountryFlag'
import PlayerDetailView from './PlayerDetailView'
import { getMyPlayerDetail, type PlayerDetail } from '@/app/actions/player-detail'

interface DrawerPlayer {
  externalId: string
  name: string
  country: string
}

const mono = { fontFamily: 'var(--font-mono)' } as const

/**
 * Your own record backing each of the two players in a match — the same
 * breakdown the profile Stats tab shows, brought to the point of decision.
 *
 * Both players load in parallel, and each renders independently: a player you
 * have never picked is a normal outcome here (unlike on the profile, where the
 * search only offers players you have picked), so an empty record still renders
 * — PlayerDetailView owns that state, because even with no picks there is the
 * got-away count to show, and that is the number this drawer exists to deliver.
 */
export default function PlayerStatsDrawer({
  player1,
  player2,
  onClose,
}: {
  player1: DrawerPlayer
  player2: DrawerPlayer
  onClose: () => void
}) {
  const [details, setDetails] = useState<Record<string, PlayerDetail | null>>({})
  // Starts true and is only ever cleared: the caller keys this component by the
  // player pair, so a different match mounts a fresh instance rather than
  // re-running the effect on a stale one.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getMyPlayerDetail(player1.externalId),
      getMyPlayerDetail(player2.externalId),
    ])
      .then(([d1, d2]) => {
        if (cancelled) return
        setDetails({ [player1.externalId]: d1, [player2.externalId]: d2 })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [player1.externalId, player2.externalId])

  // A missing session fails both players at once, so it is a state of the whole
  // drawer rather than a per-player empty record.
  const needsSignIn = Object.values(details).some(d => d?.reason === 'unauthenticated')

  // Escape closes, matching the H2H drawer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div
        className="fixed inset-0 hidden md:block"
        style={{ zIndex: 60, background: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
      />

      <div
        className="fixed top-0 right-0 bottom-0 w-full md:w-[440px] overflow-y-auto"
        style={{ zIndex: 61, background: '#fafaf8', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
      >
        <div
          className="sticky top-0 px-4 py-3 border-b flex items-center justify-between"
          style={{ background: '#fafaf8', borderColor: 'var(--chalk-dim)', zIndex: 1 }}
        >
          <span style={{ ...mono, fontSize: '0.65rem', letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            Your record
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center"
            style={{ width: 28, height: 28, borderRadius: '4px', color: 'var(--muted)', fontSize: '1.1rem', lineHeight: 1, border: '1px solid var(--chalk-dim)', background: 'white' }}
          >
            ×
          </button>
        </div>

        <div className="px-4 py-4 flex flex-col gap-5">
          {loading ? (
            <p style={{ ...mono, fontSize: '0.75rem', color: 'var(--muted)' }}>Loading your record…</p>
          ) : needsSignIn ? (
            <div className="bg-white rounded-sm border p-4" style={{ borderColor: 'var(--chalk-dim)' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink)', lineHeight: 1.5, marginBottom: '0.75rem' }}>
                Sign in to see how you have fared backing {player1.name} and {player2.name}.
              </p>
              <Link
                href="/login"
                className="inline-block px-4 py-2 text-sm font-medium rounded-sm hover:opacity-90"
                style={{ background: 'var(--court)', color: 'white', textDecoration: 'none' }}
              >
                Sign in →
              </Link>
            </div>
          ) : (
            [player1, player2].map(p => {
              const detail = details[p.externalId]
              return (
                <section key={p.externalId} className="bg-white rounded-sm border p-3" style={{ borderColor: 'var(--chalk-dim)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <CountryFlag country={p.country} />
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--ink)' }}>
                      {p.name}
                    </span>
                  </div>

                  {!detail?.ok ? (
                    <p style={{ ...mono, fontSize: '0.7rem', color: '#991b1b' }}>Could not load your record.</p>
                  ) : (
                    // The never-picked case lives in PlayerDetailView now. It used
                    // to short-circuit here, which meant the one line worth reading
                    // about a player you have never backed — how often they have
                    // beaten you anyway — could not be shown at all.
                    <PlayerDetailView detail={detail} isOwnProfile playerName={p.name} />
                  )}
                </section>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
