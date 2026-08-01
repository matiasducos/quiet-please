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

export interface DrawOpenEmail {
  to: string
  tournamentName: string
  tournamentId: string
  tournamentFlagEmoji: string | null
  closeDate: string | null
  unsubscribeToken: string
  /** Used to deep-link the recipient's own Email preferences panel. */
  username?: string
}

function drawOpenSubject(o: DrawOpenEmail) {
  return `Draw open: ${o.tournamentName}`
}

function drawOpenHtml(o: DrawOpenEmail) {
  const closeLine = o.closeDate
    ? `<p style="color:#6b6b6b;font-size:14px;">Picks close on <strong>${new Date(o.closeDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>.</p>`
    : ''
  const prefsHref = o.username ? `${BASE_URL}/profile/${encodeURIComponent(o.username)}#email-preferences` : undefined
  return `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">The draw is open.</h1>
        <p style="color:#6b6b6b;font-size:16px;margin-bottom:8px;">${o.tournamentFlagEmoji ? `${o.tournamentFlagEmoji} ` : ''}${o.tournamentName}</p>
        ${closeLine}
        <div style="margin-top:28px;">
          <a href="${BASE_URL}/tournaments/${o.tournamentId}"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
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
