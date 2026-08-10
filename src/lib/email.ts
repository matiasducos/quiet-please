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

export interface PointsAwardedTournament {
  tournamentId: string
  tournamentName: string
  flagEmoji: string | null
  points: number
  rank: PointsAwardedRank | null
  rounds: PointsAwardedRoundBreakdown[]
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
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 24px;border-top:1px solid #e8e3d8;">
        ${roundRows}
      </table>`
}

export async function sendPointsAwardedEmail(opts: {
  to: string
  totalPoints: number
  correctPicks: number
  tournaments: PointsAwardedTournament[]
  unsubscribeToken: string
}) {
  if (!canSend()) return
  const single = opts.tournaments.length === 1
  const subject = single
    ? `+${opts.totalPoints} pts — ${opts.tournaments[0].tournamentName}`
    : `+${opts.totalPoints} pts across ${opts.tournaments.length} tournaments`
  const subLine = single
    ? `${opts.correctPicks} correct pick${opts.correctPicks === 1 ? '' : 's'}`
    : `Across ${opts.tournaments.length} tournaments · ${opts.correctPicks} correct pick${opts.correctPicks === 1 ? '' : 's'}`
  // Deep-link to the single tournament when there's only one; otherwise send
  // users to their dashboard where all affected tournaments are visible.
  const ctaHref = single
    ? `${BASE_URL}/tournaments/${opts.tournaments[0].tournamentId}`
    : `${BASE_URL}/dashboard`

  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject,
    html: `
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
      </div>`,
  })
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
