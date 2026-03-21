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

export default function ProfileLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">

        {/* Profile header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="skeleton h-10 w-48 mb-2" />
            <div className="skeleton h-4 w-32" />
          </div>
          <div className="skeleton h-9 w-28 rounded-sm" />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-sm border p-5" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="skeleton h-3 w-16 mb-3" />
              <div className="skeleton h-8 w-20" />
            </div>
          ))}
        </div>

        {/* Predictions table */}
        <div className="skeleton h-7 w-36 mb-4" />
        <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="grid grid-cols-12 px-5 py-3 border-b" style={{ borderColor: 'var(--chalk-dim)', background: '#fafaf8' }}>
            <div className="col-span-5"><div className="skeleton h-3 w-20" /></div>
            <div className="col-span-2"><div className="skeleton h-3 w-10" /></div>
            <div className="col-span-2"><div className="skeleton h-3 w-12" /></div>
            <div className="col-span-3 flex justify-end"><div className="skeleton h-3 w-12" /></div>
          </div>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="grid grid-cols-12 px-5 py-4 border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="col-span-5"><div className="skeleton h-4" style={{ width: `${80 + (i % 3) * 30}px` }} /></div>
              <div className="col-span-2 flex justify-center"><div className="skeleton h-4 w-10" /></div>
              <div className="col-span-2 flex justify-center"><div className="skeleton h-4 w-12" /></div>
              <div className="col-span-3 flex justify-end"><div className="skeleton h-4 w-8" /></div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
