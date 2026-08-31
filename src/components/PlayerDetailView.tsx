import type { PlayerDetail } from '@/app/actions/player-detail'

const mono = { fontFamily: 'var(--font-mono)' } as const
const ACCURACY_BLUE = '#378ADD'
/** Same red the dashboard's "Ones that got away" panel uses, so the two read as one metric. */
const MISS_RED = '#993C1D'

/**
 * The matches this player won after being passed over.
 *
 * The counterpart to everything else here, which is all about picks that were
 * made. On the profile it is a blind-spot report; in the predict drawer it is
 * the number that actually informs the choice in front of you, which is why it
 * renders even when there is no pick history at all to sit above it.
 *
 * Hidden at `missed === 0`, because zero carries two meanings that must not be
 * confused: never encountered, and encountered but never punished. Saying "0%"
 * would assert the second when it is usually the first.
 */
function GotAway({ missed, missedWins, isOwnProfile }: { missed: number; missedWins: number; isOwnProfile: boolean }) {
  if (missed === 0) return null
  const rate = Math.round((missedWins / missed) * 100)
  const who = isOwnProfile ? 'you' : 'they'
  return (
    <div className="rounded-sm border px-3 py-2.5 mb-4" style={{ borderColor: '#f4c5ba', background: '#fdf2ed' }}>
      <p style={{ ...mono, fontSize: '0.55rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: MISS_RED, marginBottom: '3px' }}>
        Ones that got away
      </p>
      <p style={{ ...mono, fontSize: '0.72rem', color: 'var(--ink)', lineHeight: 1.6 }}>
        Won <strong style={{ color: MISS_RED }}>{missedWins} of the {missed}</strong> match{missed === 1 ? '' : 'es'}{' '}
        {who} passed on <span style={{ color: MISS_RED }}>({rate}%)</span>.
      </p>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-sm p-2.5" style={{ background: 'var(--chalk)' }}>
      <p style={{ ...mono, fontSize: '0.58rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '3px' }}>
        {label}
      </p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', lineHeight: 1.1, color: tone ?? 'var(--ink)' }}>
        {value}
      </p>
    </div>
  )
}

export function detailTotals(detail: PlayerDetail) {
  const picks = detail.rounds.reduce((s, r) => s + Number(r.picks), 0)
  const wins  = detail.rounds.reduce((s, r) => s + Number(r.wins), 0)
  const voided = detail.rounds.reduce((s, r) => s + Number(r.voided), 0)
  const pts   = detail.rounds.reduce((s, r) => s + Number(r.points), 0)
  return { picks, wins, voided, pts, avg: picks > 0 ? Math.round(pts / picks) : 0 }
}

/**
 * Presentation only — takes an already-fetched breakdown. Split from PlayerLookup
 * so the tables can be rendered without a session or a server round trip.
 */
export default function PlayerDetailView({
  detail,
  overallAvg,
  isOwnProfile,
  playerName,
}: {
  detail: PlayerDetail
  /** viewer's own points-per-pick, for context. Omit to hide the comparison line. */
  overallAvg?: number
  isOwnProfile: boolean
  /**
   * Names the player in the empty state. Optional because the profile's lookup
   * only offers players already picked, so it never reaches that branch — the
   * predict drawer, which opens on whoever is in the match, always does.
   */
  playerName?: string
}) {
  const totals = detailTotals(detail)

  // No picks is not the end of the story any more. A player never backed once
  // who keeps winning is the single most useful thing this drawer can say at
  // the moment of a pick, so the got-away line renders here too rather than
  // being stranded behind a record that does not exist.
  if (totals.picks === 0) {
    return (
      <>
        <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', marginBottom: detail.missed > 0 ? '10px' : 0 }}>
          {playerName
            ? `${isOwnProfile ? 'You have' : 'They have'} never picked ${playerName}.`
            : 'No picks recorded for this player.'}
        </p>
        <GotAway missed={detail.missed} missedWins={detail.missedWins} isOwnProfile={isOwnProfile} />
      </>
    )
  }

  return (
    <>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mb-4">
        <Stat label="Picks" value={String(totals.picks)} />
        <Stat label="Wins" value={String(totals.wins)} />
        <Stat label="Win rate" value={`${Math.round((totals.wins / totals.picks) * 100)}%`} tone={ACCURACY_BLUE} />
        <Stat label="Points" value={totals.pts.toLocaleString()} />
        <Stat label="Avg / pick" value={totals.avg.toLocaleString()} />
      </div>

      <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '14px', lineHeight: 1.6 }}>
        {overallAvg === undefined ? '' : totals.avg >= Math.round(overallAvg)
          ? `Above ${isOwnProfile ? 'your' : 'their'} overall ${Math.round(overallAvg)} per pick.`
          : `Below ${isOwnProfile ? 'your' : 'their'} overall ${Math.round(overallAvg)} per pick.`}
        {totals.voided > 0 && ` ${totals.voided} of those picks were void — rounds they never reached.`}
      </p>

      <GotAway missed={detail.missed} missedWins={detail.missedWins} isOwnProfile={isOwnProfile} />

      <p style={{ ...mono, fontSize: '0.58rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '6px' }}>
        By round
      </p>
      <div className="flex flex-col gap-1 mb-4">
        <div className="flex items-center gap-2 px-2" style={{ ...mono, fontSize: '0.55rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          <span style={{ width: '38px', flexShrink: 0 }} />
          <span style={{ flex: 1 }} />
          <span style={{ width: '46px', textAlign: 'right' }}>w/pk</span>
          <span style={{ width: '38px', textAlign: 'right' }}>void</span>
          <span style={{ width: '54px', textAlign: 'right' }}>pts</span>
        </div>
        {detail.rounds.map(r => {
          const picks = Number(r.picks), wins = Number(r.wins)
          const rate = picks > 0 ? Math.round((wins / picks) * 100) : 0
          return (
            <div key={r.round} className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{ background: 'var(--chalk)' }}>
              <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', width: '38px', flexShrink: 0 }}>{r.round}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', height: '5px', width: `${rate}%`, background: ACCURACY_BLUE, borderRadius: '2px' }} />
              </span>
              <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--ink)', width: '46px', textAlign: 'right', flexShrink: 0 }}>
                {wins}/{picks}
              </span>
              <span style={{ ...mono, fontSize: '0.7rem', color: Number(r.voided) > 0 ? '#993C1D' : 'var(--muted)', width: '38px', textAlign: 'right', flexShrink: 0 }}>
                {Number(r.voided) || '—'}
              </span>
              <span style={{ ...mono, fontSize: '0.72rem', color: 'var(--ink)', width: '54px', textAlign: 'right', flexShrink: 0 }}>
                {Number(r.points).toLocaleString()}
              </span>
            </div>
          )
        })}
      </div>

      <p style={{ ...mono, fontSize: '0.58rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '6px' }}>
        By tournament
      </p>
      <div className="flex flex-col gap-1">
        {detail.tournaments.map(t => (
          <div key={t.tournament_id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{ background: 'var(--chalk)' }}>
            <span style={{ ...mono, fontSize: '0.72rem', color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.flag_emoji && <span aria-hidden="true" style={{ marginRight: '4px' }}>{t.flag_emoji}</span>}
              {t.location ?? t.name}
            </span>
            <span style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)', width: '46px', textAlign: 'right', flexShrink: 0 }}>
              {t.exit_round ? `out ${t.exit_round}` : '—'}
            </span>
            <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--ink)', width: '46px', textAlign: 'right', flexShrink: 0 }}>
              {Number(t.wins)}/{Number(t.picks)}
            </span>
            <span style={{ ...mono, fontSize: '0.72rem', color: Number(t.points) > 0 ? 'var(--ink)' : 'var(--muted)', width: '54px', textAlign: 'right', flexShrink: 0 }}>
              {Number(t.points).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
