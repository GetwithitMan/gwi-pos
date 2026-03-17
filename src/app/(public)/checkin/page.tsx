'use client'

import { useState, useCallback } from 'react'

/**
 * Guest Self Check-In Page
 *
 * Flow: phone entry → match today's confirmed reservations → auto check-in or show message
 * Privacy: NEVER show other guests' details
 */

type CheckInState = 'input' | 'checking' | 'success' | 'ambiguous' | 'not_found' | 'error'

interface CheckInResult {
  guestName: string
  reservationTime: string
  partySize: number
  tableName?: string
  occasion?: string
}

export default function GuestCheckInPage() {
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<CheckInState>('input')
  const [result, setResult] = useState<CheckInResult | null>(null)

  const handleDigit = useCallback((digit: string) => {
    if (phone.length < 10) setPhone(prev => prev + digit)
  }, [phone])

  const handleBackspace = useCallback(() => {
    setPhone(prev => prev.slice(0, -1))
  }, [])

  const handleClear = useCallback(() => {
    setPhone('')
    setState('input')
    setResult(null)
  }, [])

  const formatDisplay = (p: string) => {
    if (p.length <= 3) return p
    if (p.length <= 6) return `(${p.slice(0, 3)}) ${p.slice(3)}`
    return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`
  }

  const handleCheckIn = async () => {
    if (phone.length < 10) return
    setState('checking')

    try {
      const res = await fetch('/api/public/reservations/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })

      const data = await res.json()

      if (res.ok && data.status === 'checked_in') {
        setState('success')
        setResult({
          guestName: data.guestName,
          reservationTime: data.reservationTime,
          partySize: data.partySize,
          tableName: data.tableName,
          occasion: data.occasion,
        })
      } else if (res.status === 409 && data.code === 'AMBIGUOUS') {
        setState('ambiguous')
      } else if (res.status === 404) {
        setState('not_found')
      } else {
        setState('error')
      }
    } catch {
      setState('error')
    }
  }

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '']

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      {/* Success */}
      {state === 'success' && result && (
        <div className="text-center space-y-6 animate-fade-in">
          <div className="text-6xl">&#10003;</div>
          <h1 className="text-4xl font-bold text-white">Welcome, {result.guestName}!</h1>
          <div className="text-xl text-gray-300">
            Party of {result.partySize} at {formatTime(result.reservationTime)}
          </div>
          {result.tableName && (
            <div className="text-lg text-gray-400">Table: {result.tableName}</div>
          )}
          {result.occasion && (
            <div className="text-lg text-purple-400">Happy {result.occasion}!</div>
          )}
          <p className="text-gray-500 mt-8">The host will seat you shortly.</p>
          <button
            onClick={handleClear}
            className="mt-8 px-8 py-3 bg-gray-800 text-gray-300 rounded-xl text-lg hover:bg-gray-700 transition-colors"
          >
            Done
          </button>
        </div>
      )}

      {/* Ambiguous — multiple reservations */}
      {state === 'ambiguous' && (
        <div className="text-center space-y-6">
          <h1 className="text-3xl font-bold text-white">Please See the Host</h1>
          <p className="text-lg text-gray-400">We found multiple reservations. Our host will assist you.</p>
          <button onClick={handleClear} className="mt-8 px-8 py-3 bg-gray-800 text-gray-300 rounded-xl text-lg hover:bg-gray-700 transition-colors">
            Start Over
          </button>
        </div>
      )}

      {/* Not found */}
      {state === 'not_found' && (
        <div className="text-center space-y-6">
          <h1 className="text-3xl font-bold text-white">Reservation Not Found</h1>
          <p className="text-lg text-gray-400">We couldn't find your reservation. Please see the host.</p>
          <button onClick={handleClear} className="mt-8 px-8 py-3 bg-gray-800 text-gray-300 rounded-xl text-lg hover:bg-gray-700 transition-colors">
            Try Again
          </button>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="text-center space-y-6">
          <h1 className="text-3xl font-bold text-white">Something Went Wrong</h1>
          <p className="text-lg text-gray-400">Please see the host for assistance.</p>
          <button onClick={handleClear} className="mt-8 px-8 py-3 bg-gray-800 text-gray-300 rounded-xl text-lg hover:bg-gray-700 transition-colors">
            Try Again
          </button>
        </div>
      )}

      {/* Phone Input */}
      {(state === 'input' || state === 'checking') && (
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Check In</h1>
            <p className="text-gray-400">Enter your phone number</p>
          </div>

          {/* Phone display */}
          <div className="text-center">
            <div className="text-4xl font-mono text-white tracking-wider min-h-[3rem]">
              {phone.length > 0 ? formatDisplay(phone) : (
                <span className="text-gray-600">(___) ___-____</span>
              )}
            </div>
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-3">
            {digits.map((d, i) => {
              if (d === '' && i === 9) {
                return (
                  <button key="backspace" onClick={handleBackspace} className="h-16 rounded-xl bg-gray-800 text-gray-300 text-xl flex items-center justify-center hover:bg-gray-700 transition-colors">
                    &#9003;
                  </button>
                )
              }
              if (d === '' && i === 11) {
                return (
                  <button
                    key="go"
                    onClick={handleCheckIn}
                    disabled={phone.length < 10 || state === 'checking'}
                    className={`h-16 rounded-xl text-xl font-medium flex items-center justify-center transition-colors ${
                      phone.length >= 10 && state !== 'checking'
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-gray-800 text-gray-600'
                    }`}
                  >
                    {state === 'checking' ? '...' : 'Go'}
                  </button>
                )
              }
              return (
                <button
                  key={d}
                  onClick={() => handleDigit(d)}
                  className="h-16 rounded-xl bg-gray-800 text-white text-2xl font-medium flex items-center justify-center hover:bg-gray-700 active:bg-gray-600 transition-colors"
                >
                  {d}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}
