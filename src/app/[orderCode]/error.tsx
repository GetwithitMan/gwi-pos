'use client'

/**
 * Error boundary for the [orderCode] segment.
 * Rendered when an unhandled exception is thrown within any page
 * under /:orderCode (including /:orderCode/:slug pages).
 */

export default function OrderCodeError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="bg-gray-900 rounded-2xl p-8 max-w-sm w-full text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Order Code Not Found</h1>
        <p className="text-gray-400">
          This ordering link may be invalid or unavailable.
        </p>
        {error.digest && (
          <p className="text-gray-600 text-xs mt-4">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
