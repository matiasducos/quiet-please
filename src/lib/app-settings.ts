import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

export type PredictionMode = 'anytime' | 'pre_tournament'

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
    return (data.value as PredictionMode) ?? 'anytime'
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
  return ['accepting_predictions', 'in_progress']
}

/**
 * Check if a tournament status allows predictions under the current mode.
 */
export async function canPredictForStatus(status: string): Promise<boolean> {
  const allowed = await getPredictableStatuses()
  return allowed.includes(status)
}
