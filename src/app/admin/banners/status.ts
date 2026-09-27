import { ALL_SLAMS } from '@/lib/slams/config'
import { getSlamEditions } from '@/lib/slams/data'
import { getFeaturedSlam, LEAD_DAYS, type FeaturedSlam } from '@/lib/slams/featured'
import { featuredSlamNoticeSpec } from '@/components/FeaturedSlamNotice'
import type { NoticeSpec } from '@/components/SiteNotice'

/**
 * What the site's announcement bar is doing right now, and why.
 *
 * Read-only. Nothing here writes, and nothing here decides — the verdict comes
 * from `getFeaturedSlam`, the same function Nav's bar uses, so this reports the
 * site rather than modelling it. It exists because the bar turns on and off
 * from data an operator cannot see (a major's phase and start date), and the
 * only other way to answer "is the invite bar up?" was to go and look.
 *
 * There used to be a second, per-user bar — "you're missing out, predict the
 * next round" — and most of this file's complexity was reporting it against a
 * baseline user. It was dropped on 2026-09-27.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────
 * One cached slam list, already populated by Nav on any page view, so opening
 * this page normally costs nothing and reports the same possibly stale value
 * visitors are being served.
 */

const DAY_MS = 24 * 60 * 60 * 1000

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

/** Who gets the bar. It is not per-user, so this is short. */
function describeAudiences(featured: BannerReport['featured']): AudienceRow[] {
  const sees = featured.spec ? `Invite bar — ${featured.winner?.config.name}` : 'Nothing'
  const why = featured.spec
    ? 'A major is inside its pre-draw window. Hidden on the paths in its spec, and gone for anyone who dismissed it.'
    : 'No major is inside its pre-draw window.'

  return [
    { audience: 'Every visitor, signed in or out', sees, why },
    {
      audience: 'Anywhere under /admin',
      sees: 'Nothing',
      why: 'The bar mounts inside Nav, and the admin pages render their own chrome.',
    },
  ]
}

export async function getBannerReport(): Promise<BannerReport> {
  const now = Date.now()
  const featured = await evaluateFeatured(now)

  return {
    evaluatedAt: new Date(now).toISOString(),
    featured,
    audiences: describeAudiences(featured),
  }
}
