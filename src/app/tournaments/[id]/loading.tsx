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

export default function TournamentDetailLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">

        {/* Back link */}
        <div className="skeleton h-4 w-28 mb-6" />

        {/* Main grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Left: tournament info card (2/3 width on desktop) */}
          <div className="col-span-1 md:col-span-2 bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
            {/* Tour + category badges */}
            <div className="flex items-center gap-2 mb-4">
              <div className="skeleton h-5 w-10" />
              <div className="skeleton h-5 w-20" />
              <div className="skeleton h-5 w-16" />
            </div>
            {/* Tournament name */}
            <div className="skeleton h-9 w-64 mb-2" />
            <div className="skeleton h-5 w-40 mb-6" />

            {/* Meta grid */}
            <div className="grid grid-cols-2 gap-4">
              {[0, 1, 2, 3].map(i => (
                <div key={i}>
                  <div className="skeleton h-3 w-16 mb-1" />
                  <div className="skeleton h-5 w-28" />
                </div>
              ))}
            </div>
          </div>

          {/* Right: action card (1/3 width on desktop) */}
          <div className="bg-white rounded-sm border p-6 flex flex-col gap-4" style={{ borderColor: 'var(--chalk-dim)' }}>
            <div className="skeleton h-3 w-20 mb-1" />
            <div className="skeleton h-5 w-32 mb-4" />
            <div className="skeleton h-10 w-full rounded-sm" />
            <div className="skeleton h-4 w-full mt-2" />
            <div className="skeleton h-4 w-3/4" />
          </div>

        </div>
      </div>
    </main>
  )
}
