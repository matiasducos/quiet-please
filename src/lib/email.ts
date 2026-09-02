import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { type EmailPrefKey, EMAIL_PREF_LABELS, isEmailEnabled } from '@/lib/email-preferences'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM = process.env.EMAIL_FROM ?? 'Quiet Please <notifications@quietplease.app>'
const REPLY_TO = 'support@quietplease.app'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://quietplease.app'

// No-op in dev / when key is missing
function canSend() {
  if (!resend) {
    console.log('[email] RESEND_API_KEY not set — skipping email')
    return false
  }
  return true
}

/** Returns true if the email belongs to a bot account (never send emails to bots). */
export function isBotEmail(email: string): boolean {
  return email.endsWith('@bot.quietplease.app')
}

/**
 * @param prefKey  When given, the footer leads with a one-click opt-out for
 *                 THIS kind of email only, and "unsubscribe from everything"
 *                 becomes the secondary option. Use it for mail the user did
 *                 not trigger by an action of their own — draw announcements go
 *                 to the entire user base, so "stop these" has to be at least
 *                 as easy to find as "stop all", or people reach for the spam
 *                 button instead.
 * @param prefsHref Deep link to the user's own Email preferences panel. Passing
 *                 it is what makes per-type control discoverable from the inbox.
 */
function unsubscribeFooter(
  unsubscribeToken: string,
  prefKey?: EmailPrefKey,
  prefsHref?: string,
) {
  const allUrl = `${BASE_URL}/api/unsubscribe?token=${unsubscribeToken}`
  const link = (href: string, text: string) =>
    `<a href="${href}" style="color:#999;text-decoration:underline;">${text}</a>`

  const manageLine = prefsHref
    ? `<br/>Or ${link(prefsHref, 'choose which emails you get')}.`
    : ''

  if (prefKey) {
    const oneUrl = `${allUrl}&type=${prefKey}`
    const label = EMAIL_PREF_LABELS[prefKey].label.toLowerCase()
    return `
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e8e3d8;">
      <p style="font-size:11px;color:#999;line-height:1.5;">
        You received this email because you have an account on Quiet Please.<br/>
        ${link(oneUrl, `Unsubscribe from ${label} emails`)} — you'll still get your other notifications.<br/>
        ${link(allUrl, 'Unsubscribe from all emails')}.${manageLine}
      </p>
    </div>`
  }

  return `
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e8e3d8;">
      <p style="font-size:11px;color:#999;line-height:1.5;">
        You received this email because you have an account on Quiet Please.<br/>
        ${link(allUrl, 'Unsubscribe')} from all email notifications.${manageLine}
      </p>
    </div>`
}

export interface DrawOpenTournamentInfo {
  id: string
  name: string
  /** "City, Country" as stored on the tournament row. */
  location: string | null
  flagEmoji: string | null
  tour: string | null
  category: string | null
  surface: string | null
  drawSize: number | null
  startsAt: string | null
  endsAt: string | null
  closeDate: string | null
}

/** The recipient's own standing, so the email says something about THEM. */
export interface DrawOpenRank {
  position: number
  total: number
  points: number
}

export interface DrawOpenEmail {
  to: string
  unsubscribeToken: string
  tournament: DrawOpenTournamentInfo
  /** null for players who haven't scored yet — they get an invitation instead. */
  rank: DrawOpenRank | null
  /** Used to deep-link the recipient's own Email preferences panel. */
  username?: string
}

const CATEGORY_LABEL: Record<string, string> = {
  grand_slam: 'Grand Slam',
  masters_1000: 'Masters 1000',
  '500': '500',
  '250': '250',
}

/** "Masters 1000" alone is ambiguous across tours; "Grand Slam" already isn't. */
function categoryLabel(tour: string | null, category: string | null): string | null {
  if (!category) return null
  const base = CATEGORY_LABEL[category]
  if (!base) return null
  if (category === 'grand_slam') return base
  return tour ? `${tour} ${base}` : base
}

/** "2–9 August" when one month, "28 July – 3 August" when it straddles two. */
function dateRange(startsAt: string | null, endsAt: string | null): string | null {
  if (!startsAt) return null
  const s = new Date(startsAt)
  if (Number.isNaN(s.getTime())) return null
  const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
  const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })
  if (!endsAt) return `${day(s)} ${month(s)}`
  const e = new Date(endsAt)
  if (Number.isNaN(e.getTime())) return `${day(s)} ${month(s)}`
  return month(s) === month(e)
    ? `${day(s)}–${day(e)} ${month(s)}`
    : `${day(s)} ${month(s)} – ${day(e)} ${month(e)}`
}

const nf = new Intl.NumberFormat('en-GB')

function drawOpenSubject(o: DrawOpenEmail) {
  const flag = o.tournament.flagEmoji ? `${o.tournament.flagEmoji} ` : ''
  return `${flag}Draw open: ${o.tournament.name}`
}

function drawOpenHtml(o: DrawOpenEmail) {
  const t = o.tournament
  const prefsHref = o.username
    ? `${BASE_URL}/profile/${encodeURIComponent(o.username)}#email-preferences`
    : undefined

  // Meta line: "ATP Masters 1000 · Hard · 128 draw". Every part is optional
  // because manually-entered tournaments don't always carry all of them.
  const facts = [
    categoryLabel(t.tour, t.category),
    t.surface ? t.surface.charAt(0).toUpperCase() + t.surface.slice(1) : null,
    t.drawSize ? `${t.drawSize} draw` : null,
  ].filter(Boolean)

  const dates = dateRange(t.startsAt, t.endsAt)

  const closeLine = t.closeDate
    ? `<tr><td style="padding:14px 0 0;font-family:Georgia,serif;font-size:13px;color:#b3392c;">
         Picks close ${new Date(t.closeDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}.
       </td></tr>`
    : ''

  // The engagement block. A ranked player sees where they stand; someone who
  // hasn't scored yet is told how to get on the board rather than being shown
  // a last-place number, which reads as a reason not to bother.
  const standing = o.rank
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e8e3d8;border-radius:3px;margin:0 0 24px;">
        <tr>
          <td style="padding:16px 18px;">
            <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a867e;">Where you stand</p>
            <p style="margin:0;font-family:Georgia,serif;font-size:20px;color:#0d0d0d;">
              <strong>#${nf.format(o.rank.position)}</strong>
              <span style="font-size:14px;color:#6b6b6b;"> of ${nf.format(o.rank.total)} worldwide</span>
            </p>
            <p style="margin:4px 0 0;font-family:Georgia,serif;font-size:13px;color:#6b6b6b;">${nf.format(o.rank.points)} ranking points</p>
          </td>
        </tr>
      </table>`
    : `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e8e3d8;border-radius:3px;margin:0 0 24px;">
        <tr>
          <td style="padding:16px 18px;">
            <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a867e;">Where you stand</p>
            <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#0d0d0d;">Not on the board yet.</p>
            <p style="margin:4px 0 0;font-family:Georgia,serif;font-size:13px;color:#6b6b6b;">One correct pick is all it takes to get a ranking.</p>
          </td>
        </tr>
      </table>`

  // No longer keyed to the winner's points, so it renders for every category.
  const prize = `<p style="margin:0 0 28px;font-family:Georgia,serif;font-size:13px;color:#6b6b6b;text-align:center;">
         Make your picks and win as many points to climb the <strong style="color:#1a6b3c;">leaderboard</strong>.
       </p>`

  return `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin:0 0 24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 20px;">The draw is open.</h1>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 24px;padding:0;border-top:1px solid #e8e3d8;border-bottom:1px solid #e8e3d8;">
          <tr>
            <td style="padding:18px 0 0;font-family:Georgia,serif;font-size:19px;line-height:1.3;color:#0d0d0d;">
              ${t.flagEmoji ? `${t.flagEmoji} ` : ''}${t.name}
            </td>
          </tr>
          ${t.location ? `<tr><td style="padding:6px 0 0;font-family:Georgia,serif;font-size:14px;color:#6b6b6b;">${t.location}</td></tr>` : ''}
          ${facts.length ? `<tr><td style="padding:4px 0 0;font-family:Georgia,serif;font-size:13px;color:#8a867e;">${facts.join(' · ')}</td></tr>` : ''}
          ${dates ? `<tr><td style="padding:4px 0 0;font-family:Georgia,serif;font-size:13px;color:#8a867e;">${dates}</td></tr>` : ''}
          ${closeLine}
          <tr><td style="padding:0 0 18px;"></td></tr>
        </table>

        ${standing}
        ${prize}

        <div style="text-align:center;">
          <a href="${BASE_URL}/tournaments/${t.id}"
             style="display:inline-block;background:#1a6b3c;color:#ffffff;text-decoration:none;padding:13px 28px;font-size:15px;border-radius:2px;">
            Make your picks →
          </a>
        </div>
        ${unsubscribeFooter(o.unsubscribeToken, 'draw_open', prefsHref)}
      </div>`
}

export async function sendDrawOpenEmail(opts: DrawOpenEmail) {
  if (!canSend()) return
  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: drawOpenSubject(opts),
    html: drawOpenHtml(opts),
  })
}

/** Resend's batch endpoint accepts at most 100 messages per request. */
const RESEND_BATCH_LIMIT = 100

/**
 * Draw-open is the only email that fans out to the ENTIRE user base, so it's
 * the one place per-message sends don't scale: at 10k users that's 10k HTTP
 * round trips, which no serverless invocation will survive. Resend's batch
 * endpoint takes 100 per request, turning that into 100 calls.
 *
 * Returns the number of messages accepted so callers can log and surface it —
 * a fan-out that quietly reaches nobody is exactly the failure mode this whole
 * change exists to fix.
 */
export async function sendDrawOpenEmails(recipients: DrawOpenEmail[]): Promise<number> {
  if (!canSend() || recipients.length === 0) return 0
  let sent = 0
  for (let i = 0; i < recipients.length; i += RESEND_BATCH_LIMIT) {
    const chunk = recipients.slice(i, i + RESEND_BATCH_LIMIT)
    try {
      const { error } = await resend!.batch.send(
        chunk.map(r => ({
          from: FROM,
          replyTo: REPLY_TO,
          to: r.to,
          subject: drawOpenSubject(r),
          html: drawOpenHtml(r),
        })),
      )
      if (error) {
        console.error('[email] draw-open batch failed:', error.message)
        continue
      }
      sent += chunk.length
    } catch (e) {
      // One bad chunk must not cost the remaining recipients their email.
      console.error('[email] draw-open batch threw:', e)
    }
  }
  return sent
}

// ── Draw reminder: the anonymous half of the draw-open announcement ──────────

export interface DrawReminderEmail {
  to: string
  tournament: DrawOpenTournamentInfo
  /**
   * Series slug, so the CTA can land on /play — the no-account bracket flow.
   * Null for a tournament with no series, which falls back to the edition
   * redirect and its own signed-out CTA.
   */
  seriesSlug: string | null
  emailToken: string
}

/**
 * Opt-out footer for the reminder.
 *
 * Separate from `anonymousFooter` because that one states the recipient asked
 * "to be told how your bracket finished" — true for a /play bracket, a plain
 * falsehood here, where they never made one. The mechanic is identical: the
 * address is erased by the send itself, and the link only confirms it.
 */
function drawReminderFooter(emailToken: string) {
  const url = `${BASE_URL}/api/unsubscribe/anonymous?token=${emailToken}`
  return `
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e8e3d8;">
      <p style="font-size:11px;color:#999;line-height:1.5;">
        You're getting this once because you asked to be told when this draw was
        published. You don't have an account with us, and we deleted your address
        when we sent this — it was the only thing we collected it for, so there
        is no list to leave.<br/>
        <a href="${url}" style="color:#999;text-decoration:underline;">Confirm removal</a>.
      </p>
    </div>`
}

function drawReminderSubject(o: DrawReminderEmail) {
  const flag = o.tournament.flagEmoji ? `${o.tournament.flagEmoji} ` : ''
  return `${flag}The ${o.tournament.name} draw is out`
}

/**
 * Deliberately not `drawOpenHtml` with the standing block removed.
 *
 * That email is written for someone who already plays: it opens on where they
 * rank, and its CTA points at /tournaments/<id>, which for a signed-out reader
 * leads to a Predict button that bounces them to /signup. Sending it to a
 * stranger would deliver a registration form to someone whose entire
 * relationship with us is one line in a text box — the same "the word free was
 * a lie" failure the edition page's own CTA comment describes.
 *
 * So the promise made on the page ("we'll email you when it's out") is the
 * whole content, and the CTA is the bracket itself at /play, where no account
 * is needed to fill one in.
 */
function drawReminderHtml(o: DrawReminderEmail) {
  const t = o.tournament

  const facts = [
    categoryLabel(t.tour, t.category),
    t.surface ? t.surface.charAt(0).toUpperCase() + t.surface.slice(1) : null,
    t.drawSize ? `${t.drawSize} draw` : null,
  ].filter(Boolean)

  const dates = dateRange(t.startsAt, t.endsAt)

  const closeLine = t.closeDate
    ? `<tr><td style="padding:14px 0 0;font-family:Georgia,serif;font-size:13px;color:#b3392c;">
         Picks close ${new Date(t.closeDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}.
       </td></tr>`
    : ''

  const playUrl = o.seriesSlug
    ? `${BASE_URL}/play/${o.seriesSlug}`
    : `${BASE_URL}/tournaments/${t.id}`

  return `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin:0 0 24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">The draw is out.</h1>
        <p style="color:#6b6b6b;font-size:16px;margin:0 0 24px;">You asked us to tell you. Here it is.</p>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 24px;padding:0;border-top:1px solid #e8e3d8;border-bottom:1px solid #e8e3d8;">
          <tr>
            <td style="padding:18px 0 0;font-family:Georgia,serif;font-size:19px;line-height:1.3;color:#0d0d0d;">
              ${t.flagEmoji ? `${t.flagEmoji} ` : ''}${t.name}
            </td>
          </tr>
          ${t.location ? `<tr><td style="padding:6px 0 0;font-family:Georgia,serif;font-size:14px;color:#6b6b6b;">${t.location}</td></tr>` : ''}
          ${facts.length ? `<tr><td style="padding:4px 0 0;font-family:Georgia,serif;font-size:13px;color:#8a867e;">${facts.join(' · ')}</td></tr>` : ''}
          ${dates ? `<tr><td style="padding:4px 0 0;font-family:Georgia,serif;font-size:13px;color:#8a867e;">${dates}</td></tr>` : ''}
          ${closeLine}
          <tr><td style="padding:0 0 18px;"></td></tr>
        </table>

        <p style="margin:0 0 24px;font-family:Georgia,serif;font-size:15px;color:#6b6b6b;line-height:1.5;">
          Pick every match from the first round to the final. It takes a couple of
          minutes, it scores itself as the results come in, and you don't need an
          account to fill one in.
        </p>

        <div style="text-align:center;">
          <a href="${playUrl}"
             style="display:inline-block;background:#1a6b3c;color:#ffffff;text-decoration:none;padding:13px 28px;font-size:15px;border-radius:2px;">
            Fill in your bracket — free →
          </a>
        </div>
        ${drawReminderFooter(o.emailToken)}
      </div>`
}

/**
 * Batched for the same reason `sendDrawOpenEmails` is — this runs inside the
 * same announcement, on the same 60s serverless budget, and one HTTP round trip
 * per address does not survive a popular tournament.
 *
 * Returns the addresses actually accepted, so the caller can erase exactly
 * those and leave a failed chunk to be retried rather than silently dropped.
 */
export async function sendDrawReminderEmails(recipients: DrawReminderEmail[]): Promise<string[]> {
  if (!canSend() || recipients.length === 0) return []
  const sent: string[] = []
  for (let i = 0; i < recipients.length; i += RESEND_BATCH_LIMIT) {
    const chunk = recipients.slice(i, i + RESEND_BATCH_LIMIT)
    try {
      const { error } = await resend!.batch.send(
        chunk.map(r => ({
          from: FROM,
          replyTo: REPLY_TO,
          to: r.to,
          subject: drawReminderSubject(r),
          html: drawReminderHtml(r),
        })),
      )
      if (error) {
        console.error('[email] draw-reminder batch failed:', error.message)
        continue
      }
      sent.push(...chunk.map(r => r.to))
    } catch (e) {
      console.error('[email] draw-reminder batch threw:', e)
    }
  }
  return sent
}

export interface PointsAwardedRoundBreakdown {
  round: string
  label: string
  matches: number
  wins: number
  points: number
}

export interface PointsAwardedRank {
  position: number
  total: number
  /** previous position minus current position: positive = moved up, negative = moved down, 0 = no change */
  movement: number
}

/**
 * A tie the email advertises as still to be played.
 *
 * Pre-formatted rather than structured: `favourite` arrives as the finished
 * sentence, built by the same `favouriteLabel` helper the social card uses, so
 * the mail and the post cannot end up quoting the crowd differently. null is a
 * fact, not a gap — it means no bracket has picked the tie, which is the normal
 * state for a round the field has not reached yet, and it must never render as
 * a 50/50.
 */
export interface PointsAwardedUpcomingMatch {
  a: string
  b: string
  favourite: string | null
  /**
   * Which side THIS recipient has in the tie, or null when they have no pick
   * that can score on it. The one per-recipient field on the block — see
   * `personaliseUpcoming`, which is also where "cannot score" is defined.
   */
  picked: 'a' | 'b' | null
}

/** The "up next" block under one tournament's round breakdown. */
export interface PointsAwardedUpcoming {
  roundLabel: string
  /** Already capped and ordered by the caller; rendered as given. */
  matches: PointsAwardedUpcomingMatch[]
}

export interface PointsAwardedTournament {
  tournamentId: string
  tournamentName: string
  flagEmoji: string | null
  points: number
  rank: PointsAwardedRank | null
  rounds: PointsAwardedRoundBreakdown[]
  /**
   * What to play for next, or null when there is nothing to say — the
   * tournament is over, the admin suppressed the block, or the next round's
   * line-up is not known yet. See `buildPointsEmailUpcoming`.
   */
  upcoming: PointsAwardedUpcoming | null
}

/**
 * Player names reach this template from the draw, which is hand-entered, so
 * they are escaped where the surrounding lines are not. The older fields
 * predate this and are left alone deliberately: retrofitting them is a separate
 * change with its own blast radius, and an unescaped tournament name has been
 * rendering safely for a year.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Forward-looking half of the tournament block.
 *
 * Deliberately quiet: smaller than the points it sits under, no button of its
 * own. The email's job is still to report what was scored — this is the line
 * that says the story is not over, not a second call to action competing with
 * "View your picks".
 */
function upcomingBlock(u: PointsAwardedUpcoming): string {
  if (!u.matches.length) return ''
  const rows = u.matches
    .map(m => {
      // The recipient's own player is named in words rather than marked up in
      // the line above. Colour and weight are the first things an email client
      // throws away — dark mode inverts, Outlook flattens — so "which one did I
      // have?" is answered by text that survives all of it.
      //
      // A missing pick is the actionable half of this block and gets the same
      // clay the ranking uses for a drop: it is the one row here the recipient
      // can still do something about, and the CTA below goes where they'd do it.
      const yours = m.picked
        ? `<span style="color:#1a6b3c;">You picked ${esc(m[m.picked])}</span>`
        : `<span style="color:#b3392c;">You haven&rsquo;t picked a winner</span>`
      // The crowd line joins it when there is one. There is no third state to
      // fall back to: `yours` always says something, and a tie no bracket has
      // picked simply has nothing to add after it.
      const evidence = [yours, m.favourite ? esc(m.favourite) : null].filter(Boolean)
      return `
        <tr>
          <td style="padding:9px 0 0;font-family:Georgia,serif;font-size:14px;color:#0d0d0d;">
            ${esc(m.a)} <span style="color:#8a867e;">v</span> ${esc(m.b)}
          </td>
        </tr>
        <tr>
          <td style="padding:1px 0 9px;font-family:Georgia,serif;font-size:12px;color:#8a867e;">
            ${evidence.join(' &middot; ')}
          </td>
        </tr>`
    })
    .join('')
  return `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 24px;">
        <tr>
          <td style="padding:0 0 2px;font-family:Georgia,serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b6b6b;">
            Up next &#8212; ${esc(u.roundLabel)}
          </td>
        </tr>
        ${rows}
      </table>`
}

function rankLine(rank: PointsAwardedRank | null): string {
  if (!rank) return ''
  const movementHtml =
    rank.movement > 0
      ? `<span style="color:#1a6b3c;">&#9650; up ${rank.movement}</span>`
      : rank.movement < 0
        ? `<span style="color:#b3392c;">&#9660; down ${Math.abs(rank.movement)}</span>`
        : `<span style="color:#8a867e;">&#8212; no change</span>`
  return `
        <tr>
          <td colspan="2" style="padding:0 0 10px;font-family:Georgia,serif;font-size:12px;color:#6b6b6b;">
            You're <strong style="color:#0d0d0d;">#${rank.position}</strong> of ${rank.total} ${movementHtml}
          </td>
        </tr>`
}

function tournamentBlock(t: PointsAwardedTournament): string {
  const roundRows = t.rounds
    .map(
      r => `
        <tr>
          <td style="padding:7px 0 0;font-family:Georgia,serif;font-size:13px;color:#6b6b6b;">${r.label}</td>
          <td align="right" style="padding:7px 0 0;font-family:Georgia,serif;font-size:13px;color:#0d0d0d;white-space:nowrap;">${r.points} pts</td>
        </tr>
        <tr>
          <td colspan="2" style="padding:0 0 7px;font-family:Georgia,serif;font-size:12px;color:#8a867e;border-bottom:1px solid #e8e3d8;">
            ${r.matches} match${r.matches === 1 ? '' : 'es'} played (${r.wins} winner${r.wins === 1 ? '' : 's'})
          </td>
        </tr>`,
    )
    .join('')
  return `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:8px;">
        <tr>
          <td style="padding:0 0 2px;font-family:Georgia,serif;font-size:16px;color:#0d0d0d;">
            ${t.flagEmoji ? `${t.flagEmoji} ` : ''}${t.tournamentName}
          </td>
          <td align="right" style="padding:0 0 2px;font-family:Georgia,serif;font-size:16px;color:#1a6b3c;white-space:nowrap;">
            +${t.points} pts
          </td>
        </tr>
        ${rankLine(t.rank)}
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 ${t.upcoming ? '16px' : '24px'};border-top:1px solid #e8e3d8;">
        ${roundRows}
      </table>${t.upcoming ? upcomingBlock(t.upcoming) : ''}`
}

export interface PointsAwardedEmail {
  to: string
  totalPoints: number
  correctPicks: number
  tournaments: PointsAwardedTournament[]
  unsubscribeToken: string
}

export function pointsAwardedSubject(opts: PointsAwardedEmail): string {
  return opts.tournaments.length === 1
    ? `+${opts.totalPoints} pts — ${opts.tournaments[0].tournamentName}`
    : `+${opts.totalPoints} pts across ${opts.tournaments.length} tournaments`
}

/**
 * Split out from the send so it can be rendered without a network, a database
 * or a Resend key — `scripts/preview-points-email.mjs` writes real HTML from
 * fixtures. Matches how drawOpenHtml and tournamentCompleteHtml are already
 * factored above; this one was the odd template still inlined in its sender.
 */
export function pointsAwardedHtml(opts: PointsAwardedEmail): string {
  const single = opts.tournaments.length === 1
  const subLine = single
    ? `${opts.correctPicks} correct pick${opts.correctPicks === 1 ? '' : 's'}`
    : `Across ${opts.tournaments.length} tournaments · ${opts.correctPicks} correct pick${opts.correctPicks === 1 ? '' : 's'}`
  // Deep-link to the single tournament when there's only one; otherwise send
  // users to their dashboard where all affected tournaments are visible.
  const ctaHref = single
    ? `${BASE_URL}/tournaments/${opts.tournaments[0].tournamentId}`
    : `${BASE_URL}/dashboard`

  return `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 6px;">+${opts.totalPoints} points earned.</h1>
        <p style="color:#6b6b6b;font-size:14px;margin:0 0 28px;">${subLine}</p>
        ${opts.tournaments.map(tournamentBlock).join('')}
        <div>
          <a href="${ctaHref}"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
            View your picks →
          </a>
        </div>
        ${unsubscribeFooter(opts.unsubscribeToken)}
      </div>`
}

export async function sendPointsAwardedEmail(opts: PointsAwardedEmail) {
  if (!canSend()) return
  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: pointsAwardedSubject(opts),
    html: pointsAwardedHtml(opts),
  })
}

/* ── Tournament complete ──────────────────────────────────────────────────── */

/**
 * The one email that says a tournament is OVER.
 *
 * Until this existed, a signed-in participant was never told. They got a
 * "+380 pts" mail from whichever scoring run happened to catch the final —
 * which reads as a mid-tournament update, because that is what it is every
 * other time it arrives — and nothing else unless they podiumed. The only
 * completion mail in the codebase went to anonymous players (award-points
 * 12b/12c), so the people with accounts, the ones actually worth bringing
 * back, heard the least.
 *
 * Sent to the whole field, so it carries a per-type unsubscribe for the same
 * reason draw-open does: mail the user did not trigger by an action of their
 * own needs "stop these" to be as easy to find as "stop all", or people reach
 * for the spam button instead.
 */
export interface TournamentCompleteEmail {
  to: string
  unsubscribeToken: string
  username: string
  tournamentId: string
  /** Location where we have one — matches how the tournament is named everywhere else. */
  tournamentName: string
  tournamentFlagEmoji: string | null
  /** '🇫🇷 A. Fils' — the tennis player who won the title, not the bracket leader. */
  championLabel: string | null
  points: number
  finishRank: number
  fieldSize: number
  podium: Array<{ username: string; points: number }>
  /** Absolute URL. The recap when one is built, the edition page otherwise. */
  ctaHref: string
  ctaLabel: string
}

function tournamentCompleteSubject(o: TournamentCompleteEmail): string {
  const flag = o.tournamentFlagEmoji ? `${o.tournamentFlagEmoji} ` : ''
  // The subject leads with the result for anyone who has one. "How you
  // finished" is the only part of this mail that is about the reader, and a
  // subject line that opens with the tournament name is indistinguishable from
  // the draw-open mail for the same event.
  return o.points > 0
    ? `You finished #${nf.format(o.finishRank)} — ${flag}${o.tournamentName}`
    : `${flag}${o.tournamentName} is done`
}

function tournamentCompleteHtml(o: TournamentCompleteEmail): string {
  // Same anchor every other email uses — the profile page gives the panel
  // `id="email-preferences"` and a scroll margin precisely for these links.
  const prefsHref = o.username
    ? `${BASE_URL}/profile/${encodeURIComponent(o.username)}#email-preferences`
    : undefined
  const flag = o.tournamentFlagEmoji ? `${o.tournamentFlagEmoji} ` : ''

  const champion = o.championLabel
    ? `<tr><td style="padding:6px 0 0;font-family:Georgia,serif;font-size:14px;color:#6b6b6b;">
         Champion: <strong style="color:#0d0d0d;">${o.championLabel}</strong>
       </td></tr>`
    : ''

  // Someone who scored nothing is told how to get on the board rather than
  // shown a last-place number — the same call drawOpenHtml makes, and for the
  // same reason: "#111 of 111" reads as a reason not to come back.
  const yourResult = o.points > 0
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e8e3d8;border-radius:3px;margin:0 0 24px;">
        <tr>
          <td style="padding:16px 18px;">
            <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a867e;">How you finished</p>
            <p style="margin:0;font-family:Georgia,serif;font-size:20px;color:#0d0d0d;">
              <strong>#${nf.format(o.finishRank)}</strong>
              <span style="font-size:14px;color:#6b6b6b;"> of ${nf.format(o.fieldSize)}</span>
            </p>
            <p style="margin:4px 0 0;font-family:Georgia,serif;font-size:13px;color:#6b6b6b;">${nf.format(o.points)} points from this tournament</p>
          </td>
        </tr>
      </table>`
    : `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e8e3d8;border-radius:3px;margin:0 0 24px;">
        <tr>
          <td style="padding:16px 18px;">
            <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a867e;">How you finished</p>
            <p style="margin:0;font-family:Georgia,serif;font-size:16px;color:#0d0d0d;">No points this time.</p>
            <p style="margin:4px 0 0;font-family:Georgia,serif;font-size:13px;color:#6b6b6b;">The next draw is a clean slate — one correct pick puts you back on the board.</p>
          </td>
        </tr>
      </table>`

  // The reader is bolded when they are on it. Seeing your own name in the top
  // three is the whole point of showing a podium in an email.
  const podium = o.podium.length
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 24px;">
        <tr><td style="padding:0 0 8px;font-family:Georgia,serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a867e;">Podium</td></tr>
        ${o.podium.map((p, i) => {
          const isYou = p.username === o.username
          return `<tr>
            <td style="padding:5px 0;font-family:Georgia,serif;font-size:14px;color:${isYou ? '#1a6b3c' : '#0d0d0d'};border-top:1px solid #e8e3d8;">
              ${['🥇', '🥈', '🥉'][i] ?? ''} ${isYou ? `<strong>${p.username} (you)</strong>` : p.username}
              <span style="float:right;color:#6b6b6b;">${nf.format(p.points)} pts</span>
            </td>
          </tr>`
        }).join('')}
      </table>`
    : ''

  return `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin:0 0 24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 20px;">That's a wrap.</h1>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 24px;padding:0;border-top:1px solid #e8e3d8;border-bottom:1px solid #e8e3d8;">
          <tr>
            <td style="padding:18px 0 0;font-family:Georgia,serif;font-size:19px;line-height:1.3;color:#0d0d0d;">
              ${flag}${o.tournamentName}
            </td>
          </tr>
          ${champion}
          <tr><td style="padding:0 0 18px;"></td></tr>
        </table>

        ${yourResult}
        ${podium}

        <div style="text-align:center;">
          <a href="${o.ctaHref}"
             style="display:inline-block;background:#1a6b3c;color:#ffffff;text-decoration:none;padding:13px 28px;font-size:15px;border-radius:2px;">
            ${o.ctaLabel} →
          </a>
        </div>
        ${unsubscribeFooter(o.unsubscribeToken, 'tournament_complete', prefsHref)}
      </div>`
}

/**
 * Batched for the same reason draw-open is: this fans out to every participant
 * in the tournament, and one HTTP round trip per recipient is what kills a
 * serverless invocation. Resend takes 100 per request.
 *
 * Returns the addresses that were ACCEPTED, not a count. The caller stamps
 * `predictions.result_emailed_at` from this list, so a chunk Resend rejected
 * must not be reported as sent — those brackets have to stay pending for the
 * next run. A count alone could not tell the caller WHICH ones to stamp.
 */
export async function sendTournamentCompleteEmails(
  recipients: TournamentCompleteEmail[],
): Promise<Set<string>> {
  const accepted = new Set<string>()
  if (!canSend() || recipients.length === 0) return accepted

  for (let i = 0; i < recipients.length; i += RESEND_BATCH_LIMIT) {
    const chunk = recipients.slice(i, i + RESEND_BATCH_LIMIT)
    try {
      const { error } = await resend!.batch.send(
        chunk.map(r => ({
          from: FROM,
          replyTo: REPLY_TO,
          to: r.to,
          subject: tournamentCompleteSubject(r),
          html: tournamentCompleteHtml(r),
        })),
      )
      if (error) {
        // Left out of `accepted` on purpose — the whole chunk stays pending.
        console.error('[email] tournament-complete batch failed:', error.message)
        continue
      }
      for (const r of chunk) accepted.add(r.to)
    } catch (e) {
      console.error('[email] tournament-complete batch threw:', e)
    }
  }
  return accepted
}

export async function sendChallengeReceivedEmail(opts: {
  to: string
  challengerUsername: string
  tournamentName: string
  tournamentFlagEmoji: string | null
  unsubscribeToken: string
}) {
  if (!canSend()) return
  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: `New challenge from ${opts.challengerUsername}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">You've been challenged.</h1>
        <p style="color:#6b6b6b;font-size:16px;margin-bottom:4px;"><strong style="color:#0d0d0d;">${opts.challengerUsername}</strong> challenged you for ${opts.tournamentFlagEmoji ? `${opts.tournamentFlagEmoji} ` : ''}${opts.tournamentName}.</p>
        <div style="margin-top:28px;">
          <a href="${BASE_URL}/challenges"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
            View challenge →
          </a>
        </div>
        ${unsubscribeFooter(opts.unsubscribeToken)}
      </div>`,
  })
}

export async function sendFriendRequestEmail(opts: {
  to: string
  fromUsername: string
  unsubscribeToken: string
}) {
  if (!canSend()) return
  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: `Friend request from ${opts.fromUsername}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">New friend request.</h1>
        <p style="color:#6b6b6b;font-size:16px;margin-bottom:4px;"><strong style="color:#0d0d0d;">${opts.fromUsername}</strong> wants to be your friend on Quiet Please.</p>
        <div style="margin-top:28px;">
          <a href="${BASE_URL}/friends"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
            View request →
          </a>
        </div>
        ${unsubscribeFooter(opts.unsubscribeToken)}
      </div>`,
  })
}

export async function sendFriendAcceptedEmail(opts: {
  to: string
  friendUsername: string
  unsubscribeToken: string
}) {
  if (!canSend()) return
  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: `${opts.friendUsername} accepted your request`,
    html: `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">You're now friends.</h1>
        <p style="color:#6b6b6b;font-size:16px;margin-bottom:4px;">You and <strong style="color:#0d0d0d;">${opts.friendUsername}</strong> are now friends on Quiet Please.</p>
        <div style="margin-top:28px;">
          <a href="${BASE_URL}/friends"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
            View friends →
          </a>
        </div>
        ${unsubscribeFooter(opts.unsubscribeToken)}
      </div>`,
  })
}

export async function sendAutoPredsEmail(opts: {
  to: string
  tournamentName: string
  tournamentId: string
  tournamentFlagEmoji: string | null
  picksCount: number
  unsubscribeToken: string
}) {
  if (!canSend()) return
  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: `Auto-picks made — ${opts.tournamentName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">Picks generated for you.</h1>
        <p style="color:#6b6b6b;font-size:16px;margin-bottom:4px;">${opts.tournamentFlagEmoji ? `${opts.tournamentFlagEmoji} ` : ''}${opts.tournamentName} — ${opts.picksCount} picks auto-generated.</p>
        <p style="font-size:14px;color:#6b6b6b;">Review and adjust them before the tournament starts.</p>
        <div style="margin-top:28px;">
          <a href="${BASE_URL}/tournaments/${opts.tournamentId}/predict"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
            Review your picks →
          </a>
        </div>
        ${unsubscribeFooter(opts.unsubscribeToken)}
      </div>`,
  })
}

export async function sendAchievementEarnedEmail(opts: {
  to: string
  achievementName: string
  achievementEmoji: string
  achievementDescription: string
  username: string
  unsubscribeToken: string
}) {
  if (!canSend()) return
  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: `${opts.achievementEmoji} Achievement unlocked — ${opts.achievementName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">${opts.achievementEmoji} Achievement unlocked.</h1>
        <p style="color:#0d0d0d;font-size:18px;margin-bottom:4px;"><strong>${opts.achievementName}</strong></p>
        <p style="color:#6b6b6b;font-size:14px;">${opts.achievementDescription}</p>
        <div style="margin-top:28px;">
          <a href="${BASE_URL}/profile/${opts.username}?tab=achievements"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
            View your achievements →
          </a>
        </div>
        ${unsubscribeFooter(opts.unsubscribeToken)}
      </div>`,
  })
}

// ── Shared helper: fetch user prefs + email, then send ──────────────────────
// Use this in server actions to avoid duplicating the prefs-fetch boilerplate.
// Fire-and-forget: errors are logged but never thrown.
export async function sendNotificationEmail<T extends { to: string; unsubscribeToken: string }>(
  userId: string,
  emailType: EmailPrefKey,
  emailFn: (opts: T) => Promise<void>,
  buildOpts: (email: string, unsubscribeToken: string) => T,
) {
  try {
    if (!canSend()) return
    const supabase = createAdminClient()
    const { data: prefs } = await supabase
      .from('users')
      .select('email_notifications, email_preferences, unsubscribe_token')
      .eq('id', userId)
      .single()
    if (!isEmailEnabled(prefs?.email_notifications, prefs?.email_preferences, emailType)) return
    const { data: { user } } = await supabase.auth.admin.getUserById(userId)
    if (!user?.email) return
    if (isBotEmail(user.email)) return
    await emailFn(buildOpts(user.email, prefs?.unsubscribe_token ?? ''))
  } catch (e) {
    console.error('[email] notification email error:', e)
  }
}

// ── Anonymous challenge result ──────────────────────────────────────────────

/**
 * Footer for mail to someone who has no account.
 *
 * The account footer is wrong here in both directions: it tells the reader they
 * received this "because you have an account on Quiet Please", which is untrue
 * and reads as spam, and it points at `users.unsubscribe_token`, which they do
 * not have. It also offers per-type preferences they cannot hold.
 *
 * The opt-out is a deletion rather than a suppression — this address was given
 * for exactly one message, so there is nothing left to suppress once it has
 * been sent, and keeping it would be holding data we have no use for. The send
 * itself erases the address, which is what the copy below states; the link is
 * still worth having because "we deleted it" is a claim, and a link that
 * confirms it is evidence. It is idempotent either way.
 */
function anonymousFooter(emailToken: string) {
  const url = `${BASE_URL}/api/unsubscribe/anonymous?token=${emailToken}`
  return `
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e8e3d8;">
      <p style="font-size:11px;color:#999;line-height:1.5;">
        You're getting this once because you asked to be told how your bracket
        finished. You don't have an account with us, and we deleted your address
        when we sent this — it was the only thing we collected it for.<br/>
        <a href="${url}" style="color:#999;text-decoration:underline;">Confirm removal</a>.
      </p>
    </div>`
}

export interface AnonymousChallengeResultEmail {
  to: string
  /** The recipient's own name, as they entered it. */
  yourName: string
  opponentName: string
  yourPoints: number
  opponentPoints: number
  tournamentName: string
  tournamentFlagEmoji: string | null
  shareCode: string
  emailToken: string
}

export async function sendAnonymousChallengeResultEmail(o: AnonymousChallengeResultEmail) {
  if (!canSend()) return

  const won = o.yourPoints > o.opponentPoints
  const tied = o.yourPoints === o.opponentPoints
  const flag = o.tournamentFlagEmoji ? `${o.tournamentFlagEmoji} ` : ''

  const subject = tied
    ? `Dead heat — you and ${o.opponentName} tied`
    : won
      ? `You beat ${o.opponentName} 🎾`
      : `${o.opponentName} beat you`

  const headline = tied ? 'A dead heat.' : won ? 'You won.' : `${o.opponentName} won.`

  // The account pitch is the point of this email, so it carries the reader back
  // to the bracket they already built rather than dropping them on a cold
  // signup form.
  const signupUrl = `${BASE_URL}/signup?next=${encodeURIComponent(`/c/${o.shareCode}`)}`

  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: o.to,
    subject,
    html: `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">${headline}</h1>
        <p style="color:#6b6b6b;font-size:16px;margin:0 0 24px;">${flag}${o.tournamentName} is over. Here's how your bracket finished.</p>

        <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e8e3d8;border-radius:2px;margin-bottom:28px;">
          <tr>
            <td style="padding:14px 16px;font-size:15px;color:#0d0d0d;">${o.yourName}</td>
            <td style="padding:14px 16px;font-size:15px;text-align:right;color:${won ? '#1a6b3c' : '#0d0d0d'};font-weight:bold;">${o.yourPoints}</td>
          </tr>
          <tr>
            <td style="padding:14px 16px;font-size:15px;color:#0d0d0d;border-top:1px solid #e8e3d8;">${o.opponentName}</td>
            <td style="padding:14px 16px;font-size:15px;text-align:right;color:${!won && !tied ? '#1a6b3c' : '#0d0d0d'};font-weight:bold;border-top:1px solid #e8e3d8;">${o.opponentPoints}</td>
          </tr>
        </table>

        <p style="color:#6b6b6b;font-size:15px;margin:0 0 20px;">
          That bracket disappears with your browser. With a free account they're
          all kept — points, a global ranking, leagues with friends, and every
          tournament of the season.
        </p>

        <div>
          <a href="${signupUrl}"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
            Create a free account →
          </a>
        </div>

        <p style="margin-top:20px;">
          <a href="${BASE_URL}/c/${o.shareCode}" style="color:#6b6b6b;font-size:14px;">See the full brackets →</a>
        </p>

        ${anonymousFooter(o.emailToken)}
      </div>`,
  })
}

export interface AnonymousBracketResultEmail {
  to: string
  /** The name on the bracket — generated ("Player 7986") when none was given. */
  name: string
  points: number
  correctPicks: number
  /** Matches that were actually decided, i.e. the denominator for `correctPicks`. */
  matchesScored: number
  tournamentName: string
  tournamentFlagEmoji: string | null
  shareCode: string
  emailToken: string
}

/**
 * The one email a signed-out solo bracket earns.
 *
 * Sibling of sendAnonymousChallengeResultEmail, and the reason the /play flow
 * asks for an address at all: without it, someone who filled in a bracket from
 * a social post and did well is never told, and the single best moment to earn
 * the account passes in silence.
 *
 * No opponent here, so there is no win/lose to lead with. The score itself is
 * the news, and the honest framing of a mid-tournament entry — you can only be
 * marked on the matches that have been played since — is carried in the
 * denominator rather than buried.
 */
export async function sendAnonymousBracketResultEmail(o: AnonymousBracketResultEmail) {
  if (!canSend()) return

  const flag = o.tournamentFlagEmoji ? `${o.tournamentFlagEmoji} ` : ''
  const scored = o.points > 0

  const subject = scored
    ? `Your ${o.tournamentName} bracket: ${o.points} points`
    : `How your ${o.tournamentName} bracket finished`

  const headline = scored ? `${o.points} points.` : 'That’s a wrap.'

  // Carries the reader back to the bracket they already built rather than
  // dropping them on a cold signup form — same reasoning as the challenge mail.
  const signupUrl = `${BASE_URL}/signup?next=${encodeURIComponent(`/b/${o.shareCode}`)}`

  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: o.to,
    subject,
    html: `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">${headline}</h1>
        <p style="color:#6b6b6b;font-size:16px;margin:0 0 24px;">${flag}${o.tournamentName} is over. Here's how your bracket finished.</p>

        <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e8e3d8;border-radius:2px;margin-bottom:28px;">
          <tr>
            <td style="padding:14px 16px;font-size:15px;color:#0d0d0d;">${o.name}</td>
            <td style="padding:14px 16px;font-size:15px;text-align:right;color:${scored ? '#1a6b3c' : '#0d0d0d'};font-weight:bold;">${o.points} pts</td>
          </tr>
          <tr>
            <td style="padding:14px 16px;font-size:15px;color:#6b6b6b;border-top:1px solid #e8e3d8;">Correct picks</td>
            <td style="padding:14px 16px;font-size:15px;text-align:right;color:#0d0d0d;border-top:1px solid #e8e3d8;">${o.correctPicks} of ${o.matchesScored}</td>
          </tr>
        </table>

        <p style="color:#6b6b6b;font-size:15px;margin:0 0 20px;">
          That bracket disappears with your browser. With a free account they're
          all kept — points, a global ranking, leagues with friends, and every
          tournament of the season.
        </p>

        <div>
          <a href="${signupUrl}"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
            Create a free account →
          </a>
        </div>

        <p style="margin-top:20px;">
          <a href="${BASE_URL}/b/${o.shareCode}" style="color:#6b6b6b;font-size:14px;">See your full bracket →</a>
        </p>

        ${anonymousFooter(o.emailToken)}
      </div>`,
  })
}
