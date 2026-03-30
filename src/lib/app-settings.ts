import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

export type PredictionMode = 'anytime' | 'pre_tournament' | 'manual_lock'

/**
 * Cached read of the prediction mode setting.
 * - Revalidates every 60 s automatically (ISR-style)
 * - Instantly bust via revalidateTag('app-settings') from admin actions
 */
export const getPredictionMode = unstable_cache(
  async (): Promise<PredictionMode> => {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'prediction_mode')
      .single()

    if (error || !data) return 'anytime' // safe default
    const raw = String(data.value)
    if (raw.includes('pre_tournament')) return 'pre_tournament'
    if (raw.includes('manual_lock')) return 'manual_lock'
    return 'anytime'
  },
  ['prediction-mode'],
  { revalidate: 60, tags: ['app-settings'] }
)

/**
 * Returns the set of tournament statuses that allow predictions
 * based on the current prediction mode.
 */
export async function getPredictableStatuses(): Promise<string[]> {
  const mode = await getPredictionMode()
  if (mode === 'pre_tournament') return ['accepting_predictions']
  // Both 'anytime' and 'manual_lock' allow in_progress (manual_lock adds per-match checks separately)
  return ['accepting_predictions', 'in_progress']
}

/**
 * Check if a tournament status allows predictions under the current mode.
 */
export async function canPredictForStatus(status: string): Promise<boolean> {
  const allowed = await getPredictableStatuses()
  return allowed.includes(status)
}

/**
 * Check if the current prediction mode is manual_lock.
 * Used to determine whether per-match admin lock checks should be enforced.
 */
export async function isManualLockMode(): Promise<boolean> {
  const mode = await getPredictionMode()
  return mode === 'manual_lock'
}
