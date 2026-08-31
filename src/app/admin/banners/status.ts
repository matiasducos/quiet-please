import { ALL_SLAMS } from '@/lib/slams/config'
import { getSlamEditions } from '@/lib/slams/data'
import { getFeaturedSlam, LEAD_DAYS, type FeaturedSlam } from '@/lib/slams/featured'
import { getLiveTournaments } from '@/lib/tournaments/cached'
import { getBracketShape } from '@/lib/tournaments/pick-gaps'
import { findPickGaps } from '@/lib/tennis/pick-gaps'
import { getPredictionMode, canPredictForStatus } from '@/lib/app-settings'
import { featuredSlamNoticeSpec } from '@/components/FeaturedSlamNotice'
import { pickGapNoticeSpec } from '@/components/PickGapNotice'
import type { NoticeSpec } from '@/components/SiteNotice'
import { TEST_EXTERNAL_ID } from '@/app/test-tournaments/constants'

/**
 * What the site's announcement bars are doing right now, and why.
 *
 * Read-only. Nothing here writes, and nothing here decides — every verdict is
 * produced by the same function that produces it in production, so this reports
 * the site rather than modelling it. `SiteNotices` arbitrates between two bars
 * from data an operator cannot see (tournament status, start dates, a user's
 * own picks), which is the gap this fills: the only other way to answer "is the
 * invite bar up?" was to open the site as somebody else.
 *
 * ── Why there is a "baseline user" ────────────────────────────────────────
 * The pick-gap bar is per-user, so there is no single true answer to "is it
 * showing". Counting the users who would see it means scanning predictions,
 * which grows with the user base and would put an O(n) query behind an
 * informational page. So this evaluates one hypothetical instead: signed in,
 * with no bracket in any live tournament. That is the maximum-eligibility case
 * — every other user has picks, and picks only ever close gaps — which gives
 * the useful invariant that a tournament this user would not be nudged about
 * is one nobody is being nudged about.
 *
 * The two per-user conditions that baseline cannot represent are called out on
 * each row rather than guessed at: `is_fully_locked`, and the weekly-slot check
 * that only applies to tournaments the sync created.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────
 * One cached tournament list, one cached slam list, and one cached bracket
 * shape per live tournament (four at most). Every one of those entries is
 * already populated by Nav on any signed-in page view, so opening this page
 * normally costs nothing and — more importantly — reports the same possibly
 * stale value users are being served, which a fresh query would have hidden.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Why a tournament is or is not driving the pick-gap bar. */
export type PickGapOutcome = 'would_show' | 'sandbox' | 'no_draw' | 'no_gaps'

export type PickGapCandidate = {
  id: string
  name: string
  location: string | null
  flagEmoji: string | null
  tour: string | null
  seriesSlug: string | null
  outcome: PickGapOutcome
  /** One line an operator can act on. */
  why: string
  /** Earliest round with a pickable, unpicked match, for the baseline user. */
  round: string | null
  /** Empty pickable matches in that round. */
  missing: number
  drawMatches: number
  playedMatches: number
  /**
   * True when this row's users also have to clear the weekly-slot check, which
   * the baseline cannot evaluate. False for every hand-entered tournament,
   * which today is all of them.
   */
  slotLimited: boolean
  /** Exactly what the bar would say. Null unless `outcome` is `would_show`. */
  spec: NoticeSpec | null
}

export type FeaturedCandidate = {
  slug: string
  name: string
  flagEmoji: string
  route: string
  phase: string
  year: number | null
  nextStartsAt: string | null
  /** Days until the first ball; negative once play has started. */
  daysOut: number | null
  featured: boolean
  why: string
}

export type AudienceRow = {
  audience: string
  /** The bar they get, or 'Nothing'. */
  sees: string
  why: string
}

export type BannerReport = {
  evaluatedAt: string
  predictionMode: string
  /** `canPredictForStatus('in_progress')` — the master switch on the gap bar. */
  pickGapEnabled: boolean
  pickGap: {
    candidates: PickGapCandidate[]
    /** The row `getPickGapPrompt` would return for the baseline user. */
    winner: PickGapCandidate | null
  }
  featured: {
    candidates: FeaturedCandidate[]
    winner: FeaturedSlam | null
    spec: NoticeSpec | null
    leadDays: number
  }
  audiences: AudienceRow[]
}

function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.round((t - now) / DAY_MS)
}

/**
 * The pick-gap bar, evaluated for the baseline user.
 *
 * Mirrors `getPickGapPrompt`'s loop deliberately, in the same order and with
 * the same skips, minus the two per-user reads. Iteration order matters: that
 * function returns the *first* tournament with a gap, so the winner is whichever
 * eligible row comes first by start date, not the one with the most holes.
 */
async function evaluatePickGap(): Promise<BannerReport['pickGap'] & { enabled: boolean }> {
  const enabled = await canPredictForStatus('in_progress')
  const live = await getLiveTournaments(4)

  const candidates: PickGapCandidate[] = []

  for (const t of live) {
    const base = {
      id: t.id,
      name: t.name,
      location: t.location ?? null,
      flagEmoji: t.flag_emoji ?? null,
      tour: t.tour ?? null,
      seriesSlug: t.slug ?? null,
      round: null,
      missing: 0,
      drawMatches: 0,
      playedMatches: 0,
      slotLimited: t.is_manual !== true && t.external_id !== TEST_EXTERNAL_ID,
      spec: null,
    }

    if (t.external_id === TEST_EXTERNAL_ID) {
      candidates.push({
        ...base,
        outcome: 'sandbox',
        why: 'The test-harness sandbox. Skipped by name, never nudged about.',
      })
      continue
    }

    const { matches, played } = await getBracketShape(t.id)

    if (matches.length === 0) {
      candidates.push({
        ...base,
        outcome: 'no_draw',
        why: 'No draw stored yet, so there is nothing to have a gap in.',
      })
      continue
    }

    // The baseline user has no picks at all, so the picked set is empty.
    const gaps = findPickGaps(matches, new Set(played), new Set())

    const shape = { drawMatches: matches.length, playedMatches: played.length }

    if (!gaps.nextRound) {
      candidates.push({
        ...base,
        ...shape,
        outcome: 'no_gaps',
        why: 'Every remaining match is played or unreachable — no pickable round left.',
      })
      continue
    }

    const prompt = {
      tournamentId: t.id,
      name: t.name,
      location: t.location ?? null,
      flagEmoji: t.flag_emoji ?? null,
      seriesSlug: t.slug ?? null,
      round: gaps.nextRound,
      missing: gaps.rounds[0].missing,
      // The baseline user has never opened a bracket here, which selects the
      // "still open" wording rather than the "stops short" one.
      hasBracket: false,
    }

    candidates.push({
      ...base,
      ...shape,
      outcome: 'would_show',
      why: `${gaps.rounds[0].missing} unpicked match${gaps.rounds[0].missing === 1 ? '' : 'es'} in ${gaps.nextRound}, and ${gaps.totalMissing} pickable across the draw.`,
      round: gaps.nextRound,
      missing: gaps.rounds[0].missing,
      spec: pickGapNoticeSpec(prompt),
    })
  }

  // Only when the mode allows it at all — `getPickGapPrompt` returns null before
  // it reaches the loop otherwise, so no row can win however many gaps it has.
  const winner = enabled ? candidates.find(c => c.outcome === 'would_show') ?? null : null

  return { enabled, candidates, winner }
}

/**
 * The invite bar, plus why each of the four majors is or is not carrying it.
 *
 * The winner comes from `getFeaturedSlam` itself rather than being re-derived,
 * so the two can never disagree; the per-slam rows exist only to explain it.
 */
async function evaluateFeatured(now: number): Promise<BannerReport['featured']> {
  const winner = await getFeaturedSlam(new Date(now))

  const candidates: FeaturedCandidate[] = await Promise.all(
    ALL_SLAMS.map(async config => {
      const editions = await getSlamEditions(config)
      const daysOut = daysUntil(editions.nextStartsAt, now)
      const featured = winner?.config.slug === config.slug

      let why: string
      if (featured) {
        why = `In the pre-draw window — ${daysOut ?? '?'} days out, inside the ${LEAD_DAYS}-day lead.`
      } else if (editions.phase !== 'upcoming') {
        why = `Phase is "${editions.phase}", not "upcoming". The bar promises a draw that has not landed, so publishing one retires it.`
      } else if (editions.nextStartsAt === null) {
        why = 'No scheduled edition to count down to.'
      } else if (daysOut !== null && daysOut > LEAD_DAYS) {
        why = `Still ${daysOut} days out; the bar starts at ${LEAD_DAYS}.`
      } else {
        // Reachable only when two majors overlap inside the window, which the
        // calendar makes unlikely rather than impossible.
        why = 'Eligible, but another major starts sooner and wins the sort.'
      }

      return {
        slug: config.slug,
        name: config.name,
        flagEmoji: config.flagEmoji,
        route: config.route,
        phase: editions.phase,
        year: editions.year,
        nextStartsAt: editions.nextStartsAt,
        daysOut,
        featured,
        why,
      }
    }),
  )

  return {
    candidates,
    winner,
    spec: winner ? featuredSlamNoticeSpec(winner) : null,
    leadDays: LEAD_DAYS,
  }
}

/**
 * Resolve `SiteNotices`'s arbitration into the handful of cases worth stating.
 *
 * Reproduces one rule that is easy to misread in that file: a *dismissed*
 * pick-gap bar does not fall through to the invite bar. The gap existing is
 * what suppresses the invite ask, not the gap being on screen.
 */
function describeAudiences(
  pickGap: BannerReport['pickGap'] & { enabled: boolean },
  featured: BannerReport['featured'],
): AudienceRow[] {
  const invite = featured.spec ? `Invite bar — ${featured.winner?.config.name}` : 'Nothing'
  const inviteWhy = featured.spec
    ? 'No pick-gap prompt for this visitor, so SiteNotices falls through to the invite bar.'
    : 'No major is inside its pre-draw window, so there is no fallback bar.'

  const rows: AudienceRow[] = [
    {
      audience: 'Signed out',
      sees: invite,
      why: `SiteNotices is passed no user id, so the gap bar is never evaluated. ${inviteWhy}`,
    },
  ]

  if (pickGap.winner) {
    rows.push({
      audience: 'Signed in, no bracket in a live tournament',
      sees: `Pick-gap bar — ${pickGap.winner.name}`,
      why: `${pickGap.winner.round} is open with ${pickGap.winner.missing} unpicked. Outranks the invite bar.`,
    })
    rows.push({
      audience: 'Signed in, predicted through to the final everywhere',
      sees: invite,
      why: `No gap left to nudge about. ${inviteWhy}`,
    })
  } else {
    rows.push({
      audience: 'Signed in',
      sees: invite,
      why: pickGap.enabled
        ? `No live tournament has a pickable gap, so no user can get the gap bar. ${inviteWhy}`
        : `Prediction mode blocks predicting an in-progress tournament, so the gap bar is off for everyone. ${inviteWhy}`,
    })
  }

  rows.push({
    audience: 'Anywhere under /admin',
    sees: 'Nothing',
    why: 'Both bars mount inside Nav, and the admin pages render their own chrome.',
  })

  return rows
}

export async function getBannerReport(): Promise<BannerReport> {
  const now = Date.now()

  // Independent, so one round of latency rather than two.
  const [pickGap, featured] = await Promise.all([evaluatePickGap(), evaluateFeatured(now)])

  return {
    evaluatedAt: new Date(now).toISOString(),
    predictionMode: await getPredictionMode(),
    pickGapEnabled: pickGap.enabled,
    pickGap: { candidates: pickGap.candidates, winner: pickGap.winner },
    featured,
    audiences: describeAudiences(pickGap, featured),
  }
}
