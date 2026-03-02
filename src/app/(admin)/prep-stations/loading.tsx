export default function PrepStationsLoading() {
  return (
    <div className="min-h-screen bg-gray-100 p-6 animate-pulse">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <div className="h-7 w-44 bg-gray-300 rounded mb-2" />
          <div className="h-4 w-72 bg-gray-200 rounded" />
        </div>
        <div className="h-9 w-36 bg-gray-300 rounded" />
      </div>

      {/* Station cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg p-5 shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <div className="h-5 w-32 bg-gray-200 rounded" />
              <div className="h-5 w-16 bg-gray-100 rounded-full" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-full bg-gray-100 rounded" />
              <div className="h-4 w-3/4 bg-gray-100 rounded" />
            </div>
            <div className="mt-4 flex gap-2">
              <div className="h-8 w-16 bg-gray-100 rounded" />
              <div className="h-8 w-16 bg-gray-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
