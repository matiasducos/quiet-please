// Nav placeholder (matches Nav.tsx height exactly)
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

export default function DashboardLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-12">

        {/* Heading */}
        <div className="mb-12">
          <div className="skeleton h-10 w-72 mb-2" />
          <div className="skeleton h-5 w-52" />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-4 mb-12">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="skeleton h-3 w-20 mb-3" />
              <div className="skeleton h-9 w-24" />
            </div>
          ))}
        </div>

        {/* Upcoming tournaments */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="skeleton h-7 w-44" />
            <div className="skeleton h-4 w-16" />
          </div>
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center justify-between bg-white rounded-sm border px-6 py-4" style={{ borderColor: 'var(--chalk-dim)' }}>
                <div className="flex items-center gap-4">
                  <div className="skeleton h-5 w-10" />
                  <div className="skeleton h-5 w-40" />
                </div>
                <div className="skeleton h-4 w-14" />
              </div>
            ))}
          </div>
        </div>

      </div>
    </main>
  )
}
