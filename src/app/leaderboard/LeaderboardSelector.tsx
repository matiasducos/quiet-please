'use client'

import { useRouter } from 'next/navigation'

interface Tournament {
  id: string
  name: string
  location: string | null
  flag_emoji: string | null
  tour: string
  status: string
}

export default function LeaderboardSelector({
  tournaments,
  currentTournamentId,
}: {
  tournaments: Tournament[]
  currentTournamentId: string | null
}) {
  const router = useRouter()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    if (value === 'global') {
      router.push('/leaderboard')
    } else {
      router.push(`/leaderboard/tournaments/${value}`)
    }
  }

  return (
    <select
      value={currentTournamentId ?? 'global'}
      onChange={handleChange}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.8rem',
        padding: '8px 12px',
        border: '1px solid var(--chalk-dim)',
        borderRadius: '2px',
        background: 'white',
        color: 'var(--ink)',
        cursor: 'pointer',
        width: '100%',
        maxWidth: '400px',
      }}
    >
      <option value="global">🏆 Global Leaderboard</option>
      {tournaments.map(t => (
        <option key={t.id} value={t.id}>
          {t.flag_emoji ? `${t.flag_emoji} ` : ''}{t.location ?? t.name} · {t.tour} {t.status === 'in_progress' ? '(live)' : t.status === 'completed' ? '(finished)' : ''}
        </option>
      ))}
    </select>
  )
}
