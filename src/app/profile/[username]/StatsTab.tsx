import { ROUND_ORDER } from '@/lib/tennis/my-tournament'
import { nameToFlag } from '@/app/admin/countries'
import InfoBubble from '@/components/InfoBubble'

export interface RoundStat { round: string; decided: number; correct: number; points: number }
export interface PlayerStat {
  external_id: string
  name: string | null
  country: string | null
  picks: number
  points: number
}

const mono = { fontFamily: 'var(--font-mono)' } as const

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-sm p-3 md:p-4" style={{ background: 'var(--chalk)' }}>
      <p style={{ ...mono, fontSize: '0.65rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '4px' }}>
        {label}
      </p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', lineHeight: 1.1, color: 'var(--ink)' }}>
        {value}
        {sub && <span style={{ ...mono, fontSize: '0.75rem', color: 'var(--muted)', marginLeft: '5px' }}>{sub}</span>}
      </p>
    </div>
  )
}

export default function StatsTab({
  rounds,
  players,
  tournamentsEntered,
  isOwnProfile,
  username,
}: {
  rounds: RoundStat[]
  players: PlayerStat[]
  tournamentsEntered: number
  isOwnProfile: boolean
  username: string
}) {
  const totalPoints  = rounds.reduce((s, r) => s + r.points, 0)
  const totalCorrect = rounds.reduce((s, r) => s + r.correct, 0)
  const totalDecided = rounds.reduce((s, r) => s + r.decided, 0)

  // Order by draw position rather than whatever the aggregate returned.
  const ordered = [...rounds].sort(
    (a, b) => ROUND_ORDER.indexOf(a.round as typeof ROUND_ORDER[number]) - ROUND_ORDER.indexOf(b.round as typeof ROUND_ORDER[number]),
  )

  const earners = players.filter(p => p.points > 0).slice(0, 8)
  // Most-backed players who returned nothing — the same inverse that makes the
  // per-tournament panel readable, but across a whole career it is more damning.
  const busts = [...players]
    .filter(p => p.points === 0 && p.picks >= 2)
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 3)

  const who = isOwnProfile ? 'you' : username

  if (totalDecided === 0) {
    return (
      <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
        <p style={{ ...mono, fontSize: '0.8rem', color: 'var(--muted)' }}>
          {isOwnProfile
            ? 'No completed predictions yet. Enter a tournament and your record will build up here.'
            : `${username} has no completed predictions yet.`}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
        <Metric label="Points all time" value={totalPoints.toLocaleString()} />
        <Metric label="Correct picks" value={totalCorrect.toLocaleString()} sub={`of ${totalDecided.toLocaleString()}`} />
        <Metric label="Tournaments" value={String(tournamentsEntered)} />
      </div>

      {/* Round by round, aggregated across every tournament entered */}
      <div className="bg-white rounded-sm border p-4 md:p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
        <h3 className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', marginBottom: '6px' }}>
          Round by round
          <InfoBubble label="round by round">
            Every tournament {who} {isOwnProfile ? 'have' : 'has'} entered, combined. The grey bar is
            how many matches were called correctly in that round; the green bar is how much of the
            all-time total came from it. Later rounds are worth far more per match, so the two rarely
            line up.
          </InfoBubble>
        </h3>
        <div className="flex items-center gap-4 mb-3" style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)' }}>
          <span className="flex items-center gap-1.5">
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chalk-dim)', display: 'inline-block' }} />
            Accuracy
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--court)', display: 'inline-block' }} />
            Share of points
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          {ordered.map(r => {
            const accuracy    = r.decided > 0 ? Math.round((r.correct / r.decided) * 100) : 0
            const pointsShare = totalPoints > 0 ? Math.round((r.points / totalPoints) * 100) : 0
            return (
              <div key={r.round} className="flex items-center gap-2 md:gap-3">
                <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', width: '34px', flexShrink: 0 }}>
                  {r.round}
                </span>
                <div className="flex-1 min-w-0">
                  <div style={{ height: '6px', width: `${accuracy}%`, background: 'var(--chalk-dim)', borderRadius: '2px', marginBottom: '3px' }} />
                  <div style={{ height: '6px', width: `${pointsShare}%`, background: 'var(--court)', borderRadius: '2px' }} />
                </div>
                <span style={{ ...mono, fontSize: '0.68rem', color: 'var(--muted)', width: '58px', textAlign: 'right', flexShrink: 0 }}>
                  {r.correct}/{r.decided}
                </span>
                <span style={{ ...mono, fontSize: '0.72rem', color: 'var(--ink)', width: '56px', textAlign: 'right', flexShrink: 0 }}>
                  {r.points.toLocaleString()}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Players, all time */}
      {earners.length > 0 && (
        <div className="bg-white rounded-sm border p-4 md:p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
          <h3 className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', marginBottom: '2px' }}>
            Players
            <InfoBubble label="players">
              Who {who} {isOwnProfile ? 'have' : 'has'} backed across every tournament, and what they
              returned. <strong>pk</strong> counts each match a player was picked to win, so backing
              someone deep counts once per round.
            </InfoBubble>
          </h3>
          <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '10px' }}>
            All time, best earners first
          </p>
          <div className="flex flex-col gap-1">
            {earners.map(p => <PlayerRow key={p.external_id} p={p} bust={false} />)}
            {busts.length > 0 && (
              <>
                <p style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)', marginTop: '8px', marginBottom: '2px' }}>
                  Backed but never paid off
                </p>
                {busts.map(p => <PlayerRow key={p.external_id} p={p} bust />)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PlayerRow({ p, bust }: { p: PlayerStat; bust: boolean }) {
  const flag = nameToFlag(p.country)
  return (
    <div className="flex items-center gap-2 px-2 md:px-3 py-2 rounded-sm" style={{ background: bust ? '#fdf2ed' : 'var(--chalk)' }}>
      <span style={{ ...mono, fontSize: '0.78rem', color: bust ? '#993C1D' : 'var(--ink)', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span aria-hidden="true" style={{ fontSize: '0.85rem', lineHeight: 1, width: '1.1em', flexShrink: 0, textAlign: 'center' }}>
          {flag ?? ''}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.name ?? 'Unknown player'}
        </span>
      </span>
      <span style={{ ...mono, fontSize: '0.68rem', color: 'var(--muted)', width: '48px', textAlign: 'right', flexShrink: 0 }}>
        {p.picks}<span style={{ opacity: 0.7 }}>&nbsp;pk</span>
      </span>
      <span style={{ ...mono, fontSize: '0.75rem', color: p.points > 0 ? 'var(--ink)' : 'var(--muted)', width: '64px', textAlign: 'right', flexShrink: 0 }}>
        {p.points.toLocaleString()}
      </span>
    </div>
  )
}
