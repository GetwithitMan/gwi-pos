'use client'

import { useEffect, useState } from 'react'

/**
 * KDS route-group error boundary (BUG #482).
 * Exponential backoff auto-retry (5s, 10s, 20s) with max 3 retries.
 * After max retries, shows a persistent error with manual retry button.
 * KDS screens are typically unattended, so auto-recovery is critical.
 */

const MAX_RETRIES = 3

export default function KDSError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [retryCount, setRetryCount] = useState(0)
  const exhausted = retryCount >= MAX_RETRIES

  // Auto-retry with exponential backoff: 5s, 10s, 20s (capped at 30s)
  useEffect(() => {
    if (retryCount < MAX_RETRIES) {
      const delay = Math.min(5000 * Math.pow(2, retryCount), 30000)
      const timer = setTimeout(() => {
        setRetryCount(c => c + 1)
        reset()
      }, delay)
      return () => clearTimeout(timer)
    }
  }, [retryCount, reset])

  const nextDelay = retryCount < MAX_RETRIES
    ? Math.min(5000 * Math.pow(2, retryCount), 30000) / 1000
    : 0

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 to-slate-900 p-4">
      <div className="max-w-md w-full bg-white/10 backdrop-blur-md rounded-xl shadow-2xl p-8 border border-white/20">
        {/* Error Icon */}
        <div className="flex justify-center mb-6">
          <div className={`${exhausted ? 'bg-red-500/20' : 'bg-yellow-500/20'} rounded-full p-4`}>
            <svg
              className={`w-12 h-12 ${exhausted ? 'text-red-400' : 'text-yellow-400'}`}
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

        {!exhausted ? (
          <p className="text-yellow-300 text-sm text-center mb-6">
            Retrying in {nextDelay} seconds... (attempt {retryCount + 1}/{MAX_RETRIES})
          </p>
        ) : (
          <div className="mb-6">
            <p className="text-red-300 text-sm text-center mb-2">
              Auto-recovery failed after {MAX_RETRIES} attempts.
            </p>
            <p className="text-red-200 text-sm text-center font-semibold">
              Contact a manager to restart this display.
            </p>
          </div>
        )}

        {error.digest && (
          <p className="text-gray-500 text-xs text-center mb-4">
            Reference: {error.digest}
          </p>
        )}

        <button
          onClick={() => {
            setRetryCount(0)
            reset()
          }}
          className="w-full bg-white/20 hover:bg-white/30 text-white font-semibold py-3 px-4 rounded-lg transition-colors backdrop-blur-sm"
        >
          {exhausted ? 'Manual Retry' : 'Try Again Now'}
        </button>
      </div>
    </div>
  )
}
