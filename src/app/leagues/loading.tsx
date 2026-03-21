function NavSkeleton() {
  return (
    <div className="sticky top-0 z-50 bg-white border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
      <div className="max-w-5xl mx-auto flex items-center justify-between px-4 md:px-8 py-3 md:py-5">
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

export default function LeaguesLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-5xl mx-auto px-8 py-10">

        {/* Header row */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="skeleton h-10 w-28 mb-2" />
            <div className="skeleton h-4 w-56" />
          </div>
          <div className="flex gap-3">
            <div className="skeleton h-9 w-28 rounded-sm" />
            <div className="skeleton h-9 w-28 rounded-sm" />
          </div>
        </div>

        {/* League cards */}
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center justify-between bg-white rounded-sm border px-6 py-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div>
                <div className="skeleton h-5 w-40 mb-2" />
                <div className="skeleton h-4 w-56" />
              </div>
              <div className="text-right">
                <div className="skeleton h-5 w-16 mb-1" />
                <div className="skeleton h-3 w-14" />
              </div>
            </div>
          ))}
        </div>

      </div>
    </main>
  )
}
