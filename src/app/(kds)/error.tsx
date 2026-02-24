'use client'

import { useEffect } from 'react'

/**
 * KDS route-group error boundary (BUG #482).
 * Auto-retries after 5 seconds since KDS screens run unattended.
 * Glassmorphism styling with a neutral theme.
 */

export default function KDSError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Auto-retry after 5 seconds — KDS screens are typically unattended
  useEffect(() => {
    const timer = setTimeout(reset, 5000)
    return () => clearTimeout(timer)
  }, [reset])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 to-slate-900 p-4">
      <div className="max-w-md w-full bg-white/10 backdrop-blur-md rounded-xl shadow-2xl p-8 border border-white/20">
        {/* Error Icon */}
        <div className="flex justify-center mb-6">
          <div className="bg-yellow-500/20 rounded-full p-4">
            <svg
              className="w-12 h-12 text-yellow-400"
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
          KDS Display Error
        </h2>
        <p className="text-gray-300 text-center mb-2">
          The kitchen display encountered an error.
        </p>
        <p className="text-yellow-300 text-sm text-center mb-6">
          Automatically retrying in 5 seconds...
        </p>

        {error.digest && (
          <p className="text-gray-500 text-xs text-center mb-4">
            Reference: {error.digest}
          </p>
        )}

        <button
          onClick={reset}
          className="w-full bg-white/20 hover:bg-white/30 text-white font-semibold py-3 px-4 rounded-lg transition-colors backdrop-blur-sm"
        >
          Try Again Now
        </button>
      </div>
    </div>
  )
}
