'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ── Auth guard ────────────────────────────────────────────────────────────────

async function assertAdmin() {
  if (process.env.NODE_ENV === 'development') return
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const adminIds = (process.env.ADMIN_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (!adminIds.includes(user.id)) throw new Error('Forbidden')
}

function getBaseUrl(): string {
  // In dev: localhost. In prod: use NEXT_PUBLIC_BASE_URL or VERCEL_URL.
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

// ── Cron trigger ──────────────────────────────────────────────────────────────

export async function triggerCron(key: string): Promise<{ ok: boolean; data: unknown }> {
  await assertAdmin()
  const cronSecret = process.env.CRON_SECRET
  const headers: Record<string, string> = cronSecret
    ? { Authorization: `Bearer ${cronSecret}` }
    : {}
  try {
    const res = await fetch(`${getBaseUrl()}/api/cron/${key}`, {
      headers,
      cache: 'no-store',
      // Give cron routes enough time; still bounded by the Vercel function limit.
      signal: AbortSignal.timeout(55_000),
    })
    const data = await res.json().catch(() => ({ error: 'Non-JSON response' }))
    return { ok: res.ok, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, data: { error: message } }
  }
}

// ── Tournament status override ────────────────────────────────────────────────

const VALID_STATUSES = ['upcoming', 'accepting_predictions', 'in_progress', 'completed'] as const
type ValidStatus = typeof VALID_STATUSES[number]

export async function setTournamentStatus(
  tournamentId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  if (!VALID_STATUSES.includes(status as ValidStatus)) {
    return { ok: false, error: `Invalid status "${status}"` }
  }
  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .update({ status })
    .eq('id', tournamentId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Tournament delete ─────────────────────────────────────────────────────────

export async function deleteTournament(
  tournamentId: string,
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()
  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .delete()
    .eq('id', tournamentId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Tournament details update ─────────────────────────────────────────────────

const VALID_SURFACES = ['hard', 'clay', 'grass'] as const

export async function updateTournamentDetails(
  tournamentId: string,
  fields: {
    surface?: string | null
    starts_at?: string | null
    ends_at?: string | null
    draw_close_at?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  await assertAdmin()

  const update: Record<string, unknown> = {}

  if ('surface' in fields) {
    const s = fields.surface
    if (s && !VALID_SURFACES.includes(s as typeof VALID_SURFACES[number])) {
      return { ok: false, error: `Invalid surface "${s}"` }
    }
    update.surface = s ?? null
  }
  if ('starts_at' in fields) {
    update.starts_at   = fields.starts_at ?? null
    // Keep denormalized starts_year in sync — used by the (external_id, starts_year) unique index
    update.starts_year = fields.starts_at ? new Date(fields.starts_at).getUTCFullYear() : null
  }
  if ('ends_at' in fields)       update.ends_at       = fields.ends_at       ?? null
  if ('draw_close_at' in fields) update.draw_close_at = fields.draw_close_at ?? null

  if (Object.keys(update).length === 0) return { ok: false, error: 'Nothing to update' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('tournaments')
    .update(update)
    .eq('id', tournamentId)
  return error ? { ok: false, error: error.message } : { ok: true }
}
