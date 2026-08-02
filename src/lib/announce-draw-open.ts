import { createAdminClient } from '@/lib/supabase/admin'
import { sendDrawOpenEmails, isBotEmail, type DrawOpenEmail, type DrawOpenTournamentInfo } from '@/lib/email'
import { isEmailEnabled, type EmailPreferences } from '@/lib/email-preferences'

export interface AnnounceResult {
  notified: number
  emailed: number
}

/** PostgREST caps a response at 1000 rows — page rather than trust one query. */
const USER_PAGE = 1000
/** Notification rows per insert. One 10k-row insert is a request-size problem. */
const NOTIF_CHUNK = 1000

interface UserRow {
  id: string
  username: string | null
  email: string | null
  ranking_points: number | null
  email_notifications: boolean | null
  email_preferences: Partial<EmailPreferences> | null
  unsubscribe_token: string | null
}

/**
 * Standard competition ranking over a points-descending list: equal points get
 * equal rank, and the next distinct value skips ahead. This matches what
 * /leaderboard shows, which computes rank as count(points > mine) + 1 — if the
 * two disagreed, the email would contradict the page it links to.
 */
function rankByUser(users: UserRow[]): Map<string, number> {
  const ranked = users
    .filter(u => u.username && (u.ranking_points ?? 0) > 0)
    .sort((a, b) => (b.ranking_points ?? 0) - (a.ranking_points ?? 0))

  const out = new Map<string, number>()
  let lastPoints: number | null = null
  let lastRank = 0
  ranked.forEach((u, i) => {
    const pts = u.ranking_points ?? 0
    if (pts !== lastPoints) {
      lastRank = i + 1
      lastPoints = pts
    }
    out.set(u.id, lastRank)
  })
  return out
}

/**
 * Announce that a tournament draw is open: an in-app notification for every
 * user, plus a draw-open email for everyone who hasn't opted out.
 *
 * Sends at most once per tournament, guarded by `tournaments.draw_announced_at`
 * (migration 070). Callers therefore don't have to know whether a draw has been
 * published before: re-saving an open draw in the admin panel, or a sync-draws
 * pass over a tournament that is already accepting predictions, is a no-op.
 * Deliberately at-most-once rather than at-least-once — a bulk mail that goes
 * out twice is a worse failure than one that needs re-arming by hand (clear the
 * column to re-announce).
 *
 * Takes only the tournament id and reads the row itself, so every caller sends
 * an identical email — three callers each passing their own subset of columns
 * is how the "picks close" line silently went missing from one path before.
 *
 * Deliberately reads `public.users` instead of `listAllUsers()`. That helper
 * goes through GoTrue's admin API, which on this project fails outright above
 * ~30 per page (see src/lib/supabase/admin.ts) and would need one round trip
 * per 25 users besides. `public.users` already carries email, username,
 * preferences, ranking points and unsubscribe_token, so the recipient list —
 * opt-out filter and per-user standing included — resolves in one paged query.
 *
 * Never throws: a draw is already published by the time this runs, and failing
 * the admin action afterwards would imply the publish itself failed.
 */
export async function announceDrawOpen(tournamentId: string): Promise<AnnounceResult> {
  const result: AnnounceResult = { notified: 0, emailed: 0 }

  try {
    const admin = createAdminClient()

    // Claim the announcement before doing any work. This is a conditional
    // UPDATE rather than a read-then-write check because two publish paths can
    // overlap — an admin re-saving a draw while sync-draws runs, say — and
    // Postgres settling it by row lock is the only way exactly one of them
    // wins. It doubles as the tournament read: PostgREST returns the updated
    // row, so the guard costs no extra round trip.
    const { data: row, error: tErr } = await admin
      .from('tournaments')
      .update({ draw_announced_at: new Date().toISOString() })
      .eq('id', tournamentId)
      .is('draw_announced_at', null)
      .select('id, name, location, flag_emoji, tour, category, surface, draw_size, starts_at, ends_at, draw_close_at')
      .maybeSingle()
    if (tErr) throw new Error(`tournament claim failed: ${tErr.message}`)
    if (!row) {
      // No row means the claim lost: either this draw was already announced or
      // the id is wrong. Worth one extra query to say which, since this path
      // now runs on every re-save of a live draw and a vague log would read
      // like a failure.
      const { data: existing } = await admin
        .from('tournaments')
        .select('name, draw_announced_at')
        .eq('id', tournamentId)
        .maybeSingle()
      console.log(
        existing
          ? `[announceDrawOpen] "${existing.name}": already announced at ${existing.draw_announced_at}, skipping`
          : `[announceDrawOpen] tournament ${tournamentId} not found, skipping`,
      )
      return result
    }

    const tournament: DrawOpenTournamentInfo = {
      id: row.id,
      name: row.name,
      location: row.location ?? null,
      flagEmoji: row.flag_emoji ?? null,
      tour: row.tour ?? null,
      category: row.category ?? null,
      surface: row.surface ?? null,
      drawSize: row.draw_size ?? null,
      startsAt: row.starts_at ?? null,
      endsAt: row.ends_at ?? null,
      closeDate: row.draw_close_at ?? null,
    }

    const users: UserRow[] = []
    {
      let from = 0
      while (true) {
        const { data: page, error } = await admin
          .from('users')
          .select('id, username, email, ranking_points, email_notifications, email_preferences, unsubscribe_token')
          .order('id', { ascending: true })
          .range(from, from + USER_PAGE - 1)
        if (error) throw new Error(`users query failed: ${error.message}`)
        if (!page?.length) break
        users.push(...(page as UserRow[]))
        if (page.length < USER_PAGE) break
        from += USER_PAGE
      }
    }
    if (users.length === 0) return result

    // ── In-app notifications: everyone, bots included ────────────────────────
    // Bots are the QA accounts used to verify signed-in UI, so they need the
    // notification rows. They're filtered out of email below.
    const meta = {
      tournament_name: tournament.name,
      tournament_location: tournament.location,
      tournament_flag_emoji: tournament.flagEmoji,
    }
    const rows = users.map(u => ({
      user_id: u.id,
      type: 'draw_open',
      tournament_id: tournament.id,
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
    // Ranks come from the rows already in memory — no per-recipient query.
    const ranks = rankByUser(users)
    const rankedTotal = users.filter(u => u.username).length

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

      const position = ranks.get(u.id)
      recipients.push({
        to: u.email,
        unsubscribeToken: u.unsubscribe_token,
        username: u.username ?? undefined,
        tournament,
        rank: position
          ? { position, total: rankedTotal, points: u.ranking_points ?? 0 }
          : null,
      })
    }
    result.emailed = await sendDrawOpenEmails(recipients)

    console.log(
      `[announceDrawOpen] ${tournament.name}: ${result.notified} notified, ` +
      `${result.emailed}/${recipients.length} emailed (${users.length} users scanned` +
      `${missingToken ? `, ${missingToken} skipped for missing unsubscribe_token` : ''})`,
    )
  } catch (e) {
    console.error('[announceDrawOpen] failed:', e)
  }

  return result
}
