import type { ReactElement } from 'react'
import type { CardPlayer, DrawCard, UpcomingCard, RecapCard, RecapMatch, CompleteCard, StatsCard, SocialCard, PodiumEntry } from '../data'
import type { Highlight } from '@/lib/tournaments/recap-types'
import { drawCapacity, recapCapacity, upcomingCapacity, statsCapacity, pickedLabel, favouriteLabel } from '../layout'
import { Frame, Eyebrow, Rule, C, DISPLAY, BODY, MONO, type CardSize } from './frame'

/**
 * The three card designs. Satori rules from ./frame.tsx apply throughout:
 * flexbox only, explicit `display: 'flex'`, and only the loaded font families.
 */

export interface CardOptions {
  size: CardSize
  /** False blanks every username before render — the per-post approval toggle. */
  showUsernames: boolean
}

/** Satori has no text measurement to reflow with, so long names are trimmed up front. */
function short(name: string, max = 22): string {
  if (name.length <= max) return name
  // "Auger-Aliassime, Felix" → "Auger-Aliassime, F." rather than a hard cut.
  const [surname, first] = name.split(',').map(s => s.trim())
  if (first) {
    const initialled = `${surname}, ${first[0]}.`
    if (initialled.length <= max) return initialled
    return `${initialled.slice(0, max - 1)}…`
  }
  return `${name.slice(0, max - 1)}…`
}

function PlayerLine({
  player,
  size,
  bold = false,
  color = C.ink,
  max,
}: {
  player: CardPlayer
  size: number
  bold?: boolean
  color?: string
  max?: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
      {player.flag ? <div style={{ display: 'flex', fontSize: size * 0.9 }}>{player.flag}</div> : null}
      <div style={{ display: 'flex', fontFamily: BODY, fontWeight: bold ? 700 : 400, fontSize: size, color }}>
        {short(player.name, max ?? 22)}
      </div>
    </div>
  )
}

function SeedBadge({ seed, size }: { seed: number; size: number }) {
  return (
    <div
      style={{
        display: 'flex',
        width: size,
        height: size,
        borderRadius: 8,
        backgroundColor: C.chalkDim,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: MONO,
        fontWeight: 500,
        fontSize: size * 0.46,
        color: C.muted,
      }}
    >
      {seed}
    </div>
  )
}

function ScorePill({ score, size }: { score: string; size: number }) {
  if (!score) return null
  return (
    <div
      style={{
        display: 'flex',
        fontFamily: MONO,
        fontWeight: 500,
        fontSize: size,
        color: C.chalk,
        backgroundColor: C.court,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 6,
      }}
    >
      {score}
    </div>
  )
}

function Podium({ entries, showUsernames, story }: { entries: PodiumEntry[]; showUsernames: boolean; story: boolean }) {
  if (!entries.length) return null
  const PLACE = ['1st', '2nd', '3rd']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 16 : 12 }}>
      <Eyebrow color={C.muted} size={story ? 22 : 19}>
        Leading brackets
      </Eyebrow>
      {entries.map((e, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* With usernames off the place label becomes the row's subject, so
                the anonymised card reads as a deliberate design rather than
                three redacted rows. */}
            {showUsernames && (
              <div
                style={{
                  display: 'flex',
                  fontFamily: MONO,
                  fontWeight: 500,
                  fontSize: story ? 24 : 21,
                  color: i === 0 ? C.clay : C.muted,
                }}
              >
                {PLACE[i]}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                fontFamily: BODY,
                fontWeight: i === 0 ? 700 : 400,
                fontSize: story ? 32 : 28,
                color: showUsernames ? C.ink : i === 0 ? C.ink : C.muted,
              }}
            >
              {showUsernames ? short(e.username, 18) : `${PLACE[i]} place`}
            </div>
          </div>
          <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 500, fontSize: story ? 30 : 26, color: C.court }}>
            {e.points.toLocaleString('en-GB')} pts
          </div>
        </div>
      ))}
    </div>
  )
}

/** The big green number block — one headline figure per card. */
function StatBlock({
  value,
  label,
  story,
  note,
}: {
  value: string
  label: string
  story: boolean
  note?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: C.court,
        borderRadius: 18,
        paddingTop: story ? 26 : 20,
        paddingBottom: story ? 26 : 20,
        paddingLeft: 32,
        paddingRight: 32,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
        <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: story ? 78 : 62, color: C.chalk }}>{value}</div>
        <div
          style={{
            display: 'flex',
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: story ? 26 : 22,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: '#a8d4ba',
          }}
        >
          {label}
        </div>
      </div>
      {note ? (
        <div style={{ display: 'flex', fontFamily: BODY, fontSize: story ? 26 : 22, color: '#a8d4ba' }}>{note}</div>
      ) : null}
    </div>
  )
}

// ── Draw published ────────────────────────────────────────────────────────────

function DrawArt({ card, size }: { card: DrawCard; size: CardSize }): ReactElement {
  const story = size === 'story'
  // Same contract as RecapArt and UpcomingArt: an explicit selection wins,
  // otherwise the card takes the draw from the top, and the cap applies either
  // way. Unlike those two there is no "+ N more" line — the un-shown ties are
  // the other 59 first-round matches of a 128-draw, which is not news, and the
  // entrants block above already says how big the field is.
  const selected = card.selectedIds
  const matches = (selected ? card.matches.filter(m => selected.includes(m.id)) : card.matches).slice(
    0,
    drawCapacity(size),
  )

  return (
    <Frame
      size={size}
      eyebrow="The draw is out"
      tournament={card.tournament}
      ctaLead="Make your picks!"
      cta="Free to play at quietplease.app"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 44 : 28, flex: 1 }}>
        <StatBlock value={String(card.entrants)} label="players in the draw" story={story} />

        {matches.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 22 : 15 }}>
            <Eyebrow color={C.muted} size={story ? 22 : 19}>
              Highlighted matches
            </Eyebrow>
            {matches.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Seed badges appear only where the draw actually recorded one. */}
                {m.a.seed != null && <SeedBadge seed={m.a.seed} size={story ? 40 : 34} />}
                <PlayerLine player={m.a} size={story ? 34 : 28} max={16} />
                <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: story ? 28 : 24, color: C.clay }}>v</div>
                {m.b.seed != null && <SeedBadge seed={m.b.seed} size={story ? 40 : 34} />}
                <PlayerLine player={m.b} size={story ? 34 : 28} max={16} />
              </div>
            ))}
          </div>
        )}

        {/* The card's actual message, set at headline weight rather than as a
            caption. `flexDirection: column` is what lets it wrap: Satori will
            break the line either way, but a row-direction flex container lays
            the fragments out side by side and they run off the canvas. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 'auto',
            fontFamily: BODY,
            fontWeight: 700,
            fontSize: story ? 60 : 42,
            lineHeight: 1.15,
            color: C.ink,
          }}
        >
          Predictions are open — pick every round before play starts.
        </div>
      </div>
    </Frame>
  )
}

// ── Up next ───────────────────────────────────────────────────────────────────

/**
 * How much bigger the type gets when the round does not fill the card.
 *
 * A semifinal is two rows on a canvas budgeted for six, and centring that leaves
 * two thirds of a story empty. Scaling the rows up spends the space on the thing
 * the card is actually about.
 *
 * The catch is that the free space is VERTICAL and the binding constraint is
 * HORIZONTAL. Satori cannot measure text — which is why `short()` trims to a
 * character count up front rather than reflowing — so the row width has to be
 * budgeted rather than discovered. Measured at story size, the worst case (two
 * seed badges, two names trimmed to 16) runs to about 840 of the 920px between
 * the safe margins. That is only ~1.09x of headroom, so any scale beyond it has
 * to come out of the trim, and the two move together for that reason: scale up,
 * trim down, worst-case width stays put.
 *
 * The trim is the cost, and it is why this tops out well short of what the
 * vertical space alone would allow. Names in this registry come in two shapes —
 * "Sinner, Jannik", which `short()` can initial down to "Sinner, J.", and
 * "D. Merida Aguilar", which it can only cut — and the second shape is what
 * production actually stores. Every character off the trim is taken directly out
 * of those.
 */
function upcomingType(size: CardSize, count: number): { scale: number; max: number } {
  const steps =
    size === 'story'
      ? [
          { upTo: 2, scale: 1.34 },
          { upTo: 3, scale: 1.22 },
          { upTo: 4, scale: 1.11 },
        ]
      : [
          { upTo: 2, scale: 1.26 },
          { upTo: 3, scale: 1.12 },
        ]
  const scale = steps.find(s => count <= s.upTo)?.scale ?? 1
  return { scale, max: Math.round(16 / scale) }
}

function UpcomingArt({ card, size }: { card: UpcomingCard; size: CardSize }): ReactElement {
  const story = size === 'story'
  // Same contract as RecapArt: an explicit selection wins, otherwise the round is
  // taken from the top, and the cap applies either way.
  const selected = card.selectedIds
  const matches = (selected ? card.matches.filter(m => selected.includes(m.id)) : card.matches).slice(
    0,
    upcomingCapacity(size),
  )
  const hidden = card.matches.length - matches.length

  // Driven by what is ON the card, not by the round's size: a six-match
  // quarterfinal narrowed to two by the admin is a two-row card and should read
  // like one.
  const { scale, max } = upcomingType(size, matches.length)
  const px = (base: number) => Math.round(base * scale)
  const nameSize = px(story ? 36 : 29)
  const crowdSize = px(story ? 24 : 21)
  const matchGap = px(story ? 30 : 18)

  return (
    <Frame
      size={size}
      eyebrow={`${card.roundLabel} — up next`}
      tournament={card.tournament}
      cta="Lock your picks — quietplease.app"
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {/* Centred so a two-match semifinal does not strand the top half of a
            story empty — see the same note on RecapArt. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: matchGap, flex: 1, justifyContent: 'center' }}>
          {matches.map(m => (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: px(8) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: px(16) }}>
                {m.a.seed != null && <SeedBadge seed={m.a.seed} size={px(story ? 40 : 34)} />}
                <PlayerLine player={m.a} size={nameSize} max={max} />
                <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: px(story ? 30 : 25), color: C.clay }}>
                  v
                </div>
                {m.b.seed != null && <SeedBadge seed={m.b.seed} size={px(story ? 40 : 34)} />}
                <PlayerLine player={m.b} size={nameSize} max={max} />
              </div>
              {/* Absent when no bracket has picked the tie. The row then carries
                  the fixture alone, which is the honest rendering of silence —
                  see UpcomingMatch.favourite. */}
              {m.favourite && (
                <div style={{ display: 'flex', fontFamily: BODY, fontSize: crowdSize, color: C.muted }}>
                  {favouriteLabel(m.favourite.player.name, m.favourite.count, m.favourite.pct)}
                </div>
              )}
            </div>
          ))}
          {hidden > 0 && (
            <div style={{ display: 'flex', fontFamily: BODY, fontSize: story ? 26 : 22, color: C.muted }}>
              + {hidden} more {hidden === 1 ? 'match' : 'matches'}
            </div>
          )}
        </div>

        {/* The square's group above fills its box exactly, hence the margin —
            same fix as RecapArt's footer. */}
        {card.bracketCount > 0 && (
          <div
            style={{
              display: 'flex',
              marginTop: story ? 0 : 14,
              fontFamily: BODY,
              fontSize: story ? 28 : 24,
              color: C.muted,
            }}
          >
            {card.bracketCount.toLocaleString('en-GB')} brackets in play
          </div>
        )}
      </div>
    </Frame>
  )
}

// ── Round recap ───────────────────────────────────────────────────────────────

/**
 * "412 brackets called it" under a match, in clay with an UPSET badge when the
 * match was the round's standout and muted otherwise.
 *
 * Every featured match carries this line now, not just the upset. A recap whose
 * only numbers were on the one match nobody called read as a highlight reel; the
 * interesting comparison is between the matches the field got right and the one
 * it didn't, and that needs both sides printed.
 */
function PickCount({ match, story }: { match: RecapMatch; story: boolean }) {
  const label = pickedLabel(match.pickedCount, match.pickedPct)
  if (!label) return null
  const upset = match.isUpset

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {upset && (
        <div
          style={{
            display: 'flex',
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: story ? 20 : 18,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: C.chalk,
            backgroundColor: C.clay,
            paddingTop: 4,
            paddingBottom: 4,
            paddingLeft: 12,
            paddingRight: 12,
            borderRadius: 5,
          }}
        >
          Upset
        </div>
      )}
      <div
        style={{
          display: 'flex',
          fontFamily: BODY,
          fontSize: story ? 24 : 21,
          color: upset ? C.clay : C.muted,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function RecapArt({ card, size, showUsernames }: { card: RecapCard; size: CardSize; showUsernames: boolean }): ReactElement {
  const story = size === 'story'
  // The podium costs roughly two match rows of height, so the match list shrinks
  // when it is present rather than letting the card overflow its fixed canvas.
  const hasPodium = card.podium.length > 0
  const maxMatches = recapCapacity(size, hasPodium)
  // An explicit selection wins; without one the card takes the round from the
  // top, which is what it always did. The cap applies either way — the studio
  // stops the admin at the same number, so hitting it here means a hand-edited
  // URL rather than a surprise.
  const selected = card.selectedIds
  const matches = (selected ? card.matches.filter(m => selected.includes(m.id)) : card.matches).slice(0, maxMatches)
  const hidden = card.matches.length - matches.length

  return (
    <Frame size={size} eyebrow={`${card.roundLabel} results`} tournament={card.tournament} cta="Track your bracket — quietplease.app">
      {/* `justifyContent: center` on the flex:1 group is a no-op once the round
          fills the canvas, and stops a two-match round from stranding a third of
          the story empty. */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: story ? 34 : 16,
            flex: 1,
            justifyContent: 'center',
          }}
        >
        <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 22 : 14 }}>
          {matches.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <PlayerLine player={m.winner} size={story ? 36 : 30} bold max={18} />
                  <div style={{ display: 'flex', fontFamily: BODY, fontSize: story ? 26 : 22, color: C.muted }}>d.</div>
                  <PlayerLine player={m.loser} size={story ? 30 : 26} color={C.muted} max={18} />
                </div>
                <ScorePill score={m.score} size={story ? 24 : 20} />
              </div>
              <PickCount match={m} story={story} />
            </div>
          ))}
          {hidden > 0 && (
            <div style={{ display: 'flex', fontFamily: BODY, fontSize: story ? 26 : 22, color: C.muted }}>
              + {hidden} more {hidden === 1 ? 'match' : 'matches'}
            </div>
          )}
        </div>

        {hasPodium && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 22 : 12 }}>
            <Rule />
            <Podium entries={card.podium} showUsernames={showUsernames} story={story} />
          </div>
        )}
        </div>

        {/* The square's group above fills its box exactly, so this line would sit
            flush against "3rd place" without a margin of its own — two different
            facts reading as one wrapped sentence. Story gets its separation free
            from the centred group's slack. */}
        {card.bracketCount > 0 && (
          <div
            style={{
              display: 'flex',
              marginTop: story ? 0 : 14,
              fontFamily: BODY,
              fontSize: story ? 28 : 24,
              color: C.muted,
            }}
          >
            {card.bracketCount.toLocaleString('en-GB')} brackets in play
          </div>
        )}
      </div>
    </Frame>
  )
}

// ── Tournament complete ───────────────────────────────────────────────────────

function CompleteArt({ card, size, showUsernames }: { card: CompleteCard; size: CardSize; showUsernames: boolean }): ReactElement {
  const story = size === 'story'

  return (
    <Frame size={size} eyebrow="Champion" tournament={card.tournament} cta="See the final table — quietplease.app">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: story ? 44 : 28,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        {card.champion && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              {card.champion.flag ? (
                <div style={{ display: 'flex', fontSize: story ? 76 : 60 }}>{card.champion.flag}</div>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  fontFamily: DISPLAY,
                  fontSize: story ? 82 : 64,
                  color: C.court,
                  lineHeight: 1.05,
                }}
              >
                {short(card.champion.name, 20)}
              </div>
            </div>
            {card.runnerUp && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ display: 'flex', fontFamily: BODY, fontSize: story ? 30 : 25, color: C.muted }}>
                  def. {short(card.runnerUp.name, 20)}
                </div>
                <ScorePill score={card.finalScore} size={story ? 26 : 22} />
              </div>
            )}
          </div>
        )}

        {/* Falls back to the bracket count so the card always carries one hero
            figure — the pick rate is absent whenever the sample is too small to
            mean anything, or the lookup did not succeed.
            Zero falls back too: "0%" set in 78px display type is a rounding
            artefact wearing a headline's clothes, and the bracket count says
            something true at the same size. */}
        {card.championPickedPct ? (
          // Precise wording: the ledger counts brackets that had this player
          // winning the final, not brackets that merely liked them.
          <StatBlock value={`${card.championPickedPct}%`} label="of brackets called the final" story={story} />
        ) : card.bracketCount > 0 ? (
          <StatBlock value={card.bracketCount.toLocaleString('en-GB')} label="brackets played" story={story} />
        ) : null}

        {card.podium.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 22 : 16 }}>
            <Rule />
            <Podium entries={card.podium} showUsernames={showUsernames} story={story} />
          </div>
        )}

        {!!card.championPickedPct && card.bracketCount > 0 && (
          <div style={{ display: 'flex', fontFamily: BODY, fontSize: story ? 28 : 24, color: C.muted }}>
            from {card.bracketCount.toLocaleString('en-GB')} brackets played
          </div>
        )}
      </div>
    </Frame>
  )
}

// ── Tournament recap (stats) ──────────────────────────────────────────────────

/**
 * One stat: a small label, the answer in display type, the evidence beneath.
 *
 * The detail line is what keeps the card honest — "Only 12% backed them" means
 * nothing without "reached the semifinals" under it — so it is part of the row
 * rather than an optional flourish.
 */
function StatRow({ line, story }: { line: Highlight; story: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 6 : 4 }}>
      <Eyebrow color={C.muted} size={story ? 22 : 19}>
        {line.label}
      </Eyebrow>
      <div
        style={{
          display: 'flex',
          fontFamily: DISPLAY,
          fontSize: story ? 52 : 40,
          color: C.ink,
          lineHeight: 1.1,
        }}
      >
        {line.value}
      </div>
      {line.detail ? (
        <div style={{ display: 'flex', fontFamily: BODY, fontSize: story ? 28 : 23, color: C.muted, lineHeight: 1.3 }}>
          {line.detail}
        </div>
      ) : null}
    </div>
  )
}

function StatsArt({ card, size, showUsernames }: { card: StatsCard; size: CardSize; showUsernames: boolean }): ReactElement {
  const story = size === 'story'
  // The podium is dropped from the square before the stats are: the stats are
  // the reason this card exists, and the `complete` card already carries a
  // podium for anyone who wants one.
  const hasPodium = story && card.podium.length > 0
  const lines = card.lines.slice(0, statsCapacity(size, hasPodium))

  return (
    <Frame size={size} eyebrow="Tournament recap" tournament={card.tournament} cta="Full recap at quietplease.app">
      <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 40 : 26, flex: 1, justifyContent: 'center' }}>
        {/* The hero figure is participation, not a percentage: it is the one
            number that is always available and always large, and it frames
            every stat under it with the sample they came from. */}
        {card.bracketCount > 0 && (
          <StatBlock
            value={card.bracketCount.toLocaleString('en-GB')}
            label="brackets played"
            story={story}
            note={card.picksMade > 0 ? `${card.picksMade.toLocaleString('en-GB')} picks` : undefined}
          />
        )}

        {lines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 34 : 22 }}>
            {lines.map(l => (
              <StatRow key={l.label} line={l} story={story} />
            ))}
          </div>
        )}

        {hasPodium && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 22 : 16 }}>
            <Rule />
            <Podium entries={card.podium} showUsernames={showUsernames} story={story} />
          </div>
        )}
      </div>
    </Frame>
  )
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function renderCard(card: SocialCard, { size, showUsernames }: CardOptions): ReactElement {
  switch (card.kind) {
    case 'draw':
      return <DrawArt card={card} size={size} />
    case 'upcoming':
      return <UpcomingArt card={card} size={size} />
    case 'recap':
      return <RecapArt card={card} size={size} showUsernames={showUsernames} />
    case 'complete':
      return <CompleteArt card={card} size={size} showUsernames={showUsernames} />
    case 'stats':
      return <StatsArt card={card} size={size} showUsernames={showUsernames} />
  }
}
