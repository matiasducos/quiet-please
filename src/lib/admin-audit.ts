import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminActor } from '@/app/admin/auth'

export type AdminAction = 'user.delete' | 'prediction.unlock'
export type AdminTargetType = 'user' | 'prediction'

/**
 * Record a destructive admin action in `admin_actions` (migration 071, widened
 * by 096).
 *
 * Both the `action` and `target_type` columns are CHECK-constrained in the
 * database, so a new value here needs a migration to match — the union types
 * above and those constraints have to be extended together.
 *
 * Never throws. These are written *after* the action has already succeeded, so
 * raising here would report a failure for work that actually completed and
 * cannot be undone. A lost audit row is reported to Sentry instead — loudly,
 * because a silent gap in an audit trail is worth a page.
 *
 * Both ids are stored without foreign keys and alongside a text label, because
 * the row they identify is usually gone by the time anyone reads this.
 */
export async function recordAdminAction(opts: {
  actor: AdminActor
  action: AdminAction
  targetType: AdminTargetType
  targetId: string
  /** Human-readable identity of the target, captured before it was deleted. */
  targetLabel: string
  meta?: Record<string, unknown>
}): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('admin_actions').insert({
      actor_id:     opts.actor.id,
      actor_label:  opts.actor.label,
      action:       opts.action,
      target_type:  opts.targetType,
      target_id:    opts.targetId,
      target_label: opts.targetLabel,
      meta:         opts.meta ?? {},
    })
    if (error) throw new Error(error.message)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `[admin-audit] FAILED to record ${opts.action} on ${opts.targetLabel} ` +
      `by ${opts.actor.label}: ${message}`,
    )
    Sentry.captureException(err, {
      extra: { action: opts.action, targetId: opts.targetId, targetLabel: opts.targetLabel },
    })
  }
}
