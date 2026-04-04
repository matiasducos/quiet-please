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

export default function ChallengeDetailLoading() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <NavSkeleton />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-10">
        <div className="skeleton h-3 w-32 mb-6" />

        {/* Header */}
        <div className="skeleton h-10 w-52 mb-2" />
        <div className="skeleton h-5 w-72 mb-8" />

        {/* Score section */}
        <div className="bg-white rounded-sm border p-6 mb-6" style={{ borderColor: 'var(--chalk-dim)' }}>
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="skeleton h-6 w-24 mx-auto mb-2" />
              <div className="skeleton h-10 w-16 mx-auto" />
            </div>
            <div className="skeleton h-4 w-8" />
            <div className="text-center flex-1">
              <div className="skeleton h-6 w-24 mx-auto mb-2" />
              <div className="skeleton h-10 w-16 mx-auto" />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <div className="skeleton h-10 w-40 rounded-sm" />
          <div className="skeleton h-10 w-32 rounded-sm" />
        </div>
      </div>
    </main>
  )
}
