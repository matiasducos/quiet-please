import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { getNavProfile } from '@/lib/supabase/profile'
import { parseEditionYear } from '@/lib/tournaments/slug'
import { getEdition } from '@/lib/tournaments/series'
import type { EditionDetail, EditionPage } from '@/lib/tournaments/series'
import { getRecaps } from '@/lib/tournaments/recap'
import type { RecapPayload, RecapPlayer } from '@/lib/tournaments/recap-types'
import { playerLabel, roundName, roundPhrase, canQuotePct, isDarkHorse } from '@/lib/tournaments/recap-types'
import { formatPoints } from '@/lib/utils/format'
import { SITE_URL } from '@/lib/site'

/**
 * The tournament recap — /tournaments/wimbledon/2026/recap.
 *
 * Everything here is read from the stored payload built at completion
 * (migration 076). The page runs no aggregation of its own, which is what lets
 * it be statically rendered and shared without a per-visit cost that scales
 * with the number of brackets.
 */

export const revalidate = 3600
export const dynamicParams = true

type RouteParams = { slug: string; year: string }

export async function generateMetadata({ params }: { params: Promise<RouteParams> }): Promise<Metadata> {
  const { slug, year: rawYear } = await params
  const year = parseEditionYear(rawYear)
  if (year === null) return {}

  const page = await getEdition(slug, year)
  if (!page) return {}

  const title = `${page.series.name} ${year} — tournament recap`
  const description = `Who the crowd backed, who busted, and how the field scored at ${page.series.name} ${year}.`

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/tournaments/${slug}/${year}/recap` },
    openGraph: { title, description, url: `${SITE_URL}/tournaments/${slug}/${year}/recap`, type: 'article' },
  }
}

export default async function RecapPage({ params }: { params: Promise<RouteParams> }) {
  const { slug, year: rawYear } = await params

  // Same guard as the edition page: without it a typo'd segment renders an
  // empty 200, and a soft 404 is what degrades crawl quality at scale.
  const year = parseEditionYear(rawYear)
  if (year === null) notFound()

  const [{ user, profile }, page] = await Promise.all([getNavProfile(), getEdition(slug, year)])
  if (!page) notFound()

  const recaps = await getRecaps(page.tours.map(t => t.tournament.id))

  // An edition with no stored recap has not finished, or finished with no
  // results entered. 404 rather than an empty page: there is nothing here to
  // read, and a thin "check back later" page is a soft 404 that competes with
  // the edition page for the same query.
  const sections = page.tours
    .map(detail => ({ detail, recap: recaps.get(detail.tournament.id)?.payload ?? null }))
    .filter((s): s is { detail: EditionDetail; recap: RecapPayload } => s.recap !== null)

  if (sections.length === 0) notFound()

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav
        deletionRequestedAt={profile?.deletion_requested_at}
        username={profile?.username}
        points={profile?.ranking_points ?? 0}
        activePage="tournaments"
        userId={user?.id}
      />

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <nav
          className="flex items-center gap-2 mb-8 flex-wrap"
          style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
        >
          <Link href="/tournaments" style={{ color: 'var(--muted)' }}>Tournaments</Link>
          <span>/</span>
          <Link href={`/tournaments/${page.series.slug}`} style={{ color: 'var(--muted)' }}>
            {page.series.name}
          </Link>
          <span>/</span>
          <Link href={`/tournaments/${page.series.slug}/${year}`} style={{ color: 'var(--muted)' }}>{year}</Link>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>Recap</span>
        </nav>

        <header className="mb-10">
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>
            Tournament recap
          </p>
          <h1
            className="text-3xl md:text-4xl"
            style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '10px' }}
          >
            {page.series.flag_emoji && <span style={{ marginRight: '8px' }}>{page.series.flag_emoji}</span>}
            {page.series.name} {year}
          </h1>
          <p style={{ fontSize: '0.95rem', color: 'var(--muted)', maxWidth: '52ch', lineHeight: 1.6 }}>
            Who the crowd backed, who let them down, and how the field scored.
          </p>
        </header>

        {sections.map(({ detail, recap }) => (
          <RecapSection
            key={detail.tournament.id}
            page={page}
            detail={detail}
            recap={recap}
            showTourLabel={sections.length > 1}
          />
        ))}
      </div>
    </main>
  )
}

// ── One tour's recap ─────────────────────────────────────────────────────────

function RecapSection({
  page,
  detail,
  recap,
  showTourLabel,
}: {
  page: EditionPage
  detail: EditionDetail
  recap: RecapPayload
  showTourLabel: boolean
}) {
  // Every percentage below is gated on the sample of the stat that produced it,
  // never on the tournament's entry count. Most brackets stop after the first
  // round, so a 91-entry tournament can have four people who picked a champion
  // — and "67% backed them" from three of those four is a fabrication.
  const showBust = canQuotePct(recap.biggest_bust) && (recap.biggest_bust?.backers ?? 0) > 0
  const bustIsFavourite =
    showBust && !!recap.crowd_favourite && recap.biggest_bust!.player.id === recap.crowd_favourite.player.id

  return (
    <section className="mb-14">
      {showTourLabel && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '12px' }}>
          {detail.tournament.tour}
        </p>
      )}

      {/* ── Participation ─────────────────────────────────────────────── */}
      {recap.participation && (
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-px mb-10 rounded-sm overflow-hidden"
          style={{ background: 'var(--chalk-dim)', border: '1px solid var(--chalk-dim)' }}
        >
          <Stat label="Brackets" value={formatPoints(recap.participation.brackets)} />
          <Stat label="Matches" value={formatPoints(recap.participation.matches)} />
          <Stat label="Picks made" value={formatPoints(recap.participation.picks_made)} />
          <Stat label="Points awarded" value={formatPoints(recap.participation.points_awarded)} />
        </div>
      )}

      {/* ── Players ───────────────────────────────────────────────────── */}
      <Heading>The players</Heading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
        {/* Suppressed when the bust names the same player — see cardHighlights
            for why the two collide, and why the bust is the one that stays. */}
        {canQuotePct(recap.crowd_favourite) && recap.crowd_favourite && !bustIsFavourite && (
          <Card
            label="The crowd's champion"
            headline={playerLabel(recap.crowd_favourite.player)}
            body={`${pct(recap.crowd_favourite.backers, recap.crowd_favourite.sample)}% of the brackets that named a champion picked them.`}
            tone={recap.crowd_favourite.was_right ? 'good' : 'neutral'}
            footnote={recap.crowd_favourite.was_right ? 'They were right.' : undefined}
          />
        )}

        {showBust && recap.biggest_bust && (
          <Card
            label="Biggest bust"
            headline={playerLabel(recap.biggest_bust.player)}
            body={`${pct(recap.biggest_bust.backers, recap.biggest_bust.sample)}% had them lifting the trophy. They went out in ${roundPhrase(recap.biggest_bust.exit_round)}.`}
            tone="bad"
          />
        )}

        {recap.dark_horse && isDarkHorse(recap.dark_horse) && (
          <Card
            label="Dark horse"
            headline={playerLabel(recap.dark_horse.player)}
            body={`Only ${recap.dark_horse.backing_pct}% of the ${recap.dark_horse.sample} brackets that picked their opening match backed them. ${recap.dark_horse.reached === 'W' ? 'They won the title.' : `They reached ${roundPhrase(recap.dark_horse.reached)}.`}`}
            tone="good"
          />
        )}

        {recap.points_machine && (
          <Card
            label="Points machine"
            headline={playerLabel(recap.points_machine.player)}
            body={`Their wins paid out ${formatPoints(recap.points_machine.points)} points across every bracket in the draw.`}
          />
        )}

        {recap.most_picked && (
          <Card
            label="Most picked"
            headline={playerLabel(recap.most_picked.player)}
            body={`Named in ${formatPoints(recap.most_picked.picks)} picks, across ${formatPoints(recap.most_picked.brackets)} brackets.`}
            // Stated rather than assumed: reaching the final gives a player
            // seven chances to be picked and losing in round one gives them
            // one, so this number is part popularity and part deep run.
            footnote="Counts every round, so deep runs inflate this."
          />
        )}

        {recap.least_picked && canQuotePct(recap.least_picked) && (
          <Card
            label="Least picked"
            headline={playerLabel(recap.least_picked.player)}
            // Denominator spelled out: the sample is the brackets that picked
            // THAT match, not the tournament's entry count, and "0% of
            // brackets" would quietly claim the larger one.
            body={`Just ${recap.least_picked.backing_pct}% of the ${recap.least_picked.sample} brackets that picked their opening match backed them — the lowest in the draw.`}
          />
        )}
      </div>

      {/* ── How the field did ─────────────────────────────────────────── */}
      <Heading>How the field did</Heading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {recap.accuracy && (
          <Card
            label="Community accuracy"
            headline={`${recap.accuracy.pct}%`}
            body={`${formatPoints(recap.accuracy.correct)} of ${formatPoints(recap.accuracy.decided)} picks called correctly.`}
          />
        )}

        {recap.chalk_vs_chaos && (
          <Card
            label="Chalk vs chaos"
            headline={`${recap.chalk_vs_chaos.upsets} of ${recap.chalk_vs_chaos.decided}`}
            body={`matches went against the crowd's majority pick — ${recap.chalk_vs_chaos.upset_pct}% of the tournament.`}
          />
        )}

        {recap.hardest_round && (
          <Card
            label="Hardest round"
            headline={roundName(recap.hardest_round.round)}
            body={`${recap.hardest_round.pct}% accuracy, against a ${recap.hardest_round.median_pct}% median across all rounds.`}
          />
        )}

        {recap.crowd_bracket && (
          <Card
            label="Wisdom of the crowd"
            headline={`${recap.crowd_bracket.correct} of ${recap.crowd_bracket.decided}`}
            body={`A bracket built from the majority pick in every match would have beaten ${recap.crowd_bracket.percentile}% of the ${formatPoints(recap.crowd_bracket.field)} real entries.`}
            // The comparison flatters the crowd and saying so costs nothing:
            // the composite has a pick in every match that anyone picked, while
            // most real entries stop after the first round and cannot score
            // later ones. Part of that margin is completeness, not judgement.
            footnote="The crowd's bracket is complete; most real entries are not."
          />
        )}
      </div>

      {/* ── Round by round ────────────────────────────────────────────── */}
      {recap.rounds && recap.rounds.length > 0 && (
        <div className="mb-10">
          <RoundTable rounds={recap.rounds} />
          <p style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.5 }}>
            Accuracy falls with every round by design — calling a quarterfinal means having had the
            winner survive three earlier matches first. Compare a round against the same round
            elsewhere, not against the one before it.
          </p>
        </div>
      )}

      {/* ── Matches ───────────────────────────────────────────────────── */}
      {(recap.bracket_buster || recap.unanimous_and_wrong) && (
        <>
          <Heading>The matches that did the damage</Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-10">
            {/* Head counts, not percentages — "3 of 47 called it" is honest at
                any sample, which is why these two are not gated the way the
                percentage cards above are. */}
            {recap.bracket_buster && (
              <Card
                label="Nobody saw it coming"
                headline={`${playerLabel(recap.bracket_buster.winner)} def. ${playerLabel(recap.bracket_buster.loser)}`}
                body={`${roundName(recap.bracket_buster.round)}${recap.bracket_buster.score ? ` · ${recap.bracket_buster.score}` : ''} — ${recap.bracket_buster.called_it} of the ${recap.bracket_buster.sample} brackets that picked this match called it.`}
                tone="bad"
              />
            )}
            {canQuotePct(recap.unanimous_and_wrong) && recap.unanimous_and_wrong && (
              <Card
                label="Everyone agreed. Everyone was wrong."
                headline={`${playerLabel(recap.unanimous_and_wrong.winner)} def. ${playerLabel(recap.unanimous_and_wrong.loser)}`}
                body={`${recap.unanimous_and_wrong.pct}% of the ${recap.unanimous_and_wrong.sample} brackets that picked this match had ${nameOf(recap.unanimous_and_wrong.loser)} winning it.`}
                tone="bad"
              />
            )}
          </div>
        </>
      )}

      {/* ── People ────────────────────────────────────────────────────── */}
      <Heading>The people</Heading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {recap.podium && recap.podium.length > 0 && (
          <div className="rounded-sm border p-4" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
            <CardLabel>Podium</CardLabel>
            <ol className="mt-3 flex flex-col gap-2">
              {recap.podium.map((entry, i) => (
                <li key={entry.username} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 min-w-0">
                    <span style={{ fontSize: '1rem' }}>{['🥇', '🥈', '🥉'][i] ?? '·'}</span>
                    <Link
                      href={`/profile/${entry.username}`}
                      className="truncate"
                      style={{ fontSize: '0.9rem', color: 'var(--ink)', fontWeight: 500 }}
                    >
                      {entry.username}
                    </Link>
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', flexShrink: 0 }}>
                    {formatPoints(entry.points)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Headline is the head count, not the percentage: it is the honest
            number at any sample, and the body carries the denominator so the
            reader can judge it for themselves. */}
        {recap.champion_callers && recap.champion_callers.sample > 0 && (
          <Card
            label="Called the champion"
            headline={`${formatPoints(recap.champion_callers.callers)}`}
            body={`of the ${formatPoints(recap.champion_callers.sample)} brackets that named a champion had ${nameOf(recap.champion_callers.player)} winning the title.`}
            tone="good"
          />
        )}

        {recap.best_round && (
          <Card
            label="Round of the tournament"
            headline={recap.best_round.username}
            body={`${recap.best_round.correct} of ${recap.best_round.decided} correct in ${roundPhrase(recap.best_round.round)}.`}
          />
        )}
      </div>

      <div className="mt-10">
        <Link
          href={`/tournaments/${page.series.slug}/${page.year}`}
          style={{ fontSize: '0.9rem', color: 'var(--court)' }}
        >
          ← Back to {page.series.name} {page.year}
        </Link>
      </div>
    </section>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function pct(count: number, sample: number): number {
  return Math.round((count / sample) * 100)
}

/** Bare name, for mid-sentence use where a flag would read as punctuation. */
function nameOf(p: RecapPlayer | undefined): string {
  return p?.name ?? 'them'
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.68rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        marginBottom: '12px',
      }}
    >
      {children}
    </h2>
  )
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.58rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
      }}
    >
      {children}
    </div>
  )
}

const TONE: Record<string, { border: string; bg: string }> = {
  good:    { border: '#bfe0c9', bg: '#f4fbf6' },
  bad:     { border: '#f0c9c9', bg: '#fdf6f6' },
  neutral: { border: 'var(--chalk-dim)', bg: 'white' },
}

function Card({
  label,
  headline,
  body,
  footnote,
  tone = 'neutral',
}: {
  label: string
  headline: string
  body: string
  footnote?: string
  tone?: 'good' | 'bad' | 'neutral'
}) {
  const t = TONE[tone] ?? TONE.neutral
  return (
    <div className="rounded-sm border p-4" style={{ borderColor: t.border, background: t.bg }}>
      <CardLabel>{label}</CardLabel>
      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.25rem',
          letterSpacing: '-0.01em',
          lineHeight: 1.25,
          color: 'var(--ink)',
          margin: '6px 0 4px',
        }}
      >
        {headline}
      </p>
      <p style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.5 }}>{body}</p>
      {footnote && (
        <p style={{ fontSize: '0.7rem', color: 'var(--muted)', lineHeight: 1.4, marginTop: '6px', opacity: 0.85 }}>
          {footnote}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'white', padding: '14px 16px' }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.55rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', color: 'var(--ink)', lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  )
}

/**
 * Round-by-round accuracy.
 *
 * This used to be `overflow-x-auto` around a `min-w-[420px]` grid, justified as
 * "seven rounds of three columns do not fit 375px". The rounds are rows, not
 * columns, so they never affected the width — it is four columns wide (Round,
 * Picks, Correct, Accuracy), and the widest cell in any of them is the word
 * "Accuracy" itself. Measured at 375px the whole table needs ~250px, so the
 * 420px floor was inventing 77px of scroll to hide nothing.
 */
function RoundTable({ rounds }: { rounds: NonNullable<RecapPayload['rounds']> }) {
  return (
    <div className="rounded-sm border" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
      <div>
        <div
          className="grid grid-cols-4 gap-2 px-4 py-2 border-b"
          style={{
            borderColor: 'var(--chalk-dim)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.58rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
          }}
        >
          <span>Round</span>
          <span className="text-right">Picks</span>
          <span className="text-right">Correct</span>
          <span className="text-right">Accuracy</span>
        </div>
        {rounds.map(r => (
          <div
            key={r.round}
            className="grid grid-cols-4 gap-2 px-4 py-2.5 border-b last:border-b-0 items-center"
            style={{ borderColor: 'var(--chalk-dim)', fontSize: '0.82rem' }}
          >
            <span style={{ color: 'var(--ink)' }}>{roundName(r.round)}</span>
            <span className="text-right" style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
              {formatPoints(r.decided)}
            </span>
            <span className="text-right" style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
              {formatPoints(r.correct)}
            </span>
            <span className="text-right" style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)', fontWeight: 500 }}>
              {r.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
