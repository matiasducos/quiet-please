import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendDrawOpenEmails,
  sendDrawReminderEmails,
  isBotEmail,
  type DrawOpenEmail,
  type DrawReminderEmail,
  type DrawReminderTournament,
  type DrawOpenTournamentInfo,
} from '@/lib/email'
import { isEmailEnabled, type EmailPreferences } from '@/lib/email-preferences'

export interface AnnounceResult {
  notified: number
}

export interface PendingDrawEmailResult {
  /** Tournaments the email covered. */
  sent: string[]
  /** Claimed but not mailed — picks had closed by the time the send ran. */
  skipped: string[]
  emailed: number
  /** Signed-out visitors who had asked to be told when one of these draws landed. */
  reminded: number
}

export interface PendingDrawAnnouncement {
  id: string
  name: string
  flagEmoji: string | null
}

/**
 * Statuses a draw-open email still makes sense for. Brackets stay editable
 * once play starts, so `in_progress` is still worth telling people about; a
 * completed tournament is not, and gets claimed and skipped instead.
 */
const EMAILABLE_STATUSES = ['accepting_predictions', 'in_progress']

const TOURNAMENT_COLUMNS =
  'id, name, location, flag_emoji, tour, category, surface, draw_size, starts_at, ends_at, draw_close_at, status'

interface TournamentRow {
  id: string
  name: string
  location: string | null
  flag_emoji: string | null
  tour: string | null
  category: string | null
  surface: string | null
  draw_size: number | null
  starts_at: string | null
  ends_at: string | null
  draw_close_at: string | null
  status: string
}

function toInfo(row: TournamentRow): DrawOpenTournamentInfo {
  return {
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
}

/** PostgREST caps a response at 1000 rows — page rather than trust one query. */
const USER_PAGE = 1000
/** Notification rows per insert. One 10k-row insert is a request-size problem. */
const NOTIF_CHUNK = 1000
/** Ids per erasure UPDATE — `.in()` builds a URL, and a URL has a length. */
const ERASE_CHUNK = 100

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
 * user. The EMAIL is not sent here — it is left pending for
 * `sendPendingDrawEmails()`, which covers every draw opened since the last send
 * in one message per user (migration 109). Same-week draws are entered minutes
 * apart in one admin session, and sending on each publish cost the whole user
 * base two emails where one would do — on Resend's free plan, most of a day's
 * quota.
 *
 * Runs at most once per tournament, guarded by `tournaments.draw_announced_at`
 * (migration 070). Callers therefore don't have to know whether a draw has been
 * published before: re-saving an open draw in the admin panel, or a sync-draws
 * pass over a tournament that is already accepting predictions, is a no-op.
 * Deliberately at-most-once rather than at-least-once — a bulk announcement
 * that goes out twice is a worse failure than one that needs re-arming by hand
 * (clear the column to re-announce).
 *
 * Deliberately reads `public.users` instead of `listAllUsers()`. That helper
 * goes through GoTrue's admin API, which on this project fails outright above
 * ~30 per page (see src/lib/supabase/admin.ts) and would need one round trip
 * per 25 users besides.
 *
 * Never throws: a draw is already published by the time this runs, and failing
 * the admin action afterwards would imply the publish itself failed.
 */
export async function announceDrawOpen(tournamentId: string): Promise<AnnounceResult> {
  const result: AnnounceResult = { notified: 0 }

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
      .select('id, name, location, flag_emoji')
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

    // ── In-app notifications: everyone, bots included ────────────────────────
    // Bots are the QA accounts used to verify signed-in UI, so they need the
    // notification rows. Only ids are needed, so the page stays narrow.
    const meta = {
      tournament_name: row.name,
      tournament_location: row.location ?? null,
      tournament_flag_emoji: row.flag_emoji ?? null,
    }
    let from = 0
    while (true) {
      const { data: page, error } = await admin
        .from('users')
        .select('id')
        .order('id', { ascending: true })
        .range(from, from + USER_PAGE - 1)
      if (error) throw new Error(`users query failed: ${error.message}`)
      if (!page?.length) break

      const rows = page.map(u => ({
        user_id: u.id,
        type: 'draw_open',
        tournament_id: row.id,
        meta,
      }))
      let failed = false
      for (let i = 0; i < rows.length; i += NOTIF_CHUNK) {
        const { error: insErr } = await admin.from('notifications').insert(rows.slice(i, i + NOTIF_CHUNK))
        if (insErr) {
          console.error('[announceDrawOpen] notification insert failed:', insErr.message)
          failed = true
          break
        }
        result.notified += Math.min(NOTIF_CHUNK, rows.length - i)
      }
      if (failed) break

      if (page.length < USER_PAGE) break
      from += USER_PAGE
    }

    console.log(`[announceDrawOpen] ${row.name}: ${result.notified} notified, email pending`)
  } catch (e) {
    console.error('[announceDrawOpen] failed:', e)
  }

  return result
}

/**
 * Draws that have been announced in-app but not yet emailed — what the admin
 * "Send email" banner lists. Pending rows are a handful at most, so no paging.
 */
export async function getPendingDrawAnnouncements(): Promise<PendingDrawAnnouncement[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tournaments')
    .select('id, name, flag_emoji')
    .not('draw_announced_at', 'is', null)
    .is('draw_emailed_at', null)
    .order('draw_announced_at', { ascending: true })
    .limit(50)
  if (error) {
    console.error('[getPendingDrawAnnouncements] failed:', error.message)
    return []
  }
  return (data ?? []).map(t => ({ id: t.id, name: t.name, flagEmoji: t.flag_emoji ?? null }))
}

/**
 * Send ONE draw-open email per user covering every draw announced since the
 * last send, plus the matching reminders to signed-out visitors who asked.
 *
 * Triggered by the admin "Send email" button after publishing, by sync-draws
 * at the end of a run, and — so a forgotten click still goes out — by the
 * daily expire-points cron.
 *
 * Claims every pending tournament in a single conditional UPDATE, so the
 * button and the cron can overlap safely: whichever runs second finds nothing
 * pending. Same at-most-once contract as the announcement itself — clear
 * `draw_emailed_at` to re-send.
 *
 * Never throws.
 */
export async function sendPendingDrawEmails(): Promise<PendingDrawEmailResult> {
  const result: PendingDrawEmailResult = { sent: [], skipped: [], emailed: 0, reminded: 0 }

  try {
    const admin = createAdminClient()

    const { data: claimed, error: claimErr } = await admin
      .from('tournaments')
      .update({ draw_emailed_at: new Date().toISOString() })
      .not('draw_announced_at', 'is', null)
      .is('draw_emailed_at', null)
      .select(TOURNAMENT_COLUMNS)
    if (claimErr) throw new Error(`pending claim failed: ${claimErr.message}`)
    if (!claimed?.length) return result

    // A draw left pending until after its tournament finished is claimed and
    // dropped rather than mailed: "the draw is open" would be false.
    const rows = (claimed as TournamentRow[])
      .filter(t => {
        if (EMAILABLE_STATUSES.includes(t.status)) return true
        result.skipped.push(t.name)
        return false
      })
      .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))
    if (rows.length === 0) {
      console.log(`[sendPendingDrawEmails] skipped ${result.skipped.join(', ')}: no longer open`)
      return result
    }
    const tournaments = rows.map(toInfo)
    result.sent = tournaments.map(t => t.name)

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
    // No early return on an empty user list. The reminder fan-out below serves
    // people who have no user row by definition.

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
        tournaments,
        rank: position
          ? { position, total: rankedTotal, points: u.ranking_points ?? 0 }
          : null,
      })
    }
    result.emailed = await sendDrawOpenEmails(recipients)

    // ── Reminders: signed-out visitors who asked for exactly this ────────────
    // Runs after the user fan-out so it can dedupe against the addresses that
    // have just been mailed — someone who left their address on the edition
    // page and later created an account with it must not get both.
    const mailedAddresses = new Set(recipients.map(r => r.to.toLowerCase()))
    result.reminded = await notifyDrawReminders(admin, tournaments, mailedAddresses)

    console.log(
      `[sendPendingDrawEmails] ${result.sent.join(', ')}: ` +
      `${result.emailed}/${recipients.length} emailed (${users.length} users scanned` +
      `${missingToken ? `, ${missingToken} skipped for missing unsubscribe_token` : ''})` +
      `, ${result.reminded} reminders sent` +
      `${result.skipped.length ? `, skipped ${result.skipped.join(', ')}` : ''}`,
    )
  } catch (e) {
    console.error('[sendPendingDrawEmails] failed:', e)
  }

  return result
}

// ── Draw reminders ───────────────────────────────────────────────────────────

interface ReminderRow {
  id: string
  tournament_id: string
  email: string
  email_token: string
}

/**
 * Mail everyone who left an address on one of these tournaments' pages while
 * the draw was still unpublished, then erase what they left. An address that
 * asked about two of them gets one email naming both.
 *
 * The erasure is the point, not an afterthought. The address was collected for
 * exactly one message and the page said so, so once that message is out there
 * is nothing left to hold — same contract as the anonymous bracket and
 * challenge addresses (see /api/unsubscribe/anonymous). The row survives with
 * `notified_at` set so the funnel stays countable without the data.
 *
 * Only addresses that Resend actually accepted are erased. A chunk that fails
 * keeps its rows intact and un-notified, which is what makes clearing
 * `draw_emailed_at` a working re-arm rather than a way to mail half the list
 * twice and the other half never.
 *
 * Never throws — it is the last thing an already-successful send does.
 */
async function notifyDrawReminders(
  admin: ReturnType<typeof createAdminClient>,
  tournaments: DrawOpenTournamentInfo[],
  alreadyMailed: Set<string>,
): Promise<number> {
  try {
    const ids = tournaments.map(t => t.id)

    // Paged for the same reason the user query is: PostgREST caps a response at
    // 1000 rows and returns the truncation as success. `ids` is the handful of
    // tournaments in this send, so the `.in()` stays far from the URL limit.
    const rows: ReminderRow[] = []
    let from = 0
    while (true) {
      const { data: page, error } = await admin
        .from('draw_reminders')
        .select('id, tournament_id, email, email_token')
        .in('tournament_id', ids)
        .not('email', 'is', null)
        .is('notified_at', null)
        .order('id', { ascending: true })
        .range(from, from + USER_PAGE - 1)
      if (error) {
        console.error('[sendPendingDrawEmails] reminder query failed:', error.message)
        return 0
      }
      if (!page?.length) break
      rows.push(...(page as ReminderRow[]))
      if (page.length < USER_PAGE) break
      from += USER_PAGE
    }
    if (rows.length === 0) return 0

    // The bracket CTA lands on /play/<series-slug>, which needs no account.
    const { data: seriesRows, error: seriesErr } = await admin
      .from('tournaments')
      .select('id, tournament_series(slug)')
      .in('id', ids)
    // Not fatal — the CTA falls back to /tournaments/<id> — but silence here
    // would look identical to a tournament that genuinely has no series.
    if (seriesErr) console.error('[sendPendingDrawEmails] series lookup failed:', seriesErr.message)
    const slugById = new Map<string, string | null>()
    for (const s of seriesRows ?? []) {
      const embedded = s.tournament_series as
        | { slug: string }
        | { slug: string }[]
        | null
        | undefined
      slugById.set(s.id, (Array.isArray(embedded) ? embedded[0]?.slug : embedded?.slug) ?? null)
    }
    const infoById = new Map(tournaments.map(t => [t.id, t]))

    const byAddress = new Map<string, ReminderRow[]>()
    for (const r of rows) {
      const address = r.email.toLowerCase()
      const group = byAddress.get(address)
      if (group) group.push(r)
      else byAddress.set(address, [r])
    }

    const recipients: DrawReminderEmail[] = []
    for (const [address, group] of byAddress) {
      // They have an account now and have already had the real draw-open mail.
      // The rows are still erased below — the promise was kept, just by the
      // other email — so this is a skip of the send, not of the cleanup.
      if (alreadyMailed.has(address)) continue
      // One card per tournament, even if the same address somehow has two rows
      // for it.
      const seen = new Set<string>()
      const items: DrawReminderTournament[] = []
      for (const r of group) {
        const tournament = infoById.get(r.tournament_id)
        if (!tournament || seen.has(r.tournament_id)) continue
        seen.add(r.tournament_id)
        items.push({ tournament, seriesSlug: slugById.get(r.tournament_id) ?? null })
      }
      if (items.length === 0) continue
      recipients.push({ to: group[0].email, tournaments: items, emailToken: group[0].email_token })
    }

    const accepted = await sendDrawReminderEmails(recipients)

    // Erase the address on every row whose message went out, plus every row
    // suppressed as a duplicate — the promise on those was kept by the
    // draw-open email, so holding the address any longer serves nothing.
    const acceptedAddresses = new Set(accepted.map(a => a.toLowerCase()))
    const doneIds = [...byAddress]
      .filter(([address]) => acceptedAddresses.has(address) || alreadyMailed.has(address))
      .flatMap(([, group]) => group.map(r => r.id))

    const now = new Date().toISOString()
    for (let i = 0; i < doneIds.length; i += ERASE_CHUNK) {
      const { error } = await admin
        .from('draw_reminders')
        .update({ email: null, notified_at: now })
        .in('id', doneIds.slice(i, i + ERASE_CHUNK))
      if (error) {
        // The mail is already out, so this is a data-retention failure, not a
        // delivery one. Loud, but not fatal to the send.
        console.error('[sendPendingDrawEmails] reminder erasure failed:', error.message)
        break
      }
    }

    return accepted.length
  } catch (e) {
    console.error('[sendPendingDrawEmails] reminder fan-out failed:', e)
    return 0
  }
}
