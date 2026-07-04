export default function SearchLoading() {
  return (
    <main className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="mb-2 h-4 w-20 animate-pulse rounded bg-gray-200" />
          <div className="h-10 w-full animate-pulse rounded-full bg-gray-200" />
        </div>
      </div>
      <div className="mx-auto max-w-2xl space-y-3 px-4 py-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="overflow-hidden rounded-lg bg-white shadow-sm">
            <div className="h-40 w-full animate-pulse bg-gray-200" />
            <div className="space-y-2 p-3">
              <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
