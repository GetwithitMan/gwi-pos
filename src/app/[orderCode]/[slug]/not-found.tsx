/**
 * Not-found page for unknown [orderCode]/[slug] combinations.
 * Next.js renders this when notFound() is called from within the segment,
 * or when no page matches the route.
 */

export default function SlugNotFound() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="bg-gray-900 rounded-2xl p-8 max-w-sm w-full text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Page Not Found</h1>
        <p className="text-gray-400">
          This ordering link does not exist or may have been removed.
        </p>
      </div>
    </div>
  )
}
