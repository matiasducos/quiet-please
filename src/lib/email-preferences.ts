export const EMAIL_PREF_KEYS = [
  'draw_open',
  'points_awarded',
  'friend_request',
  'friend_accepted',
  'challenge_received',
  'auto_predictions',
  'achievement_earned',
] as const

export type EmailPrefKey = (typeof EMAIL_PREF_KEYS)[number]

export type EmailPreferences = Record<EmailPrefKey, boolean>

export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  draw_open: true,
  points_awarded: true,
  friend_request: true,
  friend_accepted: true,
  challenge_received: true,
  auto_predictions: true,
  achievement_earned: true,
}

/** Labels for the profile UI */
export const EMAIL_PREF_LABELS: Record<EmailPrefKey, { label: string; description: string }> = {
  draw_open:          { label: 'Draw open',        description: 'When a tournament draw opens for predictions' },
  points_awarded:     { label: 'Points awarded',   description: 'When you earn points from completed matches' },
  friend_request:     { label: 'Friend requests',  description: 'When someone sends you a friend request' },
  friend_accepted:    { label: 'Friend accepted',  description: 'When someone accepts your friend request' },
  challenge_received: { label: 'Challenges',        description: 'When someone challenges you' },
  auto_predictions:   { label: 'Auto-predictions', description: 'When auto-predictions are made on your behalf' },
  achievement_earned: { label: 'Achievements',     description: 'When you earn a new achievement' },
}

/**
 * Merge stored prefs (possibly partial/null) with defaults.
 * Returns a complete EmailPreferences object.
 */
export function resolvePreferences(stored: Partial<EmailPreferences> | null | undefined): EmailPreferences {
  return { ...DEFAULT_EMAIL_PREFERENCES, ...stored }
}

/**
 * Check if a specific email type is enabled, considering both the master toggle
 * and the individual preference.
 */
export function isEmailEnabled(
  masterEnabled: boolean | null | undefined,
  storedPrefs: Partial<EmailPreferences> | null | undefined,
  key: EmailPrefKey,
): boolean {
  if (masterEnabled === false) return false
  const prefs = resolvePreferences(storedPrefs)
  return prefs[key]
}
