import type { MyTournament, PlayerSummary } from '@/lib/tennis/my-tournament'
import { ROUND_LABEL } from '@/lib/tennis/my-tournament'
import InfoBubble from '@/components/InfoBubble'
import { nameToFlag } from '@/app/admin/countries'

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

/** Flag emoji plus name. Country comes from the draw snapshot, so it can be absent. */
function PlayerName({ p, color }: { p: PlayerSummary; color: string }) {
  const flag = nameToFlag(p.country)
  return (
    <span style={{ ...mono, fontSize: '0.78rem', color, flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span aria-hidden="true" style={{ fontSize: '0.85rem', lineHeight: 1, width: '1.1em', flexShrink: 0, textAlign: 'center' }}>
        {flag ?? ''}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {p.name}
      </span>
    </span>
  )
}

function PlayerLine({ p, tone, isChampion, isFinished }: { p: PlayerSummary; tone: 'alive' | 'neutral' | 'bust'; isChampion: boolean; isFinished: boolean }) {
  const bg = tone === 'alive' ? '#edf7f0' : tone === 'bust' ? '#fdf2ed' : 'var(--chalk)'
  const nameColor = tone === 'bust' ? '#993C1D' : 'var(--ink)'
  // "Alive" is derived from never having lost. On a finished tournament that is
  // true of the champion — and also of anyone whose defeat was never recorded
  // (a withdrawal, or a missing result). Only one player can still be standing,
  // so everyone else is out; we just don't know which round.
  const statusLabel = isChampion
    ? 'champion'
    : p.alive
      ? (isFinished ? 'out' : 'alive')
      : `out ${p.outRound ?? ''}`
  return (
    <div className="flex items-center gap-2 px-2 md:px-3 py-2 rounded-sm" style={{ background: bg }}>
      <PlayerName p={p} color={nameColor} />
      <span style={{ ...mono, fontSize: '0.68rem', color: 'var(--muted)', width: '44px', textAlign: 'right', flexShrink: 0 }}>
        {p.picks}<span style={{ opacity: 0.7 }}>&nbsp;pk</span>
      </span>
      <span style={{ ...mono, fontSize: '0.75rem', color: p.points > 0 ? 'var(--ink)' : 'var(--muted)', width: '58px', textAlign: 'right', flexShrink: 0 }}>
        {p.points.toLocaleString()}
      </span>
      <span style={{ ...mono, fontSize: '0.62rem', width: '58px', textAlign: 'right', flexShrink: 0, color: isChampion || (p.alive && !isFinished) ? '#1a6b3c' : 'var(--muted)' }}>
        {statusLabel}
      </span>
    </div>
  )
}

export default function MyTournamentPanel({
  data,
  isComplete,
}: {
  data: MyTournament
  isComplete: boolean
}) {
  const { pointsSoFar, correct, decided, aliveCount, distinctPicked, currentRound, championExternalId, rounds, stillRiding, aliveIdle, players } = data

  const topEarners = players.filter(p => p.points > 0).slice(0, 5)
  // Early in a draw almost nobody has been eliminated, so this list would run to
  // every player picked. Cap it — the point is the few with most at stake.
  const RIDING_LIMIT = 5
  const ridingShown = stillRiding.slice(0, RIDING_LIMIT)
  const ridingRest  = stillRiding.length - ridingShown.length
  // Players backed more than once who returned nothing — the inverse of the
  // earners list, and where the interesting information actually is.
  const busts = players
    .filter(p => p.points === 0 && p.picks >= 2)
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 3)

  return (
    <section className="bg-white rounded-sm border p-4 md:p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <h2 className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
          Your tournament
          <InfoBubble label="your tournament">
            How your bracket is doing so far. <strong>Points so far</strong> counts only
            matches already played. <strong>Correct picks</strong> compares your bracket
            against every match decided so far. <strong>Still alive</strong> is how many of
            the players you picked have not lost yet.
          </InfoBubble>
        </h2>
        {currentRound && (
          <span style={{
            ...mono, fontSize: '0.65rem', color: '#1a6b3c', background: '#edf7f0',
            padding: '2px 8px', borderRadius: '2px',
          }}>
            {isComplete ? 'Final result' : `${ROUND_LABEL[currentRound] ?? currentRound} complete`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 mb-6">
        <Metric label="Points so far" value={pointsSoFar.toLocaleString()} />
        <Metric label="Correct picks" value={String(correct)} sub={`of ${decided}`} />
        {!isComplete && <Metric label="Still alive" value={String(aliveCount)} sub={`of ${distinctPicked}`} />}
      </div>

      {/* Still riding — the follow list. Only meaningful mid-tournament. */}
      {!isComplete && stillRiding.length > 0 && (
        <div className="mb-6">
          <h3 className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', marginBottom: '2px' }}>
            Still riding on
            <InfoBubble label="still riding on">
              Players you picked who have not lost yet, ranked by how much you still
              stand to gain from them. <strong>3 to come</strong> means three of their
              matches are still picked in your bracket. A player who survives past the
              round you predicted them out in stays in the draw but has nothing riding
              on them, so they drop to the summary line.
            </InfoBubble>
          </h3>
          <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '8px' }}>
            Players you picked who are still in the draw
          </p>
          <div className="flex flex-col gap-1.5">
            {ridingShown.map(p => (
              <div key={p.externalId} className="flex items-center gap-2 md:gap-3 px-3 py-2 rounded-sm" style={{ background: '#edf7f0' }}>
                <PlayerName p={p} color="var(--ink)" />
                <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>
                  {p.points.toLocaleString()} pts
                </span>
                <span style={{
                  ...mono, fontSize: '0.65rem', color: '#1a6b3c', background: 'white',
                  padding: '2px 8px', borderRadius: '2px', whiteSpace: 'nowrap',
                }}>
                  {p.riding} to come
                </span>
              </div>
            ))}
            {(ridingRest > 0 || aliveIdle.length > 0) && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-sm" style={{ background: 'var(--chalk)' }}>
                <span style={{ ...mono, fontSize: '0.72rem', color: 'var(--muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ridingRest > 0
                    ? `${ridingRest} more still riding`
                    : aliveIdle.slice(0, 3).map(p => p.name).join(', ') + (aliveIdle.length > 3 ? ` +${aliveIdle.length - 3}` : '')}
                </span>
                <span style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {ridingRest > 0
                    ? `${aliveIdle.length} with nothing riding`
                    : 'nothing riding'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Round by round — accuracy against share of points */}
      {rounds.length > 0 && (
        <div className="mb-6">
          <h3 className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', marginBottom: '6px' }}>
            Round by round
            <InfoBubble label="round by round">
              The grey bar is how many matches you called correctly in that round. The
              green bar is how much of your total came from it. The two rarely line up:
              later rounds are worth far more per match and the streak bonus compounds,
              so a round can have low accuracy and still be where most of your points
              came from.
            </InfoBubble>
          </h3>
          <div className="flex items-center gap-4 mb-3" style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)' }}>
            <span className="flex items-center gap-1.5">
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chalk-dim)', display: 'inline-block' }} />
              Accuracy
            </span>
            <span className="flex items-center gap-1.5">
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--court)', display: 'inline-block' }} />
              Share of your points
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {rounds.map(r => (
              <div key={r.round} className="flex items-center gap-2 md:gap-3">
                <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', width: '34px', flexShrink: 0 }}>
                  {r.round}
                </span>
                <div className="flex-1 min-w-0">
                  <div style={{ height: '6px', width: `${r.accuracy}%`, background: 'var(--chalk-dim)', borderRadius: '2px', marginBottom: '3px' }} />
                  <div style={{ height: '6px', width: `${r.pointsShare}%`, background: 'var(--court)', borderRadius: '2px' }} />
                </div>
                <span style={{ ...mono, fontSize: '0.68rem', color: 'var(--muted)', width: '46px', textAlign: 'right', flexShrink: 0 }}>
                  {r.correct}/{r.decided}
                </span>
                <span style={{ ...mono, fontSize: '0.72rem', color: 'var(--ink)', width: '52px', textAlign: 'right', flexShrink: 0 }}>
                  {r.points.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Your players */}
      {topEarners.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', marginBottom: '2px' }}>
            Your players
            <InfoBubble label="your players">
              What each pick has returned. <strong>pk</strong> is how many times you
              picked that player to win a match, so backing someone deep counts more
              than once. <strong>Backed but never paid off</strong> are players you
              picked more than once who earned you nothing.
            </InfoBubble>
          </h3>
          <p style={{ ...mono, fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '8px' }}>
            How each pick has paid off
          </p>
          <div className="flex flex-col gap-1">
            {topEarners.map(p => (
              <PlayerLine
                key={p.externalId}
                p={p}
                tone={p.alive ? 'alive' : 'neutral'}
                isChampion={isComplete && p.externalId === championExternalId}
                isFinished={isComplete}
              />
            ))}
            {busts.length > 0 && (
              <>
                <p style={{ ...mono, fontSize: '0.62rem', color: 'var(--muted)', marginTop: '8px', marginBottom: '2px' }}>
                  Backed but never paid off
                </p>
                {busts.map(p => (
                  <PlayerLine key={p.externalId} p={p} tone="bust" isChampion={false} isFinished={isComplete} />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
