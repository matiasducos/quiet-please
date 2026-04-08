/**
 * Achievement definitions — the single source of truth for all 25 achievements.
 * UI components import this directly; nothing is stored in the DB except
 * which users earned which keys and when.
 */

export type AchievementCategory =
  | 'tournament_trophy'
  | 'prediction_milestone'
  | 'accuracy_streak'
  | 'points_milestone'
  | 'social'
  | 'engagement'

export interface AchievementDefinition {
  key: string
  name: string
  description: string
  emoji: string
  category: AchievementCategory
  /** Gold/silver/bronze — only for tournament trophies */
  tier?: 'gold' | 'silver' | 'bronze'
  /** Tournament trophies are repeatable (once per tournament) */
  repeatable: boolean
}

// ── Tournament Trophies ─────────────────────────────────────────
const TOURNAMENT_TROPHIES: AchievementDefinition[] = [
  {
    key: 'tournament_champion',
    name: 'Tournament Champion',
    description: '1st place on a tournament leaderboard',
    emoji: '🏆',
    category: 'tournament_trophy',
    tier: 'gold',
    repeatable: true,
  },
  {
    key: 'runner_up',
    name: 'Runner-Up',
    description: '2nd place on a tournament leaderboard',
    emoji: '🥈',
    category: 'tournament_trophy',
    tier: 'silver',
    repeatable: true,
  },
  {
    key: 'on_the_podium',
    name: 'On the Podium',
    description: '3rd place on a tournament leaderboard',
    emoji: '🥉',
    category: 'tournament_trophy',
    tier: 'bronze',
    repeatable: true,
  },
]

// ── Prediction Milestones ───────────────────────────────────────
const PREDICTION_MILESTONES: AchievementDefinition[] = [
  {
    key: 'first_pick',
    name: 'First Pick',
    description: 'Made your first tournament prediction',
    emoji: '🎾',
    category: 'prediction_milestone',
    repeatable: false,
  },
  {
    key: 'getting_started',
    name: 'Getting Started',
    description: 'Completed 5 tournament predictions',
    emoji: '📋',
    category: 'prediction_milestone',
    repeatable: false,
  },
  {
    key: 'committed',
    name: 'Committed',
    description: 'Completed 10 tournament predictions',
    emoji: '💪',
    category: 'prediction_milestone',
    repeatable: false,
  },
  {
    key: 'veteran',
    name: 'Veteran',
    description: 'Completed 25 tournament predictions',
    emoji: '🎖️',
    category: 'prediction_milestone',
    repeatable: false,
  },
  {
    key: 'dedicated',
    name: 'Dedicated',
    description: 'Completed 50 tournament predictions',
    emoji: '💯',
    category: 'prediction_milestone',
    repeatable: false,
  },
  {
    key: 'centurion',
    name: 'Centurion',
    description: 'Completed 100 tournament predictions',
    emoji: '🏛️',
    category: 'prediction_milestone',
    repeatable: false,
  },
]

// ── Accuracy & Streaks ──────────────────────────────────────────
const ACCURACY_STREAKS: AchievementDefinition[] = [
  {
    key: 'sharp_eye',
    name: 'Sharp Eye',
    description: '5 correct picks in a single tournament',
    emoji: '👁️',
    category: 'accuracy_streak',
    repeatable: false,
  },
  {
    key: 'on_fire',
    name: 'On Fire',
    description: '15 correct picks in a single tournament',
    emoji: '🔥',
    category: 'accuracy_streak',
    repeatable: false,
  },
  {
    key: 'crystal_ball',
    name: 'Crystal Ball',
    description: '25+ correct picks in a single tournament',
    emoji: '🔮',
    category: 'accuracy_streak',
    repeatable: false,
  },
  {
    key: 'hot_streak',
    name: 'Hot Streak',
    description: 'Achieved a 3× streak multiplier',
    emoji: '⚡',
    category: 'accuracy_streak',
    repeatable: false,
  },
  {
    key: 'unstoppable',
    name: 'Unstoppable',
    description: 'Achieved a 7× streak multiplier',
    emoji: '🌊',
    category: 'accuracy_streak',
    repeatable: false,
  },
]

// ── Points Milestones ───────────────────────────────────────────
const POINTS_MILESTONES: AchievementDefinition[] = [
  {
    key: 'first_points',
    name: 'First Points',
    description: 'Earned points for the first time',
    emoji: '⭐',
    category: 'points_milestone',
    repeatable: false,
  },
  {
    key: 'century_club',
    name: 'Century Club',
    description: '250+ points in a single tournament',
    emoji: '💎',
    category: 'points_milestone',
    repeatable: false,
  },
  {
    key: 'high_roller',
    name: 'High Roller',
    description: '1000+ points in a single tournament',
    emoji: '🚀',
    category: 'points_milestone',
    repeatable: false,
  },
  {
    key: 'grand_master',
    name: 'Grand Master',
    description: '2500+ points in a single tournament',
    emoji: '👑',
    category: 'points_milestone',
    repeatable: false,
  },
]

// ── Social ──────────────────────────────────────────────────────
const SOCIAL: AchievementDefinition[] = [
  {
    key: 'social_starter',
    name: 'Social Starter',
    description: 'Added your first friend',
    emoji: '🤝',
    category: 'social',
    repeatable: false,
  },
  {
    key: 'squad_up',
    name: 'Squad Up',
    description: 'Have 10 friends',
    emoji: '👥',
    category: 'social',
    repeatable: false,
  },
  {
    key: 'challenger',
    name: 'Challenger',
    description: 'Created your first challenge',
    emoji: '⚔️',
    category: 'social',
    repeatable: false,
  },
  {
    key: 'rival',
    name: 'Rival',
    description: 'Completed 5 challenges against the same opponent',
    emoji: '🏴',
    category: 'social',
    repeatable: false,
  },
]

// ── Engagement ──────────────────────────────────────────────────
const ENGAGEMENT: AchievementDefinition[] = [
  {
    key: 'globe_trotter',
    name: 'Globe Trotter',
    description: 'Predicted on both ATP and WTA tournaments',
    emoji: '🌍',
    category: 'engagement',
    repeatable: false,
  },
  {
    key: 'surface_master',
    name: 'Surface Master',
    description: 'Predicted on all 3 surfaces (Clay, Grass, Hard)',
    emoji: '🎾',
    category: 'engagement',
    repeatable: false,
  },
  {
    key: 'season_pass',
    name: 'Season Pass',
    description: 'Made predictions in 4 different calendar months',
    emoji: '📅',
    category: 'engagement',
    repeatable: false,
  },
  {
    key: 'early_bird',
    name: 'Early Bird',
    description: 'Submitted picks within 1 hour of draw opening',
    emoji: '🐦',
    category: 'engagement',
    repeatable: false,
  },
]

// ── Exports ─────────────────────────────────────────────────────

/** All 25 achievements as an ordered array */
export const ALL_ACHIEVEMENTS: AchievementDefinition[] = [
  ...TOURNAMENT_TROPHIES,
  ...PREDICTION_MILESTONES,
  ...ACCURACY_STREAKS,
  ...POINTS_MILESTONES,
  ...SOCIAL,
  ...ENGAGEMENT,
]

/** Lookup by key */
export const ACHIEVEMENTS: Record<string, AchievementDefinition> = Object.fromEntries(
  ALL_ACHIEVEMENTS.map(a => [a.key, a])
)

/** Grouped by category for UI rendering */
export const ACHIEVEMENT_GROUPS: { label: string; emoji: string; category: AchievementCategory; items: AchievementDefinition[] }[] = [
  { label: 'Tournament Trophies', emoji: '🏆', category: 'tournament_trophy', items: TOURNAMENT_TROPHIES },
  { label: 'Prediction Milestones', emoji: '🎯', category: 'prediction_milestone', items: PREDICTION_MILESTONES },
  { label: 'Accuracy & Streaks', emoji: '🔥', category: 'accuracy_streak', items: ACCURACY_STREAKS },
  { label: 'Points Milestones', emoji: '💎', category: 'points_milestone', items: POINTS_MILESTONES },
  { label: 'Social', emoji: '🤝', category: 'social', items: SOCIAL },
  { label: 'Engagement', emoji: '🌍', category: 'engagement', items: ENGAGEMENT },
]

/** Category → color mapping for UI */
export const CATEGORY_COLORS: Record<AchievementCategory, { color: string; bg: string; border: string; glow: string }> = {
  tournament_trophy: { color: '#D4A017', bg: '#FFF8E7', border: '#F0D68A', glow: 'rgba(212,160,23,0.15)' },
  prediction_milestone: { color: '#185FA5', bg: '#EEF4FF', border: '#B8D4F0', glow: 'rgba(24,95,165,0.12)' },
  accuracy_streak: { color: '#c8530a', bg: '#FFF5EE', border: '#F0C8A0', glow: 'rgba(200,83,10,0.12)' },
  points_milestone: { color: '#7c2d7c', bg: '#F9F0F9', border: '#DDB8DD', glow: 'rgba(124,45,124,0.12)' },
  social: { color: '#1a6b3c', bg: '#EDF7F0', border: '#B8DABB', glow: 'rgba(26,107,60,0.12)' },
  engagement: { color: '#993556', bg: '#FDF0F4', border: '#E0B0C0', glow: 'rgba(153,53,86,0.12)' },
}
