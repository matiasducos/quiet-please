import { createAdminClient } from '@/lib/supabase/admin'
import { sendDrawOpenEmails, isBotEmail, type DrawOpenEmail } from '@/lib/email'
import { isEmailEnabled, type EmailPreferences } from '@/lib/email-preferences'

export interface DrawOpenTournament {
  id: string
  name: string
  location: string | null
  flagEmoji: string | null
  closeDate: string | null
}

export interface AnnounceResult {
  notified: number
  emailed: number
}

/** PostgREST caps a response at 1000 rows — page rather than trust one query. */
const USER_PAGE = 1000
/** Notification rows per insert. One 10k-row insert is a request-size problem. */
const NOTIF_CHUNK = 1000

/**
 * Announce that a tournament draw is open: an in-app notification for every
 * user, plus a draw-open email for everyone who hasn't opted out.
 *
 * Deliberately reads `public.users` instead of `listAllUsers()`. That helper
 * goes through GoTrue's admin API, which on this project fails outright above
 * ~30 per page (see src/lib/supabase/admin.ts) and would need one round trip
 * per 25 users besides. `public.users` already carries email, username,
 * preferences and unsubscribe_token, so the whole recipient list — including
 * the opt-out filter — resolves in the database.
 *
 * Never throws: a draw is already published by the time this runs, and failing
 * the admin action afterwards would imply the publish itself failed.
 */
export async function announceDrawOpen(t: DrawOpenTournament): Promise<AnnounceResult> {
  const result: AnnounceResult = { notified: 0, emailed: 0 }

  try {
    const admin = createAdminClient()

    const users: Array<{
      id: string
      username: string | null
      email: string | null
      email_notifications: boolean | null
      email_preferences: Partial<EmailPreferences> | null
      unsubscribe_token: string | null
    }> = []
    {
      let from = 0
      while (true) {
        const { data: page, error } = await admin
          .from('users')
          .select('id, username, email, email_notifications, email_preferences, unsubscribe_token')
          .order('id', { ascending: true })
          .range(from, from + USER_PAGE - 1)
        if (error) throw new Error(`users query failed: ${error.message}`)
        if (!page?.length) break
        users.push(...(page as typeof users))
        if (page.length < USER_PAGE) break
        from += USER_PAGE
      }
    }
    if (users.length === 0) return result

    // ── In-app notifications: everyone, bots included ────────────────────────
    // Bots are the QA accounts used to verify signed-in UI, so they need the
    // notification rows. They're filtered out of email below.
    const meta = {
      tournament_name: t.name,
      tournament_location: t.location ?? null,
      tournament_flag_emoji: t.flagEmoji ?? null,
    }
    const rows = users.map(u => ({
      user_id: u.id,
      type: 'draw_open',
      tournament_id: t.id,
      meta,
    }))
    for (let i = 0; i < rows.length; i += NOTIF_CHUNK) {
      const { error } = await admin.from('notifications').insert(rows.slice(i, i + NOTIF_CHUNK))
      if (error) {
        console.error('[announceDrawOpen] notification insert failed:', error.message)
        break
      }
      result.notified += Math.min(NOTIF_CHUNK, rows.length - i)
    }

    // ── Emails: opted-in humans only ─────────────────────────────────────────
    const recipients: DrawOpenEmail[] = []
    let missingToken = 0
    for (const u of users) {
      if (!u.email || isBotEmail(u.email)) continue
      if (!u.unsubscribe_token) {
        // Sending a bulk email with no working opt-out is worse than not
        // sending it. Counted rather than ignored so a backfill gap is visible.
        missingToken++
        continue
      }
      if (!isEmailEnabled(u.email_notifications, u.email_preferences, 'draw_open')) continue
      recipients.push({
        to: u.email,
        tournamentName: t.name,
        tournamentId: t.id,
        tournamentFlagEmoji: t.flagEmoji,
        closeDate: t.closeDate,
        unsubscribeToken: u.unsubscribe_token,
        username: u.username ?? undefined,
      })
    }
    result.emailed = await sendDrawOpenEmails(recipients)

    console.log(
      `[announceDrawOpen] ${t.name}: ${result.notified} notified, ` +
      `${result.emailed}/${recipients.length} emailed (${users.length} users scanned` +
      `${missingToken ? `, ${missingToken} skipped for missing unsubscribe_token` : ''})`,
    )
  } catch (e) {
    console.error('[announceDrawOpen] failed:', e)
  }

  return result
}
