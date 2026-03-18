function NavSkeleton() {
  return (
    <div className="sticky top-0 z-50 bg-white border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="flex items-center justify-between px-4 md:px-8 py-3 md:py-5">
        <div className="flex items-center gap-6 md:gap-8">
          <div className="skeleton h-5 w-28" />
          <div className="hidden md:flex items-center gap-6">
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-16" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-20" />
          <div className="skeleton h-5 w-14 rounded" />
          <div className="skeleton h-4 w-12" />
        </div>
      </div>
    </div>
  )
}

export default function LeagueDetailLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />

      <div className="max-w-3xl mx-auto px-8 py-10">

        {/* Breadcrumb */}
        <div className="skeleton h-3 w-36 mb-6" />

        {/* Header: league name + invite code box */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="skeleton h-10 w-56 mb-2" />
            <div className="skeleton h-4 w-40" />
          </div>
          {/* Invite code card placeholder (owner only — show at ~30% chance in skeleton) */}
          <div className="bg-white rounded-sm border px-5 py-3 text-center" style={{ borderColor: 'var(--chalk-dim)', minWidth: '110px' }}>
            <div className="skeleton h-2 w-16 mx-auto mb-2" />
            <div className="skeleton h-6 w-20 mx-auto mb-2" />
            <div className="skeleton h-2 w-14 mx-auto" />
          </div>
        </div>

        {/* My rank highlight card */}
        <div className="mb-6 px-5 py-4 rounded-sm border" style={{ background: '#eaf3de', borderColor: '#97C459' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="skeleton h-5 w-8" style={{ background: '#c8e6a0' }} />
              <div className="skeleton h-5 w-32" style={{ background: '#c8e6a0' }} />
            </div>
            <div className="skeleton h-5 w-14" style={{ background: '#c8e6a0' }} />
          </div>
        </div>

        {/* Members leaderboard */}
        <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
          {/* Header */}
          <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
            <div className="col-span-1"><div className="skeleton h-3 w-8" /></div>
            <div className="col-span-8"><div className="skeleton h-3 w-12" /></div>
            <div className="col-span-3 flex justify-end"><div className="skeleton h-3 w-12" /></div>
          </div>
          {/* Rows */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-12 px-5 py-4 border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="col-span-1 flex items-center">
                <div className="skeleton h-4 w-5" />
              </div>
              <div className="col-span-8 flex items-center">
                <div className="skeleton h-4" style={{ width: `${80 + (i % 3) * 30}px` }} />
              </div>
              <div className="col-span-3 flex items-center justify-end">
                <div className="skeleton h-4 w-10" />
              </div>
            </div>
          ))}
        </div>

        {/* Activity feed */}
        <div className="mt-10">
          <div className="skeleton h-6 w-36 mb-4" />
          <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3 border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
                <div className="skeleton h-5 w-5 rounded-full flex-shrink-0" />
                <div className="flex-1">
                  <div className="skeleton h-4" style={{ width: `${120 + (i % 4) * 40}px` }} />
                </div>
                <div className="skeleton h-3 w-10 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>

      </div>
    </main>
  )
}
