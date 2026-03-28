'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'

// ── Types ────────────────────────────────────────────────────────────────────

interface ManagerPinElevationModalProps {
  isOpen: boolean
  onClose: () => void
  onAuthorized: (employeeId: string, employeeName: string) => void
  action: string
  actionLabel: string
}

// ── Numpad digits layout ─────────────────────────────────────────────────────

const NUMPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'back'],
]

// ── Component ────────────────────────────────────────────────────────────────

export function ManagerPinElevationModal({
  isOpen,
  onClose,
  onAuthorized,
  action,
  actionLabel,
}: ManagerPinElevationModalProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const submitInFlight = useRef(false)
  const maxAttempts = 5

  const locationId = useAuthStore((s) => s.locationId)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPin('')
      setError(null)
      setAttempts(0)
      setIsVerifying(false)
      submitInFlight.current = false
    }
  }, [isOpen])

  // ── Submit PIN to verify-manager-pin endpoint ────────────────────────────
  const submitPin = useCallback(
    async (enteredPin: string) => {
      if (submitInFlight.current) return
      if (!locationId) {
        setError('No location context. Please log in again.')
        return
      }
      if (attempts >= maxAttempts) {
        setError('Too many failed attempts. Please try again later.')
        return
      }

      submitInFlight.current = true
      setIsVerifying(true)
      setError(null)

      try {
        const res = await fetch('/api/auth/verify-manager-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: enteredPin, action, locationId }),
        })

        const data = await res.json()

        if (res.ok && data.authorized) {
          onAuthorized(data.employeeId, data.employeeName)
          // Don't call onClose here -- the consumer's onAuthorized
          // callback is responsible for closing via the hook's resolve
        } else {
          const newAttempts = attempts + 1
          setAttempts(newAttempts)
          setPin('')

          if (res.status === 429) {
            setError('Too many attempts. Try again later.')
          } else if (res.status === 403) {
            setError(data.error || 'This employee does not have permission for this action')
          } else if (newAttempts >= maxAttempts) {
            setError('Too many failed attempts. Please try again later.')
            setTimeout(onClose, 2000)
          } else {
            setError(
              data.error ||
                `Invalid PIN (${maxAttempts - newAttempts} ${maxAttempts - newAttempts === 1 ? 'attempt' : 'attempts'} remaining)`
            )
          }
        }
      } catch (err) {
        console.error('[ManagerPinElevationModal] Verification error:', err)
        setError('Failed to verify PIN. Please try again.')
        setPin('')
      } finally {
        setIsVerifying(false)
        submitInFlight.current = false
      }
    },
    [action, locationId, attempts, maxAttempts, onAuthorized, onClose]
  )

  // ── Numpad handler ──────────────────────────────────────────────────────
  const handleDigit = useCallback(
    (digit: string) => {
      if (isVerifying) return

      setPin((prev) => {
        if (prev.length >= 4) return prev
        const next = prev + digit

        // Auto-submit on 4 digits
        if (next.length === 4) {
          // Use setTimeout to let state update first
          setTimeout(() => submitPin(next), 0)
        }

        return next
      })
    },
    [isVerifying, submitPin]
  )

  const handleClear = useCallback(() => {
    if (isVerifying) return
    setPin('')
    setError(null)
  }, [isVerifying])

  const handleBackspace = useCallback(() => {
    if (isVerifying) return
    setPin((prev) => prev.slice(0, -1))
    setError(null)
  }, [isVerifying])

  // ── Keyboard support ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isVerifying) return

      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key)
      } else if (e.key === 'Backspace') {
        handleBackspace()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isVerifying, handleDigit, handleBackspace])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manager Authorization Required" size="sm">
      <div className="flex flex-col items-center">
        {/* Action label */}
        <p className="text-sm text-gray-600 text-center mb-6">{actionLabel}</p>

        {/* PIN dots display */}
        <div className="flex gap-3 mb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all duration-150 ${
                i < pin.length
                  ? 'bg-indigo-600 scale-110'
                  : 'bg-gray-200 border-2 border-gray-300'
              }`}
            />
          ))}
        </div>

        {/* Error message */}
        {error && (
          <p className="text-sm text-red-500 text-center mt-1 mb-2 min-h-[20px]">
            {error}
          </p>
        )}
        {!error && <div className="min-h-[20px] mt-1 mb-2" />}

        {/* Verifying indicator */}
        {isVerifying && (
          <p className="text-sm text-indigo-600 text-center mb-2">Verifying...</p>
        )}

        {/* Numpad grid */}
        <div className="grid grid-cols-3 gap-2 w-full max-w-[280px]">
          {NUMPAD_ROWS.map((row, rowIdx) =>
            row.map((key) => {
              if (key === 'clear') {
                return (
                  <button
                    key={`${rowIdx}-clear`}
                    type="button"
                    onClick={handleClear}
                    disabled={isVerifying}
                    className="h-14 rounded-xl bg-gray-100 text-gray-900 text-sm font-medium
                      hover:bg-gray-200 active:bg-gray-300 active:scale-95
                      transition-all disabled:opacity-40 disabled:pointer-events-none
                      touch-manipulation"
                  >
                    Clear
                  </button>
                )
              }

              if (key === 'back') {
                return (
                  <button
                    key={`${rowIdx}-back`}
                    type="button"
                    onClick={handleBackspace}
                    disabled={isVerifying}
                    className="h-14 rounded-xl bg-gray-100 text-gray-900
                      hover:bg-gray-200 active:bg-gray-300 active:scale-95
                      transition-all disabled:opacity-40 disabled:pointer-events-none
                      flex items-center justify-center touch-manipulation"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"
                      />
                    </svg>
                  </button>
                )
              }

              // Digit button
              return (
                <button
                  key={`${rowIdx}-${key}`}
                  type="button"
                  onClick={() => handleDigit(key)}
                  disabled={isVerifying || pin.length >= 4}
                  className="h-14 rounded-xl bg-white border border-gray-200 text-gray-900
                    text-xl font-semibold
                    hover:bg-gray-50 active:bg-indigo-50 active:border-indigo-300 active:scale-95
                    transition-all disabled:opacity-40 disabled:pointer-events-none
                    shadow-sm touch-manipulation"
                >
                  {key}
                </button>
              )
            })
          )}
        </div>

        {/* Cancel button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isVerifying}
          className="mt-4 w-full max-w-[280px] py-2.5 rounded-xl text-sm font-medium
            text-gray-900 bg-gray-100 hover:bg-gray-200 active:bg-gray-300
            transition-all disabled:opacity-40 touch-manipulation"
        >
          Cancel
        </button>
      </div>
    </Modal>
  )
}

// ── Identity-only PIN verification modal ────────────────────────────────────
// Uses /api/auth/verify-pin (no action-based permission check).
// For permission-gated actions, prefer ManagerPinElevationModal above.

interface ManagerPinModalProps {
  isOpen: boolean
  onClose: () => void
  onVerified: (managerId: string, managerName: string) => void
  title?: string
  message?: string
  locationId: string
  employeeId?: string
}

export function ManagerPinModal({
  isOpen,
  onClose,
  onVerified,
  title = 'Manager Authorization Required',
  message = 'Enter manager PIN to continue',
  locationId,
  employeeId,
}: ManagerPinModalProps) {
  const [pin, setPin] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const maxAttempts = 3

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPin('')
      setAttempts(0)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (pin.length < 4) {
      toast.error('PIN must be at least 4 digits')
      return
    }

    if (attempts >= maxAttempts) {
      toast.error('Too many failed attempts')
      onClose()
      return
    }

    setIsVerifying(true)
    try {
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, locationId, ...(employeeId ? { employeeId } : {}) }),
      })

      if (res.ok) {
        const raw = await res.json()
        const data = raw.data ?? raw
        const managerName = `${data.employee.firstName} ${data.employee.lastName}`
        toast.success(`Authorized by ${managerName}`)
        onVerified(data.employee.id, managerName)
        onClose()
      } else {
        const { error } = await res.json()
        setAttempts((prev) => prev + 1)
        toast.error(error || 'Invalid PIN')
        setPin('')

        if (attempts + 1 >= maxAttempts) {
          toast.error('Too many failed attempts. Please try again later.')
          setTimeout(onClose, 2000)
        }
      }
    } catch (error) {
      console.error('PIN verification error:', error)
      toast.error('Failed to verify PIN')
    } finally {
      setIsVerifying(false)
    }
  }

  const handlePinChange = (value: string) => {
    // Only allow digits
    const digitsOnly = value.replace(/\D/g, '')
    setPin(digitsOnly.slice(0, 6)) // Max 6 digits
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
        <p className="text-sm text-gray-900 mb-6">{message}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">Manager PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => handlePinChange(e.target.value)}
              placeholder="Enter 4-6 digit PIN"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-lg tracking-widest text-center focus:outline-none focus:border-indigo-500"
              autoFocus
              disabled={isVerifying}
            />
          </div>

          {attempts > 0 && attempts < maxAttempts && (
            <p className="text-sm text-red-400">
              {maxAttempts - attempts} {maxAttempts - attempts === 1 ? 'attempt' : 'attempts'} remaining
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isVerifying}
              className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isVerifying || pin.length < 4}
              className="flex-1 px-4 py-2 bg-indigo-600 rounded-lg text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isVerifying ? 'Verifying...' : 'Verify'}
            </button>
          </div>
        </form>
    </Modal>
  )
}
