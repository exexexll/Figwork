export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-background-secondary">
      {/* Ambient gradient background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top left, rgba(196,181,253,0.15) 0%, transparent 40%)',
        }}
      />

      {/* Header skeleton */}
      <header className="relative z-10 border-b border-border-light bg-white/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-border animate-pulse" />
            <div className="h-6 w-24 rounded bg-border animate-pulse" />
          </div>
          <div className="h-9 w-9 rounded-full bg-border animate-pulse" />
        </div>
      </header>

      <div className="relative flex">
        {/* Sidebar skeleton */}
        <aside className="w-56 min-h-[calc(100vh-64px)] border-r border-border-light bg-white/40 backdrop-blur-sm">
          <nav className="p-4 space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 rounded-lg bg-border/50 animate-pulse"
              />
            ))}
          </nav>
        </aside>

        {/* Main content skeleton */}
        <main className="flex-1 p-8">
          <div className="max-w-6xl space-y-6">
            <div className="h-8 w-48 rounded bg-border animate-pulse" />
            <div className="h-4 w-64 rounded bg-border/50 animate-pulse" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-32 rounded-lg bg-border/30 animate-pulse"
                />
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
