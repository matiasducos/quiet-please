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
/**
 * The inverse of PlayerStat — see 062_user_missed_winners.sql.
 * `missed` counts matches this player contested where the user backed someone
 * else or left the slot blank; `missed_wins` is how many of those they won.
 */
export interface MissedPlayerStat {
  external_id: string
  name: string | null
  country: string | null
  picks: number
  missed: number
  missed_wins: number
}

const mono = { fontFamily: 'var(--font-mono)' } as const

/** Accuracy bar colour — the app's blue, distinct from the green used for points. */
const ACCURACY_BLUE = '#378ADD'
/** Warm red for the missed-winner section — reads as a cost, not a gain. */
const MISS_RED = '#993C1D'

/**
 * White rather than var(--chalk): this panel renders directly on the page
 * background, which is also var(--chalk), so a chalk card was invisible on the
 * dashboard. The border keeps it legible on any surface.
 */
function Metric({ label, value, sub, foot, footTone }: {
  label: string
  value: string
  sub?: string
  foot?: string
  footTone?: string
}) {
  return (
    <div className="rounded-sm border p-3 md:p-4" style={{ background: 'white', borderColor: 'var(--chalk-dim)' }}>
      <p style={{ ...mono, fontSize: '0.65rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '4px' }}>
        {label}
      </p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', lineHeight: 1.1, color: 'var(--ink)' }}>
        {value}
        {sub && <span style={{ ...mono, fontSize: '0.75rem', color: 'var(--muted)', marginLeft: '5px' }}>{sub}</span>}
      </p>
      {foot && (
        <p style={{ ...mono, fontSize: '0.7rem', color: footTone ?? 'var(--muted)', marginTop: '3px' }}>
          {foot}
        </p>
      )}
    </div>
  )
}

export default function PredictionStats({
  rounds,
  players,
  missedPlayers = [],
  tournamentsEntered,
  isOwnProfile,
  username,
}: {
  rounds: RoundStat[]
  players: PlayerStat[]
  missedPlayers?: MissedPlayerStat[]
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
  const earnerIds = new Set(earners.map(p => p.external_id))
  // Worst picks = backed a lot, returned little. Two steps on purpose: take the
  // poorest returners by points-per-pick, then rank *those* by how often they
  // were picked. Sorting by average alone would put someone backed 9 times for
  // nothing above someone backed 22 times for scraps, which is the opposite of
  // what "picked the most for the least" means.
  const MIN_PICKS_FOR_WORST = 4
  const worst = [...players]
    .filter(p => p.picks >= MIN_PICKS_FOR_WORST && !earnerIds.has(p.external_id))
    .sort((a, b) => (a.points / a.picks) - (b.points / b.picks))
    .slice(0, 6)
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 3)

  // Already ordered by missed_wins desc in SQL; trim to keep the panel scannable.
  const topMissed = missedPlayers.slice(0, 6)

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
        <Metric
          label="Correct picks"
          value={totalCorrect.toLocaleString()}
          sub={`of ${totalDecided.toLocaleString()}`}
          foot={totalDecided > 0 ? `${Math.round((totalCorrect / totalDecided) * 100)}% hit rate` : undefined}
          footTone={ACCURACY_BLUE}
        />
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
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: ACCURACY_BLUE, display: 'inline-block' }} />
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
                  <div style={{ height: '6px', width: `${accuracy}%`, background: ACCURACY_BLUE, borderRadius: '2px', marginBottom: '4px' }} />
                  <div style={{ height: '6px', width: `${pointsShare}%`, background: 'var(--court)', borderRadius: '2px' }} />
                </div>
                {/* Percentages sit on their own lines so each reads against its bar. */}
                <span style={{ ...mono, fontSize: '0.65rem', width: '34px', textAlign: 'right', flexShrink: 0, lineHeight: '10px' }}>
                  <span style={{ display: 'block', color: ACCURACY_BLUE, marginBottom: '4px' }}>{accuracy}%</span>
                  <span style={{ display: 'block', color: 'var(--court)' }}>{pointsShare}%</span>
                </span>
                <span className="hidden sm:inline" style={{ ...mono, fontSize: '0.68rem', color: 'var(--muted)', width: '58px', textAlign: 'right', flexShrink: 0 }}>
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
              someone deep counts once per round — including rounds they never reached, because a
              bracket is filled in before anyone plays. <strong>avg</strong> is points divided by
              those picks, so a player who went out early drags their own average down.
            </InfoBubble>
          </h3>
          <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '10px' }}>
            All time, best earners first
          </p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-2 md:px-3" style={{ ...mono, fontSize: '0.58rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              <span style={{ flex: 1, minWidth: 0 }} />
              <span style={{ width: '34px', textAlign: 'right', flexShrink: 0 }}>pk</span>
              <span style={{ width: '48px', textAlign: 'right', flexShrink: 0 }}>avg</span>
              <span style={{ width: '58px', textAlign: 'right', flexShrink: 0 }}>pts</span>
            </div>
            {earners.map(p => <PlayerRow key={p.external_id} p={p} bust={false} />)}
            {worst.length > 0 && (
              <>
                <p style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)', marginTop: '8px', marginBottom: '2px' }}>
                  Backed most, returned least
                </p>
                {worst.map(p => <PlayerRow key={p.external_id} p={p} bust />)}
              </>
            )}
          </div>
        </div>
      )}

      {/* The inverse: players who won matches after being passed over */}
      {topMissed.length > 0 && (
        <div className="bg-white rounded-sm border p-4 md:p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
          <h3 className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', marginBottom: '2px' }}>
            Ones that got away
            <InfoBubble label="ones that got away">
              Matches where {who} backed the other player — or left the slot blank — and this player
              won anyway. <strong>won</strong> is how many times that happened out of every match{' '}
              {isOwnProfile ? 'you' : username} passed on them, and <strong>rate</strong> is the share.
              A high rate on someone with a low <strong>pk</strong> is a blind spot: a player{' '}
              {isOwnProfile ? 'you rarely back' : `${username} rarely backs`} who keeps winning regardless.
            </InfoBubble>
          </h3>
          <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '10px' }}>
            All time, most costly first
          </p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-2 md:px-3" style={{ ...mono, fontSize: '0.58rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              <span style={{ flex: 1, minWidth: 0 }} />
              <span style={{ width: '34px', textAlign: 'right', flexShrink: 0 }}>pk</span>
              <span style={{ width: '48px', textAlign: 'right', flexShrink: 0 }}>won</span>
              <span style={{ width: '46px', textAlign: 'right', flexShrink: 0 }}>rate</span>
            </div>
            {topMissed.map(p => <MissedPlayerRow key={p.external_id} p={p} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function MissedPlayerRow({ p }: { p: MissedPlayerStat }) {
  const flag = nameToFlag(p.country)
  const rate = p.missed > 0 ? Math.round((p.missed_wins / p.missed) * 100) : 0
  return (
    <div className="flex items-center gap-2 px-2 md:px-3 py-2 rounded-sm" style={{ background: 'var(--chalk)' }}>
      <span style={{ ...mono, fontSize: '0.78rem', color: 'var(--ink)', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span aria-hidden="true" style={{ fontSize: '0.85rem', lineHeight: 1, width: '1.1em', flexShrink: 0, textAlign: 'center' }}>
          {flag ?? ''}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.name ?? 'Unknown player'}
        </span>
      </span>
      {/* Zero picks is the interesting case, not a gap — a player never backed
          once who kept winning. Dimmed rather than hidden so it reads as "never". */}
      <span style={{ ...mono, fontSize: '0.7rem', color: p.picks === 0 ? 'var(--muted)' : 'var(--ink)', width: '34px', textAlign: 'right', flexShrink: 0 }}>
        {p.picks}
      </span>
      <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', width: '48px', textAlign: 'right', flexShrink: 0 }}>
        {p.missed_wins}/{p.missed}
      </span>
      <span style={{ ...mono, fontSize: '0.75rem', color: MISS_RED, width: '46px', textAlign: 'right', flexShrink: 0 }}>
        {rate}%
      </span>
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
      <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', width: '34px', textAlign: 'right', flexShrink: 0 }}>
        {p.picks}
      </span>
      {/* Average over every pick, including ones made for rounds the player never
          reached — the cost of backing someone who went out early is part of
          what a pick returned. */}
      <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', width: '48px', textAlign: 'right', flexShrink: 0 }}>
        {p.picks > 0 ? Math.round(p.points / p.picks).toLocaleString() : 0}
      </span>
      <span style={{ ...mono, fontSize: '0.75rem', color: p.points > 0 ? 'var(--ink)' : 'var(--muted)', width: '58px', textAlign: 'right', flexShrink: 0 }}>
        {p.points.toLocaleString()}
      </span>
    </div>
  )
}
