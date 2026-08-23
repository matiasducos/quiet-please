import { cookies } from 'next/headers'
import SiteNotice from './SiteNotice'
import { ROUND_PROSE } from '@/lib/tennis/pick-gaps'
import type { PickGapPrompt } from '@/lib/tournaments/pick-gaps'
import {
  CONSENT_COOKIE_NAME,
  CONSENT_REQUIRED_COOKIE_NAME,
  mayStoreNonEssential,
  parseConsent,
} from '@/lib/consent'

/**
 * The site notice for a tournament running right now that this person is not
 * fully entered in.
 *
 * Where FeaturedSlamNotice sells the occasion, this one is about the points
 * already on the table: a bracket that stops at the round of 16 scores nothing
 * from the quarterfinals onwards, and nothing in the app told anybody that.
 * Rounds unlock as results land — `prediction_mode` is `manual_lock`, so a
 * played match feeds its real winner forward and the next round becomes
 * pickable — which means "you can still fix this" is true right up to the final
 * and is worth saying out loud while it is.
 *
 * Whether to show it is decided entirely by `getPickGapPrompt`; everything here
 * is presentation plus the dismissal read. See SiteNotices for why this one
 * outranks the invite bar.
 */

/**
 * A live tournament runs a fortnight at most, and the cookie name carries the
 * round, so a new one is minted every time the bracket moves on. Ninety days
 * each would leave a season's worth riding on every request.
 */
const DISMISS_MAX_AGE = 14 * 24 * 60 * 60

/** Urgency, and deliberately not the court green the invite notice uses. */
const ACCENT = { base: '#c2531f', soft: '#fdece0', ink: '#7a3210' }

/**
 * Same list as the invite notice: surfaces that already make this ask, and
 * flows with one job that a second call to action would compete with.
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

export default async function PickGapNotice({ prompt }: { prompt: PickGapPrompt }) {
  // Scoped to the round, not the tournament: dismissing "predict the quarters"
  // must not also swallow the semifinal nudge two days later, which is the one
  // that costs the most points to miss.
  const dismissCookieName = `qp_gap_${prompt.tournamentId}_${prompt.round}`

  const cookieStore = await cookies()
  if (cookieStore.get(dismissCookieName)?.value === '1') return null

  // Same rule and the same fail-closed default as middleware.
  const decision = parseConsent(cookieStore.get(CONSENT_COOKIE_NAME)?.value)
  const consentRequired = cookieStore.get(CONSENT_REQUIRED_COOKIE_NAME)?.value !== '0'
  const canPersistDismissal = mayStoreNonEssential(decision, consentRequired)

  const round = ROUND_PROSE[prompt.round] ?? 'the next round'

  return (
    <SiteNotice
      // Tournament references lead with the flag everywhere else in the app.
      // The location beats the name on a 375px bar — "Cincinnati" is the word
      // people use, and "Cincinnati Open" wraps the kicker onto two lines.
      kicker={`${prompt.flagEmoji ? `${prompt.flagEmoji} ` : ''}${prompt.location?.split(',')[0] ?? prompt.name}`}
      headline={
        prompt.hasBracket
          ? `You're missing out — your bracket stops short. Predict ${round} now!`
          : `You're missing out — ${round} is still open. Predict it now!`
      }
      // Straight to the round with the holes in it. The predictor reads
      // `?round=` and opens on that tab, so the CTA lands on the matches the
      // notice is about rather than on R128, which was played a week ago.
      cta={{
        href: `/tournaments/${prompt.tournamentId}/predict?round=${prompt.round}`,
        label: 'Predict now',
        location: 'notice_pick_gap',
      }}
      accent={ACCENT}
      dismissCookieName={dismissCookieName}
      canPersistDismissal={canPersistDismissal}
      dismissMaxAge={DISMISS_MAX_AGE}
      hidePathPrefixes={[
        ...ALWAYS_HIDDEN_PREFIXES,
        // The bracket itself. Both spellings, because the predict route takes a
        // series slug or the legacy UUID and in-app links still use the UUID.
        `/tournaments/${prompt.tournamentId}/predict`,
        ...(prompt.seriesSlug ? [`/tournaments/${prompt.seriesSlug}/predict`] : []),
      ]}
    />
  )
}
