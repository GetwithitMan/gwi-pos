'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface ShiftSummary {
  totalSales: number
  cashSales: number
  cardSales: number
  totalTips: number
  cashReceived: number
  changeGiven: number
  netCashReceived: number
  orderCount: number
  paymentCount: number
  voidCount: number
  compCount: number
}

interface ShiftData {
  id: string
  startedAt: string
  startingCash: number
  employee: {
    id: string
    name: string
  }
}

interface ShiftCloseoutModalProps {
  isOpen: boolean
  onClose: () => void
  shift: ShiftData
  onCloseoutComplete: (result: {
    variance: number
    summary: ShiftSummary
  }) => void
}

// Denomination structure for cash counting
const DENOMINATIONS = [
  { label: '$100', value: 100 },
  { label: '$50', value: 50 },
  { label: '$20', value: 20 },
  { label: '$10', value: 10 },
  { label: '$5', value: 5 },
  { label: '$1', value: 1 },
  { label: '25¢', value: 0.25 },
  { label: '10¢', value: 0.10 },
  { label: '5¢', value: 0.05 },
  { label: '1¢', value: 0.01 },
]

export function ShiftCloseoutModal({
  isOpen,
  onClose,
  shift,
  onCloseoutComplete,
}: ShiftCloseoutModalProps) {
  const [step, setStep] = useState<'summary' | 'count' | 'confirm' | 'complete'>('summary')
  const [isLoading, setIsLoading] = useState(true)
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Cash count state
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [manualTotal, setManualTotal] = useState<string>('')
  const [useManual, setUseManual] = useState(false)
  const [tipsDeclared, setTipsDeclared] = useState<string>('')
  const [notes, setNotes] = useState('')

  // Closeout result
  const [closeoutResult, setCloseoutResult] = useState<{
    variance: number
    expectedCash: number
    actualCash: number
    message: string
  } | null>(null)

  // Calculate total from denomination counts
  const countedTotal = Object.entries(counts).reduce(
    (sum, [denom, count]) => sum + parseFloat(denom) * count,
    0
  )

  const actualCash = useManual ? parseFloat(manualTotal) || 0 : countedTotal
  const expectedCash = (shift?.startingCash || 0) + (summary?.netCashReceived || 0)
  const variance = actualCash - expectedCash

  // Fetch shift summary on open
  useEffect(() => {
    if (isOpen && shift?.id) {
      fetchShiftSummary()
    }
  }, [isOpen, shift?.id])

  const fetchShiftSummary = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/shifts/${shift.id}`)
      if (!response.ok) throw new Error('Failed to fetch shift summary')
      const data = await response.json()
      setSummary(data.summary)
      setTipsDeclared(data.summary.totalTips.toFixed(2))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shift data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCountChange = (denom: number, value: string) => {
    const count = parseInt(value) || 0
    setCounts(prev => ({ ...prev, [denom]: count }))
  }

  const handleCloseShift = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/shifts/${shift.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'close',
          actualCash,
          tipsDeclared: parseFloat(tipsDeclared) || 0,
          notes,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to close shift')
      }

      const data = await response.json()
      setCloseoutResult({
        variance: data.shift.variance,
        expectedCash: data.shift.expectedCash,
        actualCash: data.shift.actualCash,
        message: data.message,
      })
      setStep('complete')
      onCloseoutComplete({
        variance: data.shift.variance,
        summary: data.summary,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close shift')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const formatDuration = (startTime: string) => {
    const start = new Date(startTime)
    const now = new Date()
    const diff = now.getTime() - start.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Close Out Shift</h2>
              <p className="text-sm text-gray-500">
                {shift.employee.name} • Started {formatTime(shift.startedAt)} ({formatDuration(shift.startedAt)})
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {isLoading && step !== 'complete' ? (
            <div className="text-center py-8 text-gray-500">Loading shift data...</div>
          ) : (
            <>
              {/* Step 1: Summary */}
              {step === 'summary' && summary && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Shift Summary</h3>

                  <div className="grid grid-cols-2 gap-4">
                    <Card className="p-4">
                      <div className="text-sm text-gray-500">Total Sales</div>
                      <div className="text-2xl font-bold">{formatCurrency(summary.totalSales)}</div>
                    </Card>
                    <Card className="p-4">
                      <div className="text-sm text-gray-500">Orders</div>
                      <div className="text-2xl font-bold">{summary.orderCount}</div>
                    </Card>
                  </div>

                  <Card className="p-4">
                    <div className="text-sm font-medium mb-2">Payment Breakdown</div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Cash Sales</span>
                        <span className="font-medium">{formatCurrency(summary.cashSales)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Card Sales</span>
                        <span className="font-medium">{formatCurrency(summary.cardSales)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-gray-600">Tips Collected</span>
                        <span className="font-medium">{formatCurrency(summary.totalTips)}</span>
                      </div>
                    </div>
                  </Card>

                  <Card className="p-4 bg-blue-50">
                    <div className="text-sm font-medium mb-2">Cash Drawer</div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Starting Cash</span>
                        <span className="font-medium">{formatCurrency(shift.startingCash)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Cash Received</span>
                        <span className="font-medium text-green-600">+{formatCurrency(summary.cashReceived)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Change Given</span>
                        <span className="font-medium text-red-600">-{formatCurrency(summary.changeGiven)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2 font-bold">
                        <span>Expected in Drawer</span>
                        <span>{formatCurrency(expectedCash)}</span>
                      </div>
                    </div>
                  </Card>

                  {(summary.voidCount > 0 || summary.compCount > 0) && (
                    <Card className="p-4 bg-yellow-50">
                      <div className="text-sm font-medium mb-2">Adjustments</div>
                      <div className="space-y-1">
                        {summary.voidCount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Voids</span>
                            <span>{summary.voidCount}</span>
                          </div>
                        )}
                        {summary.compCount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Comps</span>
                            <span>{summary.compCount}</span>
                          </div>
                        )}
                      </div>
                    </Card>
                  )}

                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => setStep('count')}
                  >
                    Count Drawer →
                  </Button>
                </div>
              )}

              {/* Step 2: Cash Count */}
              {step === 'count' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">Count Your Drawer</h3>
                    <button
                      className="text-sm text-blue-600 hover:underline"
                      onClick={() => setUseManual(!useManual)}
                    >
                      {useManual ? 'Count by denomination' : 'Enter total manually'}
                    </button>
                  </div>

                  {useManual ? (
                    <div>
                      <label className="block text-sm text-gray-600 mb-2">
                        Enter total cash in drawer
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-3 text-gray-500 text-xl">$</span>
                        <input
                          type="number"
                          value={manualTotal}
                          onChange={(e) => setManualTotal(e.target.value)}
                          className="w-full pl-8 pr-4 py-3 text-2xl border rounded-lg"
                          placeholder="0.00"
                          step="0.01"
                          min="0"
                          autoFocus
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {DENOMINATIONS.map(({ label, value }) => (
                        <div key={value} className="flex items-center gap-2">
                          <span className="w-12 text-right font-medium">{label}</span>
                          <span className="text-gray-400">×</span>
                          <input
                            type="number"
                            min="0"
                            value={counts[value] || ''}
                            onChange={(e) => handleCountChange(value, e.target.value)}
                            className="w-20 px-2 py-1 border rounded text-center"
                            placeholder="0"
                          />
                          <span className="text-gray-500 text-sm">
                            = {formatCurrency((counts[value] || 0) * value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <Card className={`p-4 ${variance === 0 ? 'bg-green-50' : variance > 0 ? 'bg-yellow-50' : 'bg-red-50'}`}>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-sm text-gray-500">Expected</div>
                        <div className="text-lg font-bold">{formatCurrency(expectedCash)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Counted</div>
                        <div className="text-lg font-bold">{formatCurrency(actualCash)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Variance</div>
                        <div className={`text-lg font-bold ${variance === 0 ? 'text-green-600' : variance > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                        </div>
                      </div>
                    </div>
                  </Card>

                  <div>
                    <label className="block text-sm text-gray-600 mb-2">
                      Tips to Declare
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        value={tipsDeclared}
                        onChange={(e) => setTipsDeclared(e.target.value)}
                        className="w-full pl-8 pr-4 py-2 border rounded-lg"
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 mb-2">
                      Notes (optional)
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg"
                      rows={2}
                      placeholder="Any notes about the shift..."
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setStep('summary')}
                    >
                      ← Back
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={() => setStep('confirm')}
                      disabled={actualCash === 0}
                    >
                      Review & Close
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 3: Confirm */}
              {step === 'confirm' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Confirm Closeout</h3>

                  <Card className={`p-4 ${variance === 0 ? 'bg-green-50 border-green-200' : variance > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="text-center mb-4">
                      {variance === 0 ? (
                        <div className="text-green-600">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="font-bold">Drawer is Balanced!</p>
                        </div>
                      ) : variance > 0 ? (
                        <div className="text-yellow-600">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <p className="font-bold">Drawer is OVER by {formatCurrency(variance)}</p>
                        </div>
                      ) : (
                        <div className="text-red-600">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="font-bold">Drawer is SHORT by {formatCurrency(Math.abs(variance))}</p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Expected Cash</span>
                        <span className="font-medium">{formatCurrency(expectedCash)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Actual Count</span>
                        <span className="font-medium">{formatCurrency(actualCash)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Tips Declared</span>
                        <span className="font-medium">{formatCurrency(parseFloat(tipsDeclared) || 0)}</span>
                      </div>
                    </div>
                  </Card>

                  <p className="text-sm text-gray-500 text-center">
                    This action cannot be undone. Make sure your count is correct.
                  </p>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setStep('count')}
                    >
                      ← Recount
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={handleCloseShift}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Closing...' : 'Close Shift'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Complete */}
              {step === 'complete' && closeoutResult && (
                <div className="space-y-4 text-center py-8">
                  <div className={`${closeoutResult.variance === 0 ? 'text-green-600' : closeoutResult.variance > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>

                  <h3 className="text-2xl font-bold">Shift Closed</h3>
                  <p className="text-gray-600">{closeoutResult.message}</p>

                  <Card className="p-4 text-left">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Expected Cash</span>
                        <span className="font-medium">{formatCurrency(closeoutResult.expectedCash)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Actual Cash</span>
                        <span className="font-medium">{formatCurrency(closeoutResult.actualCash)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="font-medium">Variance</span>
                        <span className={`font-bold ${closeoutResult.variance === 0 ? 'text-green-600' : closeoutResult.variance > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {closeoutResult.variance >= 0 ? '+' : ''}{formatCurrency(closeoutResult.variance)}
                        </span>
                      </div>
                    </div>
                  </Card>

                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={onClose}
                  >
                    Done
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
