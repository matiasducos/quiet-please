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
        padding: '8px 32px 8px 12px',
        border: '1px solid var(--chalk-dim)',
        borderRadius: '2px',
        background: `white url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b6b6b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center`,
        WebkitAppearance: 'none',
        appearance: 'none',
        color: 'var(--ink)',
        cursor: 'pointer',
        width: 'fit-content',
        maxWidth: '100%',
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
