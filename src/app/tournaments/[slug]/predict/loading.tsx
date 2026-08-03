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

export default function PredictLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        {/* Breadcrumb */}
        <div className="skeleton h-3 w-48 mb-6" />

        {/* Title */}
        <div className="skeleton h-10 w-64 mb-2" />
        <div className="skeleton h-4 w-44 mb-6" />

        {/* Round tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton h-8 w-20 rounded-sm flex-shrink-0" />
          ))}
        </div>

        {/* Match cards */}
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-sm border p-4" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-4 w-16" />
              </div>
              <div className="flex flex-col gap-2">
                <div className="skeleton h-10 w-full rounded-sm" />
                <div className="skeleton h-10 w-full rounded-sm" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
