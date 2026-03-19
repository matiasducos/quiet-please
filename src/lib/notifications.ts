import { createAdminClient } from '@/lib/supabase/admin'

export interface NotificationRow {
  user_id: string
  type: string
  tournament_id?: string | null
  meta?: Record<string, unknown>
}

/**
 * Insert one or more notification rows for any user(s).
 * Uses the admin client so RLS never blocks cross-user inserts.
 * Always fire-and-forget — errors are logged but never thrown.
 */
export async function insertNotifications(rows: NotificationRow[]): Promise<void> {
  if (!rows.length) return
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('notifications').insert(rows)
    if (error) console.error('[notifications] insert error', error.message)
  } catch (err) {
    console.error('[notifications] unexpected error', err)
  }
}
