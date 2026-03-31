import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

export type PredictionMode = 'anytime' | 'pre_tournament' | 'manual_lock' | 'realtime'

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
    if (raw.includes('realtime')) return 'realtime'
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
  // 'anytime', 'manual_lock', and 'realtime' all allow in_progress
  // (manual_lock and realtime add per-match checks separately)
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
 * Check if per-match lock enforcement is active.
 * Returns true for both manual_lock (admin clicks) and realtime (DSG auto-lock).
 *
 * All 6 lock enforcement points in the app call this function:
 *   1. tournaments/[id]/predict/actions.ts → savePrediction()
 *   2. c/actions.ts → createAnonymousChallenge()
 *   3. c/actions.ts → submitOpponentPicks()
 *   4. tournaments/[id]/predict/page.tsx → page gate
 *   5. api/cron/auto-predict/route.ts → lock stripping
 *   6. BracketPredictor.tsx → reads adminLockedMatches prop (from page.tsx)
 */
export async function isPerMatchLockMode(): Promise<boolean> {
  const mode = await getPredictionMode()
  return mode === 'manual_lock' || mode === 'realtime'
}

/**
 * Backward-compatible alias — existing callers use `isManualLockMode()`.
 * This alias ensures all 6 enforcement points get realtime mode support
 * with zero code changes to those files.
 */
export const isManualLockMode = isPerMatchLockMode
