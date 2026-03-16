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

export default function TournamentsLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">

        {/* Header + filters row */}
        <div className="flex flex-wrap items-center gap-3 mb-8">
          <div className="skeleton h-10 w-36" />
          {/* tour chips */}
          <div className="flex gap-2 ml-auto">
            <div className="skeleton h-7 w-10 rounded-full" />
            <div className="skeleton h-7 w-12 rounded-full" />
            <div className="skeleton h-7 w-12 rounded-full" />
          </div>
          {/* surface chips */}
          <div className="flex gap-2">
            <div className="skeleton h-7 w-10 rounded-full" />
            <div className="skeleton h-7 w-12 rounded-full" />
            <div className="skeleton h-7 w-14 rounded-full" />
            <div className="skeleton h-7 w-12 rounded-full" />
          </div>
        </div>

        {/* Tournament cards */}
        <div className="flex flex-col gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-sm border px-4 md:px-6 py-4" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="flex items-center gap-3 mb-2">
                <div className="skeleton h-5 w-10" />
                <div className="skeleton h-5 w-6" />
                <div className="skeleton h-6 w-48" />
                <div className="skeleton h-5 w-16 ml-auto" />
              </div>
              <div className="flex items-center gap-3 mt-2">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-4 w-32" />
              </div>
            </div>
          ))}
        </div>

      </div>
    </main>
  )
}
