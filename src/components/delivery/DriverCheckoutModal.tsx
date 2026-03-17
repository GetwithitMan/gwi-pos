'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'

// ── Types ────────────────────────────────────────────────────────────────────

interface CheckoutPreview {
  sessionId: string
  driverId: string
  employeeId: string
  deliveryCount: number
  cashCollectedCents: number
  cashDroppedCents: number
  expectedCashCents: number
  cashOnHandCents: number
  varianceCents: number
  estimatedTipsCents: number
  startingBankCents: number
  mileage: {
    startOdometer: number
    reimbursementRate: number
  } | null
  sessionDurationMinutes: number
  startedAt: string
}

interface DriverCheckoutModalProps {
  isOpen: boolean
  onClose: () => void
  sessionId: string
  driverName: string
  onCheckoutComplete: () => void
}

// ── Numpad for Manager PIN ──────────────────────────────────────────────────

const NUMPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'back'],
]

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// ── Component ───────────────────────────────────────────────────────────────

export function DriverCheckoutModal({
  isOpen,
  onClose,
  sessionId,
  driverName,
  onCheckoutComplete,
}: DriverCheckoutModalProps) {
  const locationId = useAuthStore(s => s.locationId)

  // Preview data
  const [preview, setPreview] = useState<CheckoutPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Form inputs
  const [cashTipsDollars, setCashTipsDollars] = useState('')
  const [endOdometer, setEndOdometer] = useState('')

  // Manager PIN (for cash variance override)
  const [managerPin, setManagerPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinAttempts, setPinAttempts] = useState(0)

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitInFlight = useRef(false)

  // ── Derived: does variance require manager approval? ─────────────────────
  const varianceCents = preview?.varianceCents ?? 0
  const needsManagerApproval = varianceCents < 0

  // ── Mileage calculation ──────────────────────────────────────────────────
  const startOdometer = preview?.mileage?.startOdometer ?? null
  const endOdometerNum = endOdometer ? parseFloat(endOdometer) : null
  const mileage = startOdometer != null && endOdometerNum != null && endOdometerNum > startOdometer
    ? endOdometerNum - startOdometer
    : null

  // ── Fetch preview on open ────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !sessionId) return

    // Reset state
    setPreview(null)
    setPreviewError(null)
    setLoadingPreview(true)
    setCashTipsDollars('')
    setEndOdometer('')
    setManagerPin('')
    setPinError(null)
    setPinAttempts(0)
    submitInFlight.current = false

    async function fetchPreview() {
      try {
        const res = await fetch(`/api/delivery/sessions/${sessionId}/checkout/preview`)
        const json = await res.json()
        if (!res.ok) {
          setPreviewError(json.error || 'Failed to load checkout preview')
          return
        }
        setPreview(json.preview)
      } catch {
        setPreviewError('Failed to load checkout preview')
      } finally {
        setLoadingPreview(false)
      }
    }

    void fetchPreview()
  }, [isOpen, sessionId])

  // ── Manager PIN verification ─────────────────────────────────────────────

  const verifyManagerPin = useCallback(
    async (enteredPin: string): Promise<string | null> => {
      if (!locationId) {
        setPinError('No location context')
        return null
      }
      try {
        const res = await fetch('/api/auth/verify-manager-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pin: enteredPin,
            action: 'cash_variance_override',
            locationId,
          }),
        })
        const data = await res.json()
        if (res.ok && data.authorized) {
          setPinError(null)
          return data.employeeId as string
        }
        const newAttempts = pinAttempts + 1
        setPinAttempts(newAttempts)
        if (res.status === 429) {
          setPinError('Too many attempts. Try again later.')
        } else if (res.status === 403) {
          setPinError(data.error || 'Insufficient permissions')
        } else {
          setPinError(data.error || 'Invalid PIN')
        }
        setManagerPin('')
        return null
      } catch {
        setPinError('Failed to verify PIN')
        setManagerPin('')
        return null
      }
    },
    [locationId, pinAttempts],
  )

  // ── Submit checkout ──────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (submitInFlight.current || !preview) return
    submitInFlight.current = true
    setIsSubmitting(true)

    try {
      // Convert tips to cents
      const tipsDollars = parseFloat(cashTipsDollars || '0')
      if (isNaN(tipsDollars) || tipsDollars < 0) {
        toast.error('Enter a valid cash tips amount')
        return
      }
      const cashTipsDeclaredCents = Math.round(tipsDollars * 100)

      // Build body
      const body: Record<string, unknown> = {
        cashTipsDeclaredCents,
      }

      // End odometer
      if (endOdometer) {
        const odo = parseFloat(endOdometer)
        if (isNaN(odo) || odo <= 0) {
          toast.error('Enter a valid odometer reading')
          return
        }
        body.endOdometer = odo
      }

      // Manager override: verify PIN and get employeeId
      if (needsManagerApproval) {
        if (!managerPin || managerPin.length < 4) {
          setPinError('Enter manager PIN to approve cash shortage')
          return
        }
        const managerId = await verifyManagerPin(managerPin)
        if (!managerId) {
          // pinError already set by verifyManagerPin
          return
        }
        body.managerOverrideEmployeeId = managerId
      }

      // POST checkout
      const res = await fetch(`/api/delivery/sessions/${sessionId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const json = await res.json()

      if (!res.ok) {
        if (json.requiresManagerOverride) {
          setPinError('Cash variance requires manager approval')
          return
        }
        toast.error(json.error || 'Checkout failed')
        return
      }

      toast.success(`Shift ended for ${driverName}`)
      onCheckoutComplete()
      onClose()
    } catch {
      toast.error('Failed to process checkout')
    } finally {
      setIsSubmitting(false)
      submitInFlight.current = false
    }
  }, [
    preview, cashTipsDollars, endOdometer, needsManagerApproval,
    managerPin, verifyManagerPin, sessionId, driverName,
    onCheckoutComplete, onClose,
  ])

  // ── PIN numpad handler ───────────────────────────────────────────────────

  const handlePinDigit = useCallback((digit: string) => {
    setManagerPin(prev => {
      if (prev.length >= 4) return prev
      return prev + digit
    })
    setPinError(null)
  }, [])

  const handlePinClear = useCallback(() => {
    setManagerPin('')
    setPinError(null)
  }, [])

  const handlePinBackspace = useCallback(() => {
    setManagerPin(prev => prev.slice(0, -1))
    setPinError(null)
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`End Driver Shift — ${driverName}`}
      size="md"
    >
      {/* Loading state */}
      {loadingPreview && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto mb-3" />
            <p className="text-sm text-gray-500">Loading checkout data...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {previewError && !loadingPreview && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <p className="text-sm text-red-600 mb-3">{previewError}</p>
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}

      {/* Loaded state */}
      {preview && !loadingPreview && (
        <div className="space-y-5">
          {/* ── Shift Summary ─────────────────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Shift Summary</h3>
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-1.5">
              <SummaryRow label="Started" value={formatTime(preview.startedAt)} />
              <SummaryRow label="Duration" value={formatDuration(preview.sessionDurationMinutes)} />
              <SummaryRow label="Deliveries" value={String(preview.deliveryCount)} />
              {mileage != null && (
                <SummaryRow label="Mileage" value={`${mileage.toFixed(1)} mi`} />
              )}
              {startOdometer != null && endOdometerNum == null && (
                <SummaryRow label="Start Odometer" value={`${startOdometer.toFixed(1)} mi`} />
              )}
            </div>
          </div>

          {/* ── Cash Reconciliation ───────────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Cash Reconciliation</h3>
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-1.5">
              <SummaryRow label="Starting Bank" value={formatCents(preview.startingBankCents)} />
              <SummaryRow label="Cash Collected" value={formatCents(preview.cashCollectedCents)} />
              <SummaryRow label="Cash Dropped" value={formatCents(preview.cashDroppedCents)} />
              <div className="border-t border-gray-200 my-1.5" />
              <SummaryRow
                label="Expected in Hand"
                value={formatCents(preview.startingBankCents + preview.cashCollectedCents - preview.cashDroppedCents)}
                bold
              />
              <SummaryRow
                label="Variance"
                value={`${varianceCents < 0 ? '-' : ''}${formatCents(Math.abs(varianceCents))}`}
                valueClassName={
                  varianceCents < 0
                    ? 'text-red-600 font-semibold'
                    : varianceCents > 0
                      ? 'text-green-600 font-semibold'
                      : 'text-gray-900'
                }
                warn={varianceCents < 0}
              />
            </div>
          </div>

          {/* ── Cash Tips Declared ────────────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Cash Tips Declared</h3>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={cashTipsDollars}
                onChange={e => setCashTipsDollars(e.target.value)}
                placeholder="0.00"
                className="w-full pl-7 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            {preview.estimatedTipsCents > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                Estimated tips from orders: {formatCents(preview.estimatedTipsCents)}
              </p>
            )}
          </div>

          {/* ── End Odometer ──────────────────────────────────────────── */}
          {preview.mileage && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                End Odometer <span className="font-normal text-gray-400">(optional)</span>
              </h3>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={preview.mileage.startOdometer}
                  value={endOdometer}
                  onChange={e => setEndOdometer(e.target.value)}
                  placeholder={`Start: ${preview.mileage.startOdometer.toFixed(1)}`}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 pr-14"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">miles</span>
              </div>
              {mileage != null && preview.mileage.reimbursementRate > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  Reimbursement: {mileage.toFixed(1)} mi x ${preview.mileage.reimbursementRate.toFixed(2)}/mi = ${(mileage * preview.mileage.reimbursementRate).toFixed(2)}
                </p>
              )}
            </div>
          )}

          {/* ── Cash Shortage Warning + Manager PIN ──────────────────── */}
          {needsManagerApproval && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2 mb-3">
                <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    Cash shortage requires manager approval.
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Variance: {formatCents(Math.abs(varianceCents))} short
                  </p>
                </div>
              </div>

              <label className="block text-xs font-medium text-amber-800 mb-1.5">Manager PIN</label>

              {/* PIN dots display */}
              <div className="flex gap-2 mb-2 justify-center">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                      i < managerPin.length
                        ? 'bg-amber-600 scale-110'
                        : 'bg-amber-200 border-2 border-amber-300'
                    }`}
                  />
                ))}
              </div>

              {/* PIN error */}
              {pinError && (
                <p className="text-xs text-red-600 text-center mb-2">{pinError}</p>
              )}

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-1.5 max-w-[220px] mx-auto">
                {NUMPAD_ROWS.map((row, rowIdx) =>
                  row.map(key => {
                    if (key === 'clear') {
                      return (
                        <button
                          key={`${rowIdx}-clear`}
                          type="button"
                          onClick={handlePinClear}
                          disabled={isSubmitting}
                          className="h-10 rounded-lg bg-amber-100 text-amber-800 text-xs font-medium hover:bg-amber-200 active:bg-amber-300 active:scale-95 transition-all disabled:opacity-40 touch-manipulation"
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
                          onClick={handlePinBackspace}
                          disabled={isSubmitting}
                          className="h-10 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 active:bg-amber-300 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center touch-manipulation"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                          </svg>
                        </button>
                      )
                    }
                    return (
                      <button
                        key={`${rowIdx}-${key}`}
                        type="button"
                        onClick={() => handlePinDigit(key)}
                        disabled={isSubmitting || managerPin.length >= 4}
                        className="h-10 rounded-lg bg-white border border-amber-200 text-amber-900 text-base font-semibold hover:bg-amber-50 active:bg-amber-100 active:scale-95 transition-all disabled:opacity-40 shadow-sm touch-manipulation"
                      >
                        {key}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* ── Action Buttons ────────────────────────────────────────── */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || (needsManagerApproval && managerPin.length < 4)}
              isLoading={isSubmitting}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              End Shift
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Summary Row ─────────────────────────────────────────────────────────────

function SummaryRow({
  label,
  value,
  bold,
  valueClassName,
  warn,
}: {
  label: string
  value: string
  bold?: boolean
  valueClassName?: string
  warn?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={`text-gray-500 ${bold ? 'font-medium' : ''}`}>
        {warn && (
          <svg className="w-4 h-4 text-amber-500 inline mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        )}
        {label}:
      </span>
      <span className={valueClassName || (bold ? 'font-semibold text-gray-900' : 'text-gray-900')}>
        {value}
      </span>
    </div>
  )
}
