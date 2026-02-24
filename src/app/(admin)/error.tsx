'use client'

/**
 * Admin route-group error boundary (BUG #481).
 * Orange theme matching the admin/food interface. Glassmorphism styling.
 */

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-950 to-slate-900 p-4">
      <div className="max-w-md w-full bg-white/10 backdrop-blur-md rounded-xl shadow-2xl p-8 border border-orange-400/20">
        {/* Error Icon */}
        <div className="flex justify-center mb-6">
          <div className="bg-orange-500/20 rounded-full p-4">
            <svg
              className="w-12 h-12 text-orange-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-white text-center mb-2">
          Admin Error
        </h2>
        <p className="text-orange-200 text-center mb-6">
          The admin panel encountered an error. Tap below to recover.
        </p>

        {error.digest && (
          <p className="text-gray-500 text-xs text-center mb-4">
            Reference: {error.digest}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={reset}
            className="flex-1 bg-orange-500/30 hover:bg-orange-500/50 text-white font-semibold py-3 px-4 rounded-lg transition-colors backdrop-blur-sm border border-orange-400/30"
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  )
}
