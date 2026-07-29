import type { PlayerDetail } from './actions'

const mono = { fontFamily: 'var(--font-mono)' } as const
const ACCURACY_BLUE = '#378ADD'

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
}: {
  detail: PlayerDetail
  overallAvg: number
  isOwnProfile: boolean
}) {
  const totals = detailTotals(detail)
  if (totals.picks === 0) {
    return <p style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>No picks recorded for this player.</p>
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
        {totals.avg >= Math.round(overallAvg)
          ? `Above ${isOwnProfile ? 'your' : 'their'} overall ${Math.round(overallAvg)} per pick.`
          : `Below ${isOwnProfile ? 'your' : 'their'} overall ${Math.round(overallAvg)} per pick.`}
        {totals.voided > 0 && ` ${totals.voided} of those picks were void — rounds they never reached.`}
      </p>

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
