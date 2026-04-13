import Link from 'next/link'
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_GROUPS,
  CATEGORY_COLORS,
  type AchievementDefinition,
} from '@/lib/achievements/definitions'

interface UserAchievement {
  achievement_key: string
  tournament_id: string | null
  meta: Record<string, any>
  earned_at: string
}

interface Props {
  achievements: UserAchievement[]
  isOwnProfile: boolean
  username: string
}

export default function AchievementsTab({ achievements, isOwnProfile, username }: Props) {
  const earnedKeys = new Set(achievements.map(a => a.achievement_key))

  // Tournament trophies grouped by tier
  const trophyAchievements = achievements
    .filter(a => ['tournament_champion', 'runner_up', 'on_the_podium'].includes(a.achievement_key))
    .sort((a, b) => {
      // Gold first, then silver, then bronze; within tier, newest first
      const tierOrder = { tournament_champion: 0, runner_up: 1, on_the_podium: 2 }
      const aDef = tierOrder[a.achievement_key as keyof typeof tierOrder] ?? 3
      const bDef = tierOrder[b.achievement_key as keyof typeof tierOrder] ?? 3
      if (aDef !== bDef) return aDef - bDef
      return new Date(b.earned_at).getTime() - new Date(a.earned_at).getTime()
    })

  // Perfect Prediction — repeatable special achievement, rendered as its own section
  const perfectPredictions = achievements
    .filter(a => a.achievement_key === 'perfect_prediction')
    .sort((a, b) => new Date(b.earned_at).getTime() - new Date(a.earned_at).getTime())

  const goldCount = trophyAchievements.filter(a => a.achievement_key === 'tournament_champion').length
  const silverCount = trophyAchievements.filter(a => a.achievement_key === 'runner_up').length
  const bronzeCount = trophyAchievements.filter(a => a.achievement_key === 'on_the_podium').length
  const perfectCount = perfectPredictions.length
  const totalCount = achievements.length

  // Non-trophy achievement groups — hide perfect_prediction from the accuracy grid
  const nonTrophyGroups = ACHIEVEMENT_GROUPS
    .filter(g => g.category !== 'tournament_trophy')
    .map(g => ({
      ...g,
      items: g.items.filter(item => item.key !== 'perfect_prediction'),
    }))

  return (
    <>
      {/* Empty-state banner for fresh profiles — still render the full catalog below */}
      {totalCount === 0 && (
        <div
          className="text-center px-6 py-8 rounded-sm border bg-white mb-8"
          style={{ borderColor: 'var(--chalk-dim)', borderStyle: 'dashed' }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '12px', opacity: 0.4 }}>🏆</div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '6px' }}>
            No achievements yet
          </h3>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', maxWidth: '380px', margin: '0 auto', lineHeight: 1.6 }}>
            {isOwnProfile
              ? 'Here are all the badges you can earn. Start predicting to fill them in.'
              : `${username} hasn't earned any achievements yet.`
            }
          </p>
          {isOwnProfile && (
            <Link
              href="/tournaments"
              style={{ display: 'inline-block', marginTop: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--court)', textDecoration: 'none' }}
            >
              Browse tournaments →
            </Link>
          )}
        </div>
      )}

      {/* Stats summary */}
      <div className="flex flex-wrap gap-4 md:gap-6 mb-8">
        {goldCount > 0 && (
          <StatBox value={goldCount} label="1st place" color="#D4A017" />
        )}
        {silverCount > 0 && (
          <StatBox value={silverCount} label="2nd place" color="#8A8A8A" />
        )}
        {bronzeCount > 0 && (
          <StatBox value={bronzeCount} label="3rd place" color="#B87333" />
        )}
        {perfectCount > 0 && (
          <StatBox value={perfectCount} label="Perfect" color="#7C4FE6" />
        )}
        <StatBox value={totalCount} label="Achievements" />
      </div>

      {/* Perfect Prediction — always visible so users know it exists */}
      <SectionLabel>✨ The Perfect Prediction</SectionLabel>
      <div
        className="grid gap-4 mb-8"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
      >
        {perfectPredictions.length > 0 ? (
          perfectPredictions.map((a, i) => {
            const def = ACHIEVEMENTS['perfect_prediction']
            if (!def) return null
            return (
              <PerfectPredictionBadge
                key={`perfect-${a.tournament_id}-${i}`}
                def={def}
                meta={a.meta}
              />
            )
          })
        ) : (
          <LockedSpecialBadge def={ACHIEVEMENTS['perfect_prediction']} />
        )}
      </div>
      <div style={{ height: '1px', background: 'var(--chalk-dim)', margin: '32px 0' }} />

      {/* Tournament Trophies — always visible so users know they exist */}
      <SectionLabel>🏆 Tournament Trophies</SectionLabel>
      <div
        className="grid gap-4 mb-8"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
      >
        {trophyAchievements.length > 0 ? (
          trophyAchievements.map((a, i) => {
            const def = ACHIEVEMENTS[a.achievement_key]
            if (!def) return null
            const tierClass = def.tier ?? 'gold'
            return (
              <TrophyBadge
                key={`${a.achievement_key}-${a.tournament_id}-${i}`}
                def={def}
                tier={tierClass}
                meta={a.meta}
              />
            )
          })
        ) : (
          <>
            <LockedTrophyBadge def={ACHIEVEMENTS['tournament_champion']} tier="gold" />
            <LockedTrophyBadge def={ACHIEVEMENTS['runner_up']} tier="silver" />
            <LockedTrophyBadge def={ACHIEVEMENTS['on_the_podium']} tier="bronze" />
          </>
        )}
      </div>
      <div style={{ height: '1px', background: 'var(--chalk-dim)', margin: '32px 0' }} />

      {/* Non-trophy achievement groups */}
      {nonTrophyGroups.map(group => {
        const earned = achievements.filter(a =>
          group.items.some(item => item.key === a.achievement_key)
        )
        const earnedKeySet = new Set(earned.map(a => a.achievement_key))

        return (
          <div key={group.category} className="mb-8">
            <SectionLabel>{group.emoji} {group.label}</SectionLabel>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
            >
              {group.items.map(item => {
                const isEarned = earnedKeySet.has(item.key)
                return (
                  <AchievementBadge
                    key={item.key}
                    def={item}
                    earned={isEarned}
                    category={group.category}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function StatBox({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="border rounded-sm bg-white" style={{ borderColor: 'var(--chalk-dim)', padding: '16px 20px', minWidth: '100px' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: '4px', color }}>
        {value}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {label}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '16px' }}>
      {children}
    </p>
  )
}

const TIER_STYLES = {
  gold: {
    borderColor: '#F0D68A', bg: '#FFF8E7',
    ringBorder: '#D4A017', ringGlow: 'rgba(212,160,23,0.15)',
    placeColor: '#D4A017', hoverShadow: '0 4px 20px rgba(212,160,23,0.15)',
  },
  silver: {
    borderColor: '#D0D0D0', bg: '#F5F5F5',
    ringBorder: '#8A8A8A', ringGlow: 'rgba(138,138,138,0.12)',
    placeColor: '#8A8A8A', hoverShadow: '0 4px 20px rgba(138,138,138,0.12)',
  },
  bronze: {
    borderColor: '#E0C4A8', bg: '#FDF5EE',
    ringBorder: '#B87333', ringGlow: 'rgba(184,115,51,0.12)',
    placeColor: '#B87333', hoverShadow: '0 4px 20px rgba(184,115,51,0.12)',
  },
}

function TrophyBadge({ def, tier, meta }: { def: AchievementDefinition; tier: string; meta: Record<string, any> }) {
  const styles = TIER_STYLES[tier as keyof typeof TIER_STYLES] ?? TIER_STYLES.gold
  const placeLabel = tier === 'gold' ? '1st place' : tier === 'silver' ? '2nd place' : '3rd place'

  return (
    <div
      className="flex flex-col items-center tournament-card"
      style={{
        padding: '24px 14px 18px',
        borderRadius: '3px',
        border: `1px solid ${styles.borderColor}`,
        background: styles.bg,
      }}
    >
      <div
        style={{
          width: '68px', height: '68px', borderRadius: '50%',
          border: `2.5px solid ${styles.ringBorder}`,
          boxShadow: `0 0 0 3px ${styles.ringGlow}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '12px', background: 'white',
        }}
      >
        <span style={{ fontSize: '1.7rem', lineHeight: 1 }}>{def.emoji}</span>
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: styles.placeColor, marginBottom: '10px' }}>
        {placeLabel}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', letterSpacing: '-0.01em', textAlign: 'center', lineHeight: 1.25, marginBottom: '4px', color: 'var(--ink)' }}>
        {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}
        {meta.tournament_name ?? 'Tournament'}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>
        {meta.tournament_year ?? ''}
      </span>
      {meta.tournament_tour && (
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.06em',
            textTransform: 'uppercase', padding: '1px 5px', borderRadius: '2px',
            display: 'inline-block', marginTop: '4px',
            background: meta.tournament_tour === 'ATP' ? '#dbeafe' : '#f3e8ff',
            color: meta.tournament_tour === 'ATP' ? '#1e4e8c' : '#6b21a8',
          }}
        >
          {meta.tournament_tour}
        </span>
      )}
    </div>
  )
}

function PerfectPredictionBadge({ def, meta }: { def: AchievementDefinition; meta: Record<string, any> }) {
  // Distinctive purple/iridescent styling — this achievement is ultra-rare
  const borderColor = '#C8B5F0'
  const bg = 'linear-gradient(135deg, #F5EFFF 0%, #EDE5FF 50%, #F0E5FF 100%)'
  const ringBorder = '#7C4FE6'
  const ringGlow = 'rgba(124,79,230,0.18)'
  const placeColor = '#7C4FE6'

  return (
    <div
      className="flex flex-col items-center tournament-card"
      style={{
        padding: '24px 14px 18px',
        borderRadius: '3px',
        border: `1px solid ${borderColor}`,
        background: bg,
      }}
    >
      <div
        style={{
          width: '68px', height: '68px', borderRadius: '50%',
          border: `2.5px solid ${ringBorder}`,
          boxShadow: `0 0 0 3px ${ringGlow}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '12px', background: 'white',
        }}
      >
        <span style={{ fontSize: '1.7rem', lineHeight: 1 }}>{def.emoji}</span>
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: placeColor, marginBottom: '10px' }}>
        Perfect
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', letterSpacing: '-0.01em', textAlign: 'center', lineHeight: 1.25, marginBottom: '4px', color: 'var(--ink)' }}>
        {meta.tournament_flag_emoji && <>{meta.tournament_flag_emoji} </>}
        {meta.tournament_name ?? 'Tournament'}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>
        {meta.tournament_year ?? ''}
        {meta.total_matches ? ` · ${meta.total_matches} picks` : ''}
      </span>
      {meta.tournament_tour && (
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.06em',
            textTransform: 'uppercase', padding: '1px 5px', borderRadius: '2px',
            display: 'inline-block', marginTop: '4px',
            background: meta.tournament_tour === 'ATP' ? '#dbeafe' : '#f3e8ff',
            color: meta.tournament_tour === 'ATP' ? '#1e4e8c' : '#6b21a8',
          }}
        >
          {meta.tournament_tour}
        </span>
      )}
    </div>
  )
}

// Locked placeholder for a tournament trophy tier (shown when user has none of that tier)
function LockedTrophyBadge({ def, tier }: { def: AchievementDefinition | undefined; tier: string }) {
  if (!def) return null
  const styles = TIER_STYLES[tier as keyof typeof TIER_STYLES] ?? TIER_STYLES.gold
  const placeLabel = tier === 'gold' ? '1st place' : tier === 'silver' ? '2nd place' : '3rd place'

  return (
    <div
      className="flex flex-col items-center"
      style={{
        padding: '24px 14px 18px',
        borderRadius: '3px',
        border: `1px dashed var(--chalk-dim)`,
        background: 'white',
        opacity: 0.45,
      }}
    >
      <div
        style={{
          width: '68px', height: '68px', borderRadius: '50%',
          border: `2px dashed var(--chalk-dim)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '12px', background: 'white',
        }}
      >
        <span style={{ fontSize: '1.7rem', lineHeight: 1, filter: 'grayscale(0.6)' }}>{def.emoji}</span>
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: styles.placeColor, marginBottom: '10px' }}>
        {placeLabel}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', letterSpacing: '-0.01em', textAlign: 'center', lineHeight: 1.25, marginBottom: '4px', color: 'var(--ink)' }}>
        {def.name}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.02em', textAlign: 'center', lineHeight: 1.4, padding: '0 4px' }}>
        {def.description}
      </span>
    </div>
  )
}

// Locked placeholder for Perfect Prediction (shown when user hasn't earned one yet)
function LockedSpecialBadge({ def }: { def: AchievementDefinition | undefined }) {
  if (!def) return null
  return (
    <div
      className="flex flex-col items-center"
      style={{
        padding: '24px 14px 18px',
        borderRadius: '3px',
        border: `1px dashed var(--chalk-dim)`,
        background: 'white',
        opacity: 0.5,
      }}
    >
      <div
        style={{
          width: '68px', height: '68px', borderRadius: '50%',
          border: `2px dashed var(--chalk-dim)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '12px', background: 'white',
        }}
      >
        <span style={{ fontSize: '1.7rem', lineHeight: 1, filter: 'grayscale(0.6)' }}>{def.emoji}</span>
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7C4FE6', marginBottom: '10px' }}>
        Perfect
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', letterSpacing: '-0.01em', textAlign: 'center', lineHeight: 1.25, marginBottom: '4px', color: 'var(--ink)' }}>
        {def.name}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', letterSpacing: '0.02em', textAlign: 'center', lineHeight: 1.4, padding: '0 4px' }}>
        {def.description}
      </span>
    </div>
  )
}

function AchievementBadge({ def, earned, category }: { def: AchievementDefinition; earned: boolean; category: string }) {
  const colors = CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS]

  return (
    <div
      className="flex flex-col items-center tournament-card"
      style={{
        padding: '16px 8px 12px',
        borderRadius: '3px',
        border: `1px ${earned ? 'solid' : 'dashed'} ${earned ? colors?.border ?? 'var(--chalk-dim)' : 'var(--chalk-dim)'}`,
        background: earned ? colors?.bg ?? 'white' : 'white',
        opacity: earned ? 1 : 0.35,
      }}
    >
      <div
        style={{
          width: '48px', height: '48px', borderRadius: '50%',
          border: `2px ${earned ? 'solid' : 'dashed'} ${earned ? colors?.color ?? 'var(--chalk-dim)' : 'var(--chalk-dim)'}`,
          boxShadow: earned ? `0 0 0 2px ${colors?.glow ?? 'transparent'}` : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '8px', background: 'white',
        }}
      >
        <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{def.emoji}</span>
      </div>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.78rem', letterSpacing: '-0.01em', textAlign: 'center', lineHeight: 1.2, color: 'var(--ink)', marginBottom: '2px' }}>
        {def.name}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--muted)', textAlign: 'center', letterSpacing: '0.02em', lineHeight: 1.4 }}>
        {def.description}
      </span>
    </div>
  )
}
