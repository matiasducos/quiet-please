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

export default function NotificationsLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-10">

        {/* Heading */}
        <div className="mb-6">
          <div className="skeleton h-10 w-48 mb-2" />
          <div className="skeleton h-4 w-64" />
        </div>

        {/* Notification items */}
        <div className="bg-white rounded-sm border overflow-hidden" style={{ borderColor: 'var(--chalk-dim)' }}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-start gap-3 px-5 py-4 border-b last:border-0" style={{ borderColor: 'var(--chalk-dim)' }}>
              <div className="flex-1">
                <div className="skeleton h-3 w-24 mb-2" />
                <div className="skeleton h-4 mb-1" style={{ width: `${180 + (i % 3) * 60}px` }} />
                <div className="skeleton h-3 w-16 mt-1" />
              </div>
              <div className="skeleton h-3 w-12 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
