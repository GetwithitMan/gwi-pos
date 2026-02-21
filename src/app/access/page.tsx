'use client'

/**
 * GWI Access Gate — Personal Code Verification (T-070)
 *
 * Step 1: Enter registered phone number
 * Step 2: Enter your personal GWI access code (provided by GWI)
 */

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function AccessGate() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') || '/settings'

  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function formatPhoneDisplay(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 10)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit US phone number')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/access/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to verify phone')
      } else {
        setStep('code')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ''), code: code.toUpperCase() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Invalid access code')
      } else {
        router.push(nextPath)
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">GWI Point of Sale</h1>
          <p className="text-gray-400 text-sm mt-1">Authorized access only</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 shadow-xl">
          {step === 'phone' ? (
            <form onSubmit={handlePhoneSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Phone number
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  autoFocus
                  placeholder="(555) 555-5555"
                  value={formatPhoneDisplay(phone)}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg tracking-wide placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Enter your registered number to continue.
                </p>
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-950 border border-red-900 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || phone.replace(/\D/g, '').length !== 10}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Checking…' : 'Continue'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-300">
                    GWI access code
                  </label>
                  <button
                    type="button"
                    onClick={() => { setStep('phone'); setCode(''); setError('') }}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Change number
                  </button>
                </div>
                <p className="text-gray-400 text-sm mb-3">
                  Enter the access code provided by GWI.
                </p>
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  autoFocus
                  maxLength={6}
                  placeholder="A3K9MN"
                  value={code}
                  onChange={(e) => setCode(e.target.value.slice(0, 6))}
                  style={{ textTransform: 'uppercase', letterSpacing: '0.25em' }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-2xl text-center placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-950 border border-red-900 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || code.length < 4}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Verifying…' : 'Enter demo'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          GWI Point of Sale · Authorized access only
        </p>
      </div>
    </div>
  )
}

export default function AccessPage() {
  return (
    <Suspense>
      <AccessGate />
    </Suspense>
  )
}
