import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'

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

function unsubscribeFooter(unsubscribeToken: string) {
  const url = `${BASE_URL}/api/unsubscribe?token=${unsubscribeToken}`
  return `
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e8e3d8;">
      <p style="font-size:11px;color:#999;line-height:1.5;">
        You received this email because you have an account on Quiet Please.<br/>
        <a href="${url}" style="color:#999;text-decoration:underline;">Unsubscribe</a> from all email notifications.
      </p>
    </div>`
}

export async function sendDrawOpenEmail(opts: {
  to: string
  tournamentName: string
  tournamentId: string
  closeDate: string | null
  unsubscribeToken: string
}) {
  if (!canSend()) return
  const closeLine = opts.closeDate
    ? `<p style="color:#6b6b6b;font-size:14px;">Picks close on <strong>${new Date(opts.closeDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>.</p>`
    : ''
  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: `Draw open: ${opts.tournamentName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">The draw is open.</h1>
        <p style="color:#6b6b6b;font-size:16px;margin-bottom:8px;">${opts.tournamentName}</p>
        ${closeLine}
        <div style="margin-top:28px;">
          <a href="${BASE_URL}/tournaments/${opts.tournamentId}"
             style="display:inline-block;background:#1a6b3c;color:white;text-decoration:none;padding:12px 24px;font-size:14px;border-radius:2px;">
            Make your picks →
          </a>
        </div>
        ${unsubscribeFooter(opts.unsubscribeToken)}
      </div>`,
  })
}

export async function sendPointsAwardedEmail(opts: {
  to: string
  tournamentName: string
  tournamentId: string
  points: number
  totalPoints: number
  unsubscribeToken: string
}) {
  if (!canSend()) return
  await resend!.emails.send({
    from: FROM,
    replyTo: REPLY_TO,
    to: opts.to,
    subject: `+${opts.points} pts — ${opts.tournamentName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#f5f2eb;">
        <p style="font-size:12px;letter-spacing:0.08em;color:#6b6b6b;text-transform:uppercase;margin-bottom:24px;">Quiet Please</p>
        <h1 style="font-size:28px;letter-spacing:-0.02em;margin:0 0 12px;">+${opts.points} points earned.</h1>
        <p style="color:#6b6b6b;font-size:16px;margin-bottom:4px;">${opts.tournamentName}</p>
        <p style="font-size:14px;color:#6b6b6b;">Your total: <strong style="color:#0d0d0d;">${opts.totalPoints} pts</strong></p>
        <div style="margin-top:28px;">
          <a href="${BASE_URL}/tournaments/${opts.tournamentId}/picks"
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
        <p style="color:#6b6b6b;font-size:16px;margin-bottom:4px;"><strong style="color:#0d0d0d;">${opts.challengerUsername}</strong> challenged you for ${opts.tournamentName}.</p>
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
        <p style="color:#6b6b6b;font-size:16px;margin-bottom:4px;">${opts.tournamentName} — ${opts.picksCount} picks auto-generated.</p>
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

// ── Shared helper: fetch user prefs + email, then send ──────────────────────
// Use this in server actions to avoid duplicating the prefs-fetch boilerplate.
// Fire-and-forget: errors are logged but never thrown.
export async function sendNotificationEmail<T extends { to: string; unsubscribeToken: string }>(
  userId: string,
  emailFn: (opts: T) => Promise<void>,
  buildOpts: (email: string, unsubscribeToken: string) => T,
) {
  try {
    if (!canSend()) return
    const supabase = createAdminClient()
    const { data: prefs } = await supabase
      .from('users')
      .select('email_notifications, unsubscribe_token')
      .eq('id', userId)
      .single()
    if (prefs?.email_notifications === false) return
    const { data: { user } } = await supabase.auth.admin.getUserById(userId)
    if (!user?.email) return
    if (isBotEmail(user.email)) return
    await emailFn(buildOpts(user.email, prefs?.unsubscribe_token ?? ''))
  } catch (e) {
    console.error('[email] notification email error:', e)
  }
}
