'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

interface ShiftStartModalProps {
  isOpen: boolean
  onClose: () => void
  employeeId: string
  employeeName: string
  locationId: string
  onShiftStarted: (shiftId: string) => void
}

// Quick amount buttons
const QUICK_AMOUNTS = [100, 150, 200, 250, 300]

export function ShiftStartModal({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  locationId,
  onShiftStarted,
}: ShiftStartModalProps) {
  const [startingCash, setStartingCash] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStartShift = async () => {
    const amount = parseFloat(startingCash)
    if (isNaN(amount) || amount < 0) {
      setError('Please enter a valid starting cash amount')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId,
          startingCash: amount,
          notes: notes || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start shift')
      }

      const data = await response.json()
      onShiftStarted(data.shift.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start shift')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50">
          <h2 className="text-xl font-bold">Start Your Shift</h2>
          <p className="text-sm text-gray-500">{employeeName}</p>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Starting Cash in Drawer
            </label>
            <div className="relative">
              <span className="absolute left-3 top-3 text-gray-500 text-xl">$</span>
              <input
                type="number"
                value={startingCash}
                onChange={(e) => setStartingCash(e.target.value)}
                className="w-full pl-8 pr-4 py-3 text-2xl border rounded-lg"
                placeholder="0.00"
                step="0.01"
                min="0"
                autoFocus
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map(amount => (
              <Button
                key={amount}
                variant={parseFloat(startingCash) === amount ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setStartingCash(amount.toString())}
              >
                {formatCurrency(amount)}
              </Button>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              rows={2}
              placeholder="Any notes about starting the shift..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleStartShift}
            disabled={isLoading || !startingCash}
          >
            {isLoading ? 'Starting...' : 'Start Shift'}
          </Button>
        </div>
      </div>
    </div>
  )
}
