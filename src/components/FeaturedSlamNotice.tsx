import { cookies } from 'next/headers'
import SiteNotice, { type NoticeSpec } from './SiteNotice'
import { getFeaturedSlam, type FeaturedSlam } from '@/lib/slams/featured'
import {
  CONSENT_COOKIE_NAME,
  CONSENT_REQUIRED_COOKIE_NAME,
  mayStoreNonEssential,
  parseConsent,
} from '@/lib/consent'

/**
 * The site notice for a major whose draw has not landed yet.
 *
 * Its job is the social loop, not the bracket. The bracket already has CTAs on
 * the edition page, the slam landing pages and the tournament cards; what the
 * app has never had is a visible way to bring someone else in. Measured over
 * the 30 days to 20 Aug 2026, `friend_request_sent` and `challenge_created`
 * fired five and two times respectively and every single one of those events
 * came from the operator's own account — nobody else has ever sent an invite or
 * opened a challenge. The instrumentation was fine; the entry points were a
 * collapsed avatar dropdown and two empty states.
 *
 * A major is the occasion that makes the ask land, and the window before the
 * draw is the part of it that matters: an invite sent this week is a player on
 * day one, while an invite sent once the draw is out is somebody still
 * confirming their email during the first round.
 *
 * Mounted in Nav rather than the root layout on purpose — see SiteNotice for
 * why that choice is what makes the dismissal free — which also means /admin
 * never sees it, since the admin pages render their own chrome.
 */

/**
 * Where the notice would be noise.
 *
 * Everything here is either a surface that already makes the same ask, or a
 * flow with one job that a second call to action would compete with. The
 * anonymous bracket and challenge views (/b, /c) matter most: those visitors
 * are three clicks from an account and interrupting that to sell them a
 * referral would trade a conversion for a click.
 */
const ALWAYS_HIDDEN_PREFIXES = [
  '/play',
  '/b/',
  '/c/',
  '/invite',
  '/challenges/create',
  '/challenges/new',
  '/onboarding',
  '/setup-username',
  '/welcome',
  '/check-email',
]

/**
 * Everything the bar would say and do for this major.
 *
 * Pure, and exported for the same reason as `pickGapNoticeSpec`: /admin/banners
 * reports the live copy by reading this, so the report cannot drift away from
 * what is actually on the site.
 */
export function featuredSlamNoticeSpec({ config, editions }: FeaturedSlam): NoticeSpec {
  return {
    // Tournament references lead with the flag everywhere else in the app;
    // this is no exception. The config carries one because sync-created rows
    // leave `flag_emoji` NULL.
    kicker: `${config.flagEmoji} ${config.name}`,
    headline: 'The draw lands soon. Invite your friends and have a challenge!',
    // One destination for everyone, signed in or not. A guest lands on
    // /invite's own sign-in gate and is returned here afterwards — see the
    // `authUrl` call in src/app/invite/page.tsx, which exists so that
    // round trip does not drop them on the dashboard instead.
    cta: { href: '/invite', label: 'Invite a friend', location: `notice_${config.slug}` },
    accent: config.accent,
    // Scoped to the edition, so dismissing the US Open notice does not also
    // silence the Australian Open five months later.
    dismissCookieName: `qp_notice_${config.slug}_${editions.year ?? 'next'}`,
    hidePathPrefixes: [
      ...ALWAYS_HIDDEN_PREFIXES,
      // The slam's own landing page opens with this exact pitch.
      config.route,
    ],
  }
}

export default async function FeaturedSlamNotice() {
  const featured = await getFeaturedSlam()
  if (!featured) return null

  const spec = featuredSlamNoticeSpec(featured)

  const cookieStore = await cookies()
  if (cookieStore.get(spec.dismissCookieName)?.value === '1') return null

  // Same rule and the same fail-closed default as middleware: an absent flag
  // means the region is unknown, which is treated as "consent required".
  const decision = parseConsent(cookieStore.get(CONSENT_COOKIE_NAME)?.value)
  const consentRequired = cookieStore.get(CONSENT_REQUIRED_COOKIE_NAME)?.value !== '0'
  const canPersistDismissal = mayStoreNonEssential(decision, consentRequired)

  return <SiteNotice {...spec} canPersistDismissal={canPersistDismissal} />
}
