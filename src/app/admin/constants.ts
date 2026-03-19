// Shared constants — no 'use server' directive so these are safely importable on the client.

export const NOTIFICATION_TYPES = [
  'draw_open',
  'points_awarded',
  'challenge_received',
  'friend_request',
  'friend_accepted',
  'friend_picks_locked',
] as const

export type NotificationType = typeof NOTIFICATION_TYPES[number]
