export default function VendorsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 p-6 animate-pulse">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <div className="h-7 w-28 bg-gray-200 rounded mb-2" />
          <div className="h-4 w-56 bg-gray-100 rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-32 bg-gray-200 rounded" />
          <div className="h-9 w-28 bg-gray-200 rounded" />
        </div>
      </div>

      {/* Vendor cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg p-5 border shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <div className="h-5 w-36 bg-gray-200 rounded" />
              <div className="h-5 w-12 bg-gray-100 rounded-full" />
            </div>
            <div className="space-y-2 mb-4">
              <div className="h-4 w-48 bg-gray-100 rounded" />
              <div className="h-4 w-40 bg-gray-100 rounded" />
              <div className="h-4 w-32 bg-gray-100 rounded" />
            </div>
            <div className="flex gap-2 pt-3 border-t">
              <div className="h-8 w-14 bg-gray-100 rounded" />
              <div className="h-8 w-14 bg-gray-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
