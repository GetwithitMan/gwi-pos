export default function TaxRulesLoading() {
  return (
    <div className="p-6 max-w-7xl mx-auto animate-pulse">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <div className="h-7 w-32 bg-gray-200 rounded mb-2" />
          <div className="h-4 w-64 bg-gray-100 rounded" />
        </div>
        <div className="h-9 w-28 bg-gray-200 rounded" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg p-4 border">
            <div className="h-8 w-10 bg-gray-200 rounded mx-auto mb-2" />
            <div className="h-4 w-24 bg-gray-100 rounded mx-auto" />
          </div>
        ))}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b">
          <div className="h-5 w-24 bg-gray-200 rounded" />
        </div>
        <div className="p-4 space-y-3">
          {/* Table header */}
          <div className="grid grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-4 bg-gray-100 rounded" />
            ))}
          </div>
          {/* Table rows */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="grid grid-cols-7 gap-3 py-2 border-t">
              {Array.from({ length: 7 }).map((_, j) => (
                <div key={j} className="h-5 bg-gray-100 rounded" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
