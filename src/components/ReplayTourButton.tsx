'use client'

import { useRouter } from 'next/navigation'
import { resetTour } from './DashboardTour'

export default function ReplayTourButton() {
  const router = useRouter()

  return (
    <button
      onClick={() => {
        resetTour()
        router.push('/dashboard')
      }}
      className="px-4 py-2 text-sm rounded-sm border hover:opacity-80"
      style={{
        borderColor: 'var(--chalk-dim)',
        color: 'var(--muted)',
        background: 'white',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.8rem',
        cursor: 'pointer',
      }}
    >
      Replay tour
    </button>
  )
}
