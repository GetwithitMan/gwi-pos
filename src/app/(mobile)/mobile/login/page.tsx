'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function MobileLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <MobileLoginContent />
    </Suspense>
  )
}

function MobileLoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const locationId = searchParams.get('locationId') ?? ''

  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleDigit = (digit: string) => {
    if (pin.length < 6) setPin(prev => prev + digit)
  }

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1))
  }

  const handleSubmit = async () => {
    if (pin.length < 4) {
      setError('PIN must be at least 4 digits')
      return
    }
    if (!locationId) {
      setError('Missing location. Scan QR code again.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/mobile/device/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, locationId }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        setPin('')
        return
      }

      // Session cookie is set by the API. Redirect to tabs (no query params needed).
      router.replace(`/mobile/tabs?locationId=${locationId}`)
    } catch {
      setError('Connection error. Please try again.')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 px-6 py-8">
      {/* Title */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-white">Enter Your PIN</h1>
        <p className="text-white/40 text-sm mt-1">Sign in to view your tabs</p>
      </div>

      {/* PIN dots */}
      <div className="flex gap-4 mb-8">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full transition-colors ${
              i < pin.length ? 'bg-blue-400' : 'bg-white/20'
            }`}
          />
        ))}
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-6 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
          {error}
        </div>
      )}

      {/* Numeric keypad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {digits.map((digit, idx) => {
          if (digit === '') {
            return <div key={idx} />
          }

          if (digit === 'del') {
            return (
              <button
                key={idx}
                onClick={handleDelete}
                disabled={loading}
                className="flex items-center justify-center h-16 rounded-2xl bg-white/10 text-white/60 text-lg font-medium
                  active:bg-white/20 transition-colors disabled:opacity-40"
                aria-label="Delete"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.374-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z"
                  />
                </svg>
              </button>
            )
          }

          return (
            <button
              key={idx}
              onClick={() => handleDigit(digit)}
              disabled={loading}
              className="flex items-center justify-center h-16 rounded-2xl bg-white/10 text-white text-2xl font-semibold
                active:bg-white/20 transition-colors disabled:opacity-40"
            >
              {digit}
            </button>
          )
        })}
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={loading || pin.length < 4}
        className="mt-8 w-full max-w-xs py-4 rounded-2xl bg-blue-500 text-white text-lg font-semibold
          disabled:opacity-40 active:bg-blue-600 transition-colors"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Signing in...
          </span>
        ) : (
          'Sign In'
        )}
      </button>
    </div>
  )
}
