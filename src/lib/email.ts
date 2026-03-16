import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM = process.env.EMAIL_FROM ?? 'Quiet Please <notifications@quiet-please.app>'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://quiet-please.app'

// No-op in dev / when key is missing
function canSend() {
  if (!resend) {
    console.log('[email] RESEND_API_KEY not set — skipping email')
    return false
  }
  return true
}

export async function sendDrawOpenEmail(opts: {
  to: string
  tournamentName: string
  tournamentId: string
  closeDate: string | null
}) {
  if (!canSend()) return
  const closeLine = opts.closeDate
    ? `<p style="color:#6b6b6b;font-size:14px;">Picks close on <strong>${new Date(opts.closeDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>.</p>`
    : ''
  await resend!.emails.send({
    from: FROM,
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
      </div>`,
  })
}

export async function sendPointsAwardedEmail(opts: {
  to: string
  tournamentName: string
  tournamentId: string
  points: number
  totalPoints: number
}) {
  if (!canSend()) return
  await resend!.emails.send({
    from: FROM,
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
      </div>`,
  })
}
