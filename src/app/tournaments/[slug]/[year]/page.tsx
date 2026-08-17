import type { Metadata } from 'next'
import { Fragment, Suspense } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getNavProfile } from '@/lib/supabase/profile'
import { canPredictForStatus } from '@/lib/app-settings'
import Nav from '@/components/Nav'
import TournamentMatchList from '@/components/TournamentMatchList'
import BracketPredictor from '../predict/BracketPredictor'
import MyTournamentPanel from '../MyTournamentPanel'
import { buildMyTournament, eliminationRounds, ROUND_LABEL } from '@/lib/tennis/my-tournament'
import type { MyTournament, DrawMatch } from '@/lib/tennis/my-tournament'
import { nameToFlag } from '@/app/admin/countries'
import { parseEditionYear } from '@/lib/tournaments/slug'
import { getEdition, isEditionIndexable } from '@/lib/tournaments/series'
import type { DrawPlayer, EditionDetail, EditionPage } from '@/lib/tournaments/series'
import { buildEditionMetadata, buildEditionJsonLd } from '@/lib/tournaments/seo'
import { getRecap } from '@/lib/tournaments/recap'
import { TIER, SURFACE_COLORS, STATUS_STYLES, formatDateRange, roundPoints, toRenderDraw } from '../tournament-ui'

/**
 * One tournament edition — /tournaments/wimbledon/2026.
 *
 * This is the page that carries date-specific search intent and becomes
 * long-tail archive traffic once the event is over. It is never redirected
 * into the hub after the fact: doing so would throw away both the archive
 * traffic and every backlink pointing at a specific year.
 */

// Short window because live editions change as results land. Every mutation
// path also busts the `tournament-detail` tag, so this is the safety net
// rather than the mechanism.
export const revalidate = 300

// Editions created after the last build (a new season's rows) render on first
// request instead of 404ing until the next deploy.
export const dynamicParams = true

type RouteParams = { slug: string; year: string }

/**
 * Statically build every edition. At ~120 events a season across both tours,
 * ten seasons is roughly 2,400 pages — nowhere near the scale that would force
 * a hybrid "recent + dynamicParams for the tail" split.
 */
export async function generateStaticParams(): Promise<RouteParams[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tournaments')
    .select('starts_year, tournament_series(slug)')
    .not('series_id', 'is', null)
    .order('starts_year', { ascending: false })
    .limit(2000)

  if (error) {
    // Falling back to an empty list means pages render on demand rather than
    // failing the build — dynamicParams above makes that safe.
    console.error('[edition] generateStaticParams failed:', error.message)
    return []
  }

  const rows = (data ?? []) as {
    starts_year: number | null
    tournament_series?: { slug: string } | { slug: string }[] | null
  }[]

  const seen = new Set<string>()
  const params: RouteParams[] = []
  for (const row of rows) {
    const embedded = row.tournament_series
    const slug = Array.isArray(embedded) ? embedded[0]?.slug : embedded?.slug
    if (!slug || row.starts_year == null) continue
    // Both tours of one edition share a URL, so dedupe.
    const key = `${slug}/${row.starts_year}`
    if (seen.has(key)) continue
    seen.add(key)
    params.push({ slug, year: String(row.starts_year) })
  }
  return params
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>
}): Promise<Metadata> {
  const { slug, year: rawYear } = await params
  const year = parseEditionYear(rawYear)
  if (year === null) return {}
  const page = await getEdition(slug, year)
  if (!page) return {}
  return buildEditionMetadata(page)
}

export default async function EditionPage({ params }: { params: Promise<RouteParams> }) {
  const { slug, year: rawYear } = await params

  // Without this guard /tournaments/wimbledon/predcit renders a 200 empty page
  // instead of a 404 — a soft 404, which is what degrades crawl quality at scale.
  const year = parseEditionYear(rawYear)
  if (year === null) notFound()

  const [{ user, profile }, page] = await Promise.all([getNavProfile(), getEdition(slug, year)])
  if (!page) notFound()

  const jsonLd = buildEditionJsonLd(page)
  const indexable = isEditionIndexable(page)

  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <Nav
        deletionRequestedAt={profile?.deletion_requested_at}
        username={profile?.username}
        points={profile?.ranking_points ?? 0}
        activePage="tournaments"
        userId={user?.id}
      />

      {/* Emitted only for pages we actually want indexed — structured data on a
          noindex page is wasted bytes and a mixed signal. */}
      {indexable && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}

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
          <span style={{ color: 'var(--ink)' }}>{year}</span>
        </nav>

        {/* Streamed, and the boundary is deliberately HERE rather than in a
            loading.tsx: everything above has already resolved, and crucially
            notFound() above has already had its chance to set a 404. A
            loading.tsx on this segment would sit above the existence check and
            turn every bogus edition URL back into a 200 — see the note in
            src/app/layout.tsx.

            Worth streaming because the section is the expensive half: the
            edition data itself is ~7ms cached, while this awaits the
            prediction-status setting, a recap lookup, and for signed-in
            visitors an uncacheable per-user bracket, then renders a draw of up
            to 128 players. */}
        <Suspense fallback={<EditionSkeleton tours={page.tours.length} />}>
          {page.tours.map(detail => (
            <TourSection
              key={detail.tournament.id}
              page={page}
              detail={detail}
              userId={user?.id ?? null}
              username={profile?.username ?? null}
              showTourLabel={page.tours.length > 1}
            />
          ))}

          <OtherEditions page={page} />
        </Suspense>
      </div>
    </main>
  )
}

/**
 * Fallback for the streamed section. Shaped to match TourSection's real
 * output — tier bar, then the title card — so the swap does not jump.
 */
function EditionSkeleton({ tours }: { tours: number }) {
  return (
    <>
      {Array.from({ length: Math.max(tours, 1) }).map((_, i) => (
        <section key={i} className="mb-12">
          <div className="rounded-sm border bg-white overflow-hidden mb-8" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div style={{ background: 'var(--chalk-dim)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-3 w-16" />
            </div>
            <div style={{ padding: '24px 20px 20px' }}>
              <div className="skeleton h-9 w-64 mb-3" />
              <div className="skeleton h-4 w-56 mb-5" />
              <div className="flex items-center gap-2 flex-wrap">
                <div className="skeleton h-6 w-16 rounded-sm" />
                <div className="skeleton h-6 w-28 rounded-sm" />
                <div className="skeleton h-7 w-40 rounded-sm" />
              </div>
            </div>
          </div>
          <div className="rounded-sm border bg-white p-5 mb-8" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div className="skeleton h-5 w-48 mb-4" />
            <div className="skeleton h-4 w-full mb-2" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        </section>
      ))}
    </>
  )
}

// ── One tour's worth of an edition ───────────────────────────────────────────

async function TourSection({
  page,
  detail,
  userId,
  username,
  showTourLabel,
}: {
  page: EditionPage
  detail: EditionDetail
  userId: string | null
  username: string | null
  showTourLabel: boolean
}) {
  const t = detail.tournament
  const { series, year } = page

  const tier = TIER[`${t.tour}|${t.category}`] ?? { label: t.tour, bg: '#4a5568', text: '#fff' }
  const surface = SURFACE_COLORS[t.surface ?? 'hard']
  const status = STATUS_STYLES[t.status]
  const isDone = t.status === 'completed'
  const renderDraw = toRenderDraw(detail.bracket)

  const statusAllowed = await canPredictForStatus(t.status)

  // Only completed editions can have one, so the lookup is skipped entirely
  // for live and upcoming ones rather than querying for a guaranteed miss.
  const hasRecap = isDone && (await getRecap(t.id)) !== null

  // User-specific data is read per request, never from the shared cache — a
  // cached bracket would show players as still active after they had lost.
  const myTournament = userId ? await loadMyTournament(t.id, userId, detail) : null

  const resultsByMatch: Record<string, string> = Object.fromEntries(
    detail.results.map(r => [r.external_match_id, r.winner_external_id]),
  )

  // Same derivation the "Your tournament" panel uses, over the same rows.
  const eliminatedIn = eliminationRounds(detail.results)

  // Who is left. On a live edition this is the one fact a visitor is scanning
  // the 96-row field list for, so it gets answered above the list instead of
  // being something you find by eye. Once the tournament is done everyone is
  // out bar the champion, who already has his own block further up.
  const stillIn = isDone ? [] : detail.participants.filter(p => !eliminatedIn.has(p.externalId))

  return (
    <section className="mb-12">
      <div className="rounded-sm border bg-white overflow-hidden mb-8" style={{ borderColor: 'var(--chalk-dim)' }}>
        <div style={{ background: tier.bg, padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: tier.text, fontWeight: 600 }}>
            {tier.label}{showTourLabel ? ` · ${t.tour}` : ''}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', background: status.bg, color: status.text, padding: '3px 9px', borderRadius: '2px' }}>
            {status.label}
          </span>
        </div>

        <div style={{ padding: '24px 20px 20px' }}>
          {/* The H1 leads with the searched phrase — "Wimbledon 2026" — rather
              than the sponsor name stored on the row. */}
          <h1 className="text-3xl md:text-4xl" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '6px' }}>
            {t.flag_emoji && <span style={{ marginRight: '8px' }}>{t.flag_emoji}</span>}
            {series.name} {year}
          </h1>

          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)', letterSpacing: '0.03em', marginBottom: '16px' }}>
            {t.location ? <>{t.location} · </> : null}
            {formatDateRange(t.starts_at, t.ends_at)}
            {t.name !== series.name ? <> · officially the {t.name}</> : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase', background: surface.bg, color: surface.text, padding: '4px 10px', borderRadius: '2px' }}>
              {surface.label}
            </span>
            {t.draw_size ? (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase', background: '#f1efe8', color: '#5F5E5A', padding: '4px 10px', borderRadius: '2px' }}>
                {t.draw_size}-player draw
              </span>
            ) : null}

            {statusAllowed && (
              // Signed-out visitors go to /play, not /predict.
              //
              // This is the page organic search actually lands on, and /predict
              // redirects anyone without an account straight to /signup — so
              // the button reading "Fill in this bracket — free" delivered a
              // registration form, which made the word "free" a lie and threw
              // away the visitor at their most interested moment.
              //
              // Signed-in users still go direct: this page already knows who
              // they are, so sending them via /play would only add a redirect.
              <Link
                href={userId ? `/tournaments/${series.slug}/predict` : `/play/${series.slug}`}
                className="px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-80"
                style={{ background: 'var(--court)', color: 'white', textDecoration: 'none' }}
              >
                {userId ? 'Make predictions' : 'Fill in this bracket — free'}
              </Link>
            )}
            {(t.status === 'in_progress' || isDone) && (
              <Link
                href={`/leaderboard/tournaments/${t.id}`}
                className="px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-80"
                style={{ background: 'white', color: 'var(--ink)', textDecoration: 'none', border: '1px solid var(--chalk-dim)' }}
              >
                Leaderboard
              </Link>
            )}
            {/* Rendered only when a recap is actually stored. The recap route
                404s without one, and a finished edition can sit for a cron
                cycle or two before its recap is built — so the presence of the
                row, not the completed status, is what gates the link. */}
            {hasRecap && (
              <Link
                href={`/tournaments/${series.slug}/${year}/recap`}
                className="px-3 py-1.5 text-xs font-medium rounded-sm transition-opacity hover:opacity-80"
                style={{ background: 'white', color: 'var(--court)', textDecoration: 'none', border: '1px solid var(--court)' }}
              >
                Read the recap →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Champion — the single most searched fact about a finished edition. */}
      {isDone && detail.champion?.name && (
        <div className="rounded-sm border bg-white p-5 mb-8" style={{ borderColor: 'var(--chalk-dim)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
            {series.name} {year} champion
          </h2>
          <p style={{ fontSize: '1.05rem' }}>
            <strong>{detail.champion.name}</strong>
            {detail.champion.country ? <span style={{ color: 'var(--muted)' }}> ({detail.champion.country})</span> : null}
            {detail.runnerUp?.name ? (
              <> beat <strong>{detail.runnerUp.name}</strong>
                {detail.runnerUp.country ? <span style={{ color: 'var(--muted)' }}> ({detail.runnerUp.country})</span> : null}
                {' '}in the final.
              </>
            ) : ' won the title.'}
          </p>
          {/* Scorelines are deliberately absent: match_results.score is empty
              for every row in the database, and inventing one would be worse
              than omitting it. */}
        </div>
      )}

      {myTournament && <MyTournamentPanel data={myTournament} isComplete={isDone} />}

      {/* Participants — real, per-edition content, and the `competitor` list
          backing the SportsEvent JSON-LD. */}
      {detail.participants.length > 0 && (
        <div className="rounded-sm border bg-white p-5 mb-8" style={{ borderColor: 'var(--chalk-dim)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.25rem' }}>
            Players in the {series.name} {year} draw
          </h2>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', marginBottom: stillIn.length > 0 ? '0.6rem' : '1rem' }}>
            {detail.participants.length} players
            {detail.results.length > 0 && !isDone && (
              <> · <span style={{ color: '#1a6b3c', fontWeight: 600 }}>{stillIn.length} still in</span></>
            )}
          </p>

          {/* Naming them is only readable while the field is short. Early on
              "48 still in" is the whole answer and a list of 48 is just the
              same grid again, so the names appear once the draw is down to a
              glanceable size. */}
          {stillIn.length > 0 && stillIn.length <= 8 && (
            <p
              className="mb-4 rounded-sm px-3 py-2"
              style={{ background: '#eef6f1', fontSize: '0.82rem', lineHeight: 1.6 }}
            >
              {stillIn.map((p, i) => (
                /* The separator sits outside the nowrap span on purpose: it is
                   the only place the line is allowed to break, and adjacent
                   JSX elements produce no whitespace of their own. */
                <Fragment key={p.externalId}>
                  {i > 0 && <span style={{ color: 'var(--muted)' }}> · </span>}
                  <span style={{ whiteSpace: 'nowrap' }}>
                    <span aria-hidden="true">{nameToFlag(p.country) ?? ''} </span>
                    <strong>{p.name}</strong>
                  </span>
                </Fragment>
              ))}
            </p>
          )}
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {detail.participants.map(p => (
              <ParticipantRow
                key={p.externalId}
                player={p}
                outRound={eliminatedIn.get(p.externalId) ?? null}
                isChampion={isDone && p.externalId === detail.champion?.externalId}
                /* Before the first result every player is simply "in the draw",
                   which is 96 rows saying nothing. The column earns its space
                   only once matches have been played. */
                showStatus={detail.results.length > 0}
                isDone={isDone}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Upcoming matches — folded in from the old /upcoming route. */}
      {!isDone && renderDraw && (
        <div id="upcoming" className="mb-8">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
            Upcoming matches
          </h2>
          <TournamentMatchList
            rounds={renderDraw.rounds}
            matches={renderDraw.matches}
            matchResults={detail.results}
            mode="upcoming"
          />
        </div>
      )}

      {/* Full bracket — folded in from the old /results route. This is the
          substance that keeps the page off the near-duplicate pile. */}
      {renderDraw && (
        <div id="draw" className="mb-8">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
            {isDone ? `${series.name} ${year} results — full draw` : `${series.name} ${year} draw`}
          </h2>
          <BracketPredictor
            tournament={t}
            draw={renderDraw}
            existingPicks={{}}
            predictionId={null}
            username={username ?? ''}
            returnUrl={`/tournaments/${series.slug}/${year}`}
            matchResults={resultsByMatch}
            readOnly
            hideSaveButtons
            // The bracket is embedded in the tournament page, so "← Back to
            // tournament" points at the page it is already on. The link only
            // makes sense on /predict, where the bracket is the whole route.
            hideBackLink
            drawResultsMode
          />
        </div>
      )}

      {!renderDraw && (
        <div className="rounded-sm border bg-white p-5 mb-8" style={{ borderColor: 'var(--chalk-dim)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
            The {series.name} {year} draw is not out yet
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            The bracket is usually published a few days before play starts. This page
            fills in with the full field, the order of play and round-by-round results
            the moment it lands.
          </p>
        </div>
      )}

      <PointsPerRound category={t.category} />
    </section>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

/**
 * One player in the field, with the flag standing in for the country name.
 *
 * The name was the only thing here worth reading; spelling out "· Australia"
 * cost a third of the row to repeat what a flag says in one glyph, and the
 * space it frees is what lets the status fit without a second line.
 */
function ParticipantRow({
  player,
  outRound,
  isChampion,
  showStatus,
  isDone,
}: {
  player: DrawPlayer
  outRound: string | null
  isChampion: boolean
  showStatus: boolean
  isDone: boolean
}) {
  const flag = nameToFlag(player.country)

  // Out players are the overwhelming majority — 92 of 96 by the quarter-finals,
  // and all but one on a finished edition. Tinting *them* would paint the whole
  // list and leave the handful that matter defined by the absence of colour, so
  // the emphasis runs the other way: the many recede, the few are marked.
  const isOut = showStatus && !isChampion && (outRound !== null || isDone)
  const highlight = isChampion
    ? { bg: '#fdf1e7', rail: 'var(--clay)' }
    : showStatus && !isOut
      ? { bg: '#eef6f1', rail: '#1a6b3c' }
      : null

  // Four states, and the awkward one is last: a player with no recorded loss on
  // a finished tournament who is not the champion. Their defeat went unrecorded
  // — a withdrawal, or a missing result — and only one player can still be
  // standing, so "out" is the honest answer even without a round to name.
  const status = !showStatus
    ? null
    : isChampion
      ? { label: 'champion', color: '#1a6b3c', weight: 600 }
      : outRound
        ? { label: `lost ${ROUND_LABEL[outRound] ?? outRound}`, color: 'var(--muted)', weight: 400 }
        : isDone
          ? { label: 'out', color: 'var(--muted)', weight: 400 }
          : { label: 'in draw', color: '#1a6b3c', weight: 400 }

  return (
    <li
      className="flex items-baseline justify-between gap-2 rounded-sm px-1.5 -mx-1.5 py-0.5"
      style={{
        fontSize: '0.85rem',
        background: highlight?.bg,
        // Inset rather than a real border: a left border would shift the name
        // by 2px on highlighted rows and break the column alignment.
        boxShadow: highlight ? `inset 2px 0 0 ${highlight.rail}` : undefined,
      }}
    >
      <span className="flex items-baseline gap-1.5 min-w-0">
        {/* Fixed width so names line up whether or not the country resolved to a
            flag — `nameToFlag` returns null for unmapped countries and for the
            "World" placeholder. */}
        <span aria-hidden="true" style={{ width: '1.15em', flexShrink: 0, textAlign: 'center', opacity: isOut ? 0.45 : 1 }}>
          {flag ?? ''}
        </span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: isOut ? 'var(--muted)' : undefined,
            fontWeight: highlight ? 600 : undefined,
          }}
        >
          {player.name}
        </span>
      </span>
      {status && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.62rem',
            color: status.color,
            fontWeight: status.weight,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {status.label}
        </span>
      )}
    </li>
  )
}

function PointsPerRound({ category }: { category: string }) {
  const rows = roundPoints(category)
  return (
    <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
        Points per round
      </h2>
      {rows.map(({ round, pts }) => (
        <div
          key={round}
          className="flex items-center justify-between py-1.5 border-b last:border-0"
          style={{ borderColor: 'var(--chalk-dim)' }}
        >
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{round}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{pts} pts</span>
        </div>
      ))}
    </div>
  )
}

function OtherEditions({ page }: { page: EditionPage }) {
  return (
    <div className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
        Every {page.series.name} edition
      </h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
        See{' '}
        <Link href={`/tournaments/${page.series.slug}`} style={{ color: 'var(--court)' }}>
          past {page.series.name} winners, draws and results
        </Link>
        .
      </p>
    </div>
  )
}

// ── User-specific bracket summary ────────────────────────────────────────────

async function loadMyTournament(
  tournamentId: string,
  userId: string,
  detail: EditionDetail,
): Promise<MyTournament | null> {
  const supabase = await createClient()

  const { data: prediction, error } = await supabase
    .from('predictions')
    .select('id, picks, is_fully_locked, points_earned')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .is('challenge_id', null)
    .maybeSingle()

  if (error) {
    console.error('[edition] prediction lookup failed:', error.message)
    return null
  }

  const picks = (prediction?.picks ?? {}) as Record<string, string>
  if (!prediction || Object.keys(picks).length === 0) return null
  if (detail.results.length === 0) return null

  // Points are attributed per match so the panel can show which pick earned
  // what. Scoped to this prediction id so challenge points never leak in.
  const { data: ledger, error: ledgerError } = await supabase
    .from('point_ledger')
    .select('points, prediction_id, match_results(external_match_id)')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)

  if (ledgerError) console.error('[edition] ledger lookup failed:', ledgerError.message)

  const pointsByMatch: Record<string, number> = {}
  for (const row of (ledger ?? []) as {
    points: number
    prediction_id: string | null
    match_results?: { external_match_id: string } | { external_match_id: string }[] | null
  }[]) {
    if (row.prediction_id !== prediction.id) continue
    const embedded = row.match_results
    const ext = Array.isArray(embedded) ? embedded[0]?.external_match_id : embedded?.external_match_id
    if (ext) pointsByMatch[ext] = (pointsByMatch[ext] ?? 0) + row.points
  }

  const matches = (detail.bracket?.matches ?? []) as unknown as DrawMatch[]

  const overrides: Record<string, { name?: string | null; country?: string | null }> =
    Object.fromEntries(detail.participants.map(p => [p.externalId, { name: p.name, country: p.country }]))

  // A pick can name someone the draw no longer contains — a withdrawal replaced
  // after predictions opened, or a qualifier placeholder that resolved. The draw
  // snapshot is the only name source the panel has, so without this the pick
  // renders as an anonymous "Qualifier". The registry still knows who they are.
  //
  // Bounded by one user's own picks (≤127 ids, in practice one or two), so a
  // single .in() lookup is safe here.
  const idsInDraw = new Set(
    matches.flatMap(m => [m.player1?.externalId, m.player2?.externalId]).filter(Boolean) as string[],
  )
  const missingIds = [...new Set(Object.values(picks).filter(id => id && !idsInDraw.has(id)))]
  if (missingIds.length > 0) {
    const { data: strays, error: strayError } = await supabase
      .from('players')
      .select('external_id, name, country')
      .in('external_id', missingIds)
    if (strayError) console.error('[edition] stray player lookup failed:', strayError.message)
    for (const p of strays ?? []) overrides[p.external_id] = { name: p.name, country: p.country }
  }

  return buildMyTournament({
    picks,
    results: detail.results,
    matches,
    pointsByMatch,
    overrides,
  })
}
