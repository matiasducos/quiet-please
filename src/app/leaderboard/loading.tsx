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

export default function LeaderboardLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-3xl mx-auto px-8 py-10">

        {/* Heading */}
        <div className="mb-8">
          <div className="skeleton h-10 w-40 mb-2" />
          <div className="skeleton h-4 w-48" />
        </div>

        {/* "My rank" highlight card */}
        <div className="mb-6 px-5 py-4 rounded-sm border" style={{ borderColor: 'var(--chalk-dim)', background: 'white' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="skeleton h-5 w-10" />
              <div className="skeleton h-5 w-32" />
            </div>
            <div className="skeleton h-5 w-16" />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
          {/* Header */}
          <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
            <div className="col-span-1"><div className="skeleton h-3 w-8" /></div>
            <div className="col-span-8"><div className="skeleton h-3 w-12" /></div>
            <div className="col-span-3 flex justify-end"><div className="skeleton h-3 w-12" /></div>
          </div>

          {/* Rows */}
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="grid grid-cols-12 px-5 py-4 border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="col-span-1 flex items-center">
                <div className="skeleton h-4 w-6" />
              </div>
              <div className="col-span-8 flex items-center">
                <div className="skeleton h-4" style={{ width: `${60 + (i % 4) * 20}px` }} />
              </div>
              <div className="col-span-3 flex items-center justify-end">
                <div className="skeleton h-4 w-10" />
              </div>
            </div>
          ))}
        </div>

      </div>
    </main>
  )
}
