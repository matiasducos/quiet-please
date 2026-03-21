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

export default function ChallengesLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-5xl mx-auto px-8 py-10">

        {/* Heading */}
        <div className="mb-8">
          <div className="skeleton h-10 w-56 mb-2" />
          <div className="skeleton h-5 w-full max-w-lg" />
          <div className="flex gap-3 mt-4">
            <div className="skeleton h-9 w-20 rounded-sm" />
            <div className="skeleton h-9 w-32 rounded-sm" />
          </div>
        </div>

        {/* Challenge cards */}
        <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="skeleton h-5 w-28" />
                  <div className="skeleton h-4 w-20 rounded" />
                </div>
                <div className="skeleton h-4 w-44" />
              </div>
              <div className="skeleton h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
