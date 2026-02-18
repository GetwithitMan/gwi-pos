'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'

interface DrawerOption {
  id: string
  name: string
  deviceId: string | null
  isAvailable: boolean
  claimedBy: {
    employeeName: string
  } | null
}

interface ShiftStartModalProps {
  isOpen: boolean
  onClose: () => void
  employeeId: string
  employeeName: string
  locationId: string
  cashHandlingMode: string // "drawer" | "purse" | "none"
  workingRoleId?: string | null
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
  cashHandlingMode,
  workingRoleId,
  onShiftStarted,
}: ShiftStartModalProps) {
  const [startingCash, setStartingCash] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Drawer selection (drawer mode only)
  const [drawers, setDrawers] = useState<DrawerOption[]>([])
  const [selectedDrawerId, setSelectedDrawerId] = useState<string | null>(null)
  const [loadingDrawers, setLoadingDrawers] = useState(false)

  const mode = cashHandlingMode || 'drawer'

  // Fetch drawers for drawer mode
  const loadDrawers = useCallback(async () => {
    if (mode !== 'drawer' || !locationId) return
    setLoadingDrawers(true)
    try {
      const res = await fetch(`/api/drawers?locationId=${locationId}`)
      if (res.ok) {
        const raw = await res.json()
        const data = raw.data ?? raw
        setDrawers(data.drawers)
        // Auto-select if only one available
        const available = data.drawers.filter((d: DrawerOption) => d.isAvailable)
        if (available.length === 1) {
          setSelectedDrawerId(available[0].id)
        }
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingDrawers(false)
    }
  }, [mode, locationId])

  useEffect(() => {
    if (isOpen) {
      loadDrawers()
      setStartingCash('')
      setNotes('')
      setSelectedDrawerId(null)
      setError(null)
    }
  }, [isOpen, loadDrawers])

  // Auto-start for "none" mode
  useEffect(() => {
    if (isOpen && mode === 'none') {
      handleStartShift()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode])

  const handleStartShift = async () => {
    // Validate based on mode
    if (mode === 'drawer') {
      if (!selectedDrawerId) {
        setError('Please select a drawer')
        return
      }
      const amount = parseFloat(startingCash)
      if (isNaN(amount) || amount < 0) {
        setError('Please enter a valid starting cash amount')
        return
      }
    } else if (mode === 'purse') {
      const amount = parseFloat(startingCash)
      if (isNaN(amount) || amount < 0) {
        setError('Please enter a valid starting purse amount')
        return
      }
    }

    setIsLoading(true)
    setError(null)

    try {
      const amount = mode !== 'none' ? parseFloat(startingCash) : 0

      const response = await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId,
          startingCash: amount,
          notes: notes || undefined,
          cashHandlingMode: mode,
          ...(selectedDrawerId ? { drawerId: selectedDrawerId } : {}),
          ...(workingRoleId ? { workingRoleId } : {}),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start shift')
      }

      const raw = await response.json()
      const data = raw.data ?? raw
      onShiftStarted(data.shift.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start shift')
    } finally {
      setIsLoading(false)
    }
  }

  // "none" mode — auto-starts, show minimal loading state
  if (mode === 'none') {
    if (isLoading) {
      return (
        <Modal isOpen={isOpen} onClose={onClose} size="sm" variant="default">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Starting shift...</p>
          </div>
        </Modal>
      )
    }
    if (error) {
      return (
        <Modal isOpen={isOpen} onClose={onClose} size="sm" variant="default">
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
              {error}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" className="flex-1" onClick={handleStartShift}>
                Retry
              </Button>
            </div>
        </Modal>
      )
    }
    return null
  }

  // "purse" mode — just ask for starting cash amount
  if (mode === 'purse') {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Start Your Purse" size="md" variant="default">
          <p className="text-sm text-gray-500 -mt-3 mb-4">{employeeName}</p>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
                {error}
              </div>
            )}

            <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Starting Cash in Purse
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

          {/* Footer — NO Cancel button for purse mode */}
          <div className="pt-4 border-t mt-4">
            <Button
              variant="primary"
              className="w-full"
              onClick={handleStartShift}
              disabled={isLoading || !startingCash}
            >
              {isLoading ? 'Starting...' : 'Start Shift'}
            </Button>
          </div>
      </Modal>
    )
  }

  // "drawer" mode — select drawer + enter starting cash
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start Your Shift" size="md" variant="default">
        <p className="text-sm text-gray-500 -mt-3 mb-4">{employeeName}</p>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
              {error}
            </div>
          )}

        <div className="space-y-4">
          {/* Drawer Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Drawer
            </label>
            {loadingDrawers ? (
              <div className="text-gray-500 text-sm py-2">Loading drawers...</div>
            ) : drawers.length === 0 ? (
              <div className="text-amber-600 text-sm py-2">No drawers configured for this location.</div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {drawers.map(drawer => (
                  <button
                    key={drawer.id}
                    onClick={() => drawer.isAvailable && setSelectedDrawerId(drawer.id)}
                    disabled={!drawer.isAvailable}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                      selectedDrawerId === drawer.id
                        ? 'border-blue-500 bg-blue-50'
                        : drawer.isAvailable
                        ? 'border-gray-200 hover:border-gray-300 bg-white'
                        : 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${
                        selectedDrawerId === drawer.id ? 'text-blue-700' : 'text-gray-900'
                      }`}>
                        {drawer.name}
                      </span>
                      {!drawer.isAvailable && drawer.claimedBy && (
                        <span className="text-xs text-red-500">
                          In use by {drawer.claimedBy.employeeName}
                        </span>
                      )}
                      {drawer.isAvailable && (
                        <span className="text-xs text-green-600">Available</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Starting Cash */}
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

        {/* Footer — NO Cancel button for drawer mode */}
        <div className="pt-4 border-t mt-4">
          <Button
            variant="primary"
            className="w-full"
            onClick={handleStartShift}
            disabled={isLoading || !startingCash || !selectedDrawerId}
          >
            {isLoading ? 'Starting...' : 'Start Shift'}
          </Button>
        </div>
    </Modal>
  )
}
