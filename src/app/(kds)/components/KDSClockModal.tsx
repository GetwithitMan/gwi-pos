'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerifiedEmployee {
  id: string
  name: string
  role: string
}

interface ClockStatus {
  clockedIn: boolean
  onBreak: boolean
  entryId?: string
  clockInTime?: string | null
}

type ModalStep = 'pin' | 'status' | 'success'

interface KDSClockModalProps {
  isOpen: boolean
  onClose: () => void
  locationId: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KDSClockModal({ isOpen, onClose, locationId }: KDSClockModalProps) {
  // State
  const [step, setStep] = useState<ModalStep>('pin')
  const [pin, setPin] = useState('')
  const [employee, setEmployee] = useState<VerifiedEmployee | null>(null)
  const [clockStatus, setClockStatus] = useState<ClockStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [elapsed, setElapsed] = useState('')

  // Reset everything when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setStep('pin')
      setPin('')
      setEmployee(null)
      setClockStatus(null)
      setLoading(false)
      setError('')
      setSuccessMessage('')
      setElapsed('')
    }
  }, [isOpen])

  // Elapsed time ticker
  useEffect(() => {
    if (!clockStatus?.clockedIn || !clockStatus.clockInTime) {
      setElapsed('')
      return
    }

    const update = () => {
      const diff = Date.now() - new Date(clockStatus.clockInTime!).getTime()
      const h = Math.floor(diff / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      const s = Math.floor((diff % 60_000) / 1000)
      setElapsed(
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      )
    }

    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [clockStatus?.clockedIn, clockStatus?.clockInTime])

  // -------------------------------------------------------------------
  // PIN authentication  (uses verify-pin, NOT full login)
  // -------------------------------------------------------------------
  const verifyPin = useCallback(async (enteredPin: string) => {
    if (enteredPin.length < 4 || !locationId) return
    setLoading(true)
    setError('')

    try {
      // Step 1: verify PIN
      const authRes = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: enteredPin, locationId }),
      })
      const authJson = await authRes.json()

      if (!authRes.ok) {
        setError(authJson.error || 'Invalid PIN')
        setPin('')
        return
      }

      const emp = authJson.data.employee
      const empData: VerifiedEmployee = {
        id: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        role: emp.role,
      }
      setEmployee(empData)

      // Step 2: fetch clock status
      const statusRes = await fetch(`/api/time-clock/status?employeeId=${emp.id}`)
      const statusJson = await statusRes.json()
      const statusData = statusJson.data ?? statusJson

      if (statusRes.ok) {
        setClockStatus({
          clockedIn: !!statusData.clockedIn,
          onBreak: !!statusData.onBreak,
          entryId: statusData.entryId ?? undefined,
          clockInTime: statusData.clockInTime ?? null,
        })
      } else {
        setClockStatus({ clockedIn: false, onBreak: false })
      }

      setStep('status')
    } catch {
      setError('Connection error')
      setPin('')
    } finally {
      setLoading(false)
    }
  }, [locationId])

  // -------------------------------------------------------------------
  // Clock actions
  // -------------------------------------------------------------------
  const performAction = useCallback(async (
    action: 'clock_in' | 'clock_out' | 'start_break' | 'end_break',
  ) => {
    if (!employee) return
    setLoading(true)
    setError('')

    try {
      if (action === 'start_break' || action === 'end_break') {
        if (!clockStatus?.entryId) {
          setError('No active clock entry')
          setLoading(false)
          return
        }
        const res = await fetch('/api/time-clock', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entryId: clockStatus.entryId,
            action: action === 'start_break' ? 'startBreak' : 'endBreak',
          }),
        })
        const json = await res.json()
        if (!res.ok) {
          setError(json.error || 'Action failed')
          setLoading(false)
          return
        }
        const msg = action === 'start_break' ? 'Break started' : 'Break ended'
        setSuccessMessage(msg)
        toast.success(`${employee.name} - ${msg}`)
      } else {
        // Clock in / out via toggle endpoint
        const res = await fetch('/api/time-clock/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: employee.id, locationId }),
        })
        const json = await res.json()
        if (!res.ok) {
          setError(json.error || 'Clock action failed')
          setLoading(false)
          return
        }
        const data = json.data
        const msg = data.message || (data.action === 'clock_in' ? 'Clocked in' : 'Clocked out')
        setSuccessMessage(msg)

        if (data.action === 'clock_in') {
          toast.success(`${employee.name} clocked in`)
        } else {
          toast.success(`${employee.name} clocked out`)
        }

        // Show warning if any
        if (data.warning) {
          toast.warning(data.warning, 6000)
        }
      }

      setStep('success')
      // Auto-close after brief delay
      setTimeout(() => onClose(), 1800)
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }, [employee, clockStatus, locationId, onClose])

  // -------------------------------------------------------------------
  // PIN pad handler
  // -------------------------------------------------------------------
  const handlePinDigit = useCallback((digit: string) => {
    setError('')
    const newPin = pin + digit
    setPin(newPin)
    if (newPin.length === 4) {
      // Slight delay so the user sees the 4th dot fill
      setTimeout(() => verifyPin(newPin), 80)
    }
  }, [pin, verifyPin])

  const handleDelete = useCallback(() => {
    setPin(prev => prev.slice(0, -1))
    setError('')
  }, [])

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Success screen ────────────────────────────────────────── */}
        {step === 'success' && (
          <div className="text-center py-6">
            <div className="w-14 h-14 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-white">{successMessage}</p>
            {employee && (
              <p className="text-gray-400 text-sm mt-1">{employee.name}</p>
            )}
          </div>
        )}

        {/* ── PIN entry screen ──────────────────────────────────────── */}
        {step === 'pin' && (
          <>
            <h3 className="text-lg font-bold mb-1 text-center text-white">Clock In / Out</h3>
            <p className="text-gray-400 text-sm text-center mb-4">Enter your 4-digit PIN</p>

            {/* PIN dots */}
            <div className="flex justify-center mb-4">
              <div className="flex gap-3">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full transition-colors ${
                      i < pin.length ? 'bg-blue-500' : 'bg-gray-600'
                    }`}
                  />
                ))}
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center mb-3">{error}</p>
            )}

            {/* Number pad — large touch targets */}
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                <button
                  key={n}
                  onClick={() => handlePinDigit(String(n))}
                  disabled={loading || pin.length >= 4}
                  className="py-5 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl text-xl font-bold transition-colors disabled:opacity-40 min-h-[56px]"
                >
                  {n}
                </button>
              ))}
              <button
                onClick={onClose}
                className="py-5 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl text-sm font-medium transition-colors text-gray-400 min-h-[56px]"
              >
                Cancel
              </button>
              <button
                onClick={() => handlePinDigit('0')}
                disabled={loading || pin.length >= 4}
                className="py-5 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl text-xl font-bold transition-colors disabled:opacity-40 min-h-[56px]"
              >
                0
              </button>
              <button
                onClick={handleDelete}
                disabled={loading || pin.length === 0}
                className="py-5 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl text-sm font-medium transition-colors text-gray-400 disabled:opacity-40 min-h-[56px]"
              >
                Del
              </button>
            </div>

            {loading && (
              <p className="text-gray-400 text-sm text-center mt-3">Verifying...</p>
            )}
          </>
        )}

        {/* ── Status / action screen ────────────────────────────────── */}
        {step === 'status' && employee && (
          <>
            <h3 className="text-lg font-bold mb-1 text-center text-white">{employee.name}</h3>
            <p className="text-gray-400 text-sm text-center mb-1 capitalize">{employee.role}</p>

            {/* Current status badge */}
            <div className="text-center mb-4">
              {clockStatus?.clockedIn ? (
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                  clockStatus.onBreak
                    ? 'bg-amber-600/30 text-amber-300'
                    : 'bg-green-600/30 text-green-300'
                }`}>
                  {clockStatus.onBreak ? 'On Break' : 'Clocked In'}
                </span>
              ) : (
                <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-gray-600/30 text-gray-300">
                  Clocked Out
                </span>
              )}
            </div>

            {/* Elapsed timer when clocked in */}
            {clockStatus?.clockedIn && elapsed && (
              <div className="text-center mb-4">
                <div className="text-4xl font-mono font-bold text-green-400">{elapsed}</div>
                {clockStatus.clockInTime && (
                  <p className="text-gray-500 text-xs mt-1">
                    Since {new Date(clockStatus.clockInTime).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="text-red-400 text-sm text-center mb-3">{error}</p>
            )}

            {/* Action buttons */}
            <div className="space-y-2">
              {!clockStatus?.clockedIn ? (
                <button
                  onClick={() => performAction('clock_in')}
                  disabled={loading}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:opacity-50 rounded-xl font-semibold text-lg transition-colors min-h-[56px] text-white"
                >
                  {loading ? 'Clocking In...' : 'Clock In'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => performAction('clock_out')}
                    disabled={loading}
                    className="w-full py-4 bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-50 rounded-xl font-semibold text-lg transition-colors min-h-[56px] text-white"
                  >
                    {loading ? 'Clocking Out...' : 'Clock Out'}
                  </button>
                  {!clockStatus.onBreak ? (
                    <button
                      onClick={() => performAction('start_break')}
                      disabled={loading}
                      className="w-full py-4 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 disabled:opacity-50 rounded-xl font-semibold text-lg transition-colors min-h-[56px] text-white"
                    >
                      {loading ? 'Starting...' : 'Start Break'}
                    </button>
                  ) : (
                    <button
                      onClick={() => performAction('end_break')}
                      disabled={loading}
                      className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 rounded-xl font-semibold text-lg transition-colors min-h-[56px] text-white"
                    >
                      {loading ? 'Ending...' : 'End Break'}
                    </button>
                  )}
                </>
              )}
              <button
                onClick={onClose}
                className="w-full py-3 text-gray-400 hover:text-white text-sm transition-colors min-h-[48px]"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
