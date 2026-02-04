'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'

interface TimeClockEntry {
  id: string
  employeeId: string
  employeeName: string
  hourlyRate: number | null
  clockIn: string
  clockOut: string | null
  breakMinutes: number
  isOnBreak: boolean
  regularHours: number | null
  overtimeHours: number | null
}

interface OpenTab {
  id: string
  orderNumber: number
  tabName: string | null
  tableName: string | null
  orderType: string
  total: number
  itemCount: number
}

interface Manager {
  id: string
  name: string
}

interface PendingTip {
  id: string
  amount: number
  shareType: string
  fromEmployee: string
  percentage: number | null
  createdAt: string
}

interface PendingTipsData {
  pending: {
    tips: PendingTip[]
    total: number
  }
  banked: {
    tips: PendingTip[]
    total: number
  }
  grandTotal: number
}

interface TimeClockModalProps {
  isOpen: boolean
  onClose: () => void
  employeeId: string
  employeeName: string
  locationId: string
  permissions?: string[]
}

export function TimeClockModal({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  locationId,
  permissions = [],
}: TimeClockModalProps) {
  const router = useRouter()
  const [currentEntry, setCurrentEntry] = useState<TimeClockEntry | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsedTime, setElapsedTime] = useState('')

  // Tab validation state
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [showOpenTabsWarning, setShowOpenTabsWarning] = useState(false)
  const [managers, setManagers] = useState<Manager[]>([])
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)

  // Pending tips state
  const [pendingTips, setPendingTips] = useState<PendingTipsData | null>(null)
  const [showTipsNotification, setShowTipsNotification] = useState(false)
  const [isCollectingTips, setIsCollectingTips] = useState(false)

  // Check if user can force clock out
  const canForceClockOut = hasPermission(permissions, PERMISSIONS.MGR_FORCE_CLOCK_OUT)

  useEffect(() => {
    if (isOpen) {
      loadCurrentEntry()
    }
  }, [isOpen, employeeId])

  // Update elapsed time every second
  useEffect(() => {
    if (!currentEntry || currentEntry.clockOut) return

    const updateElapsed = () => {
      const clockIn = new Date(currentEntry.clockIn)
      const now = new Date()
      const diffMs = now.getTime() - clockIn.getTime()
      const hours = Math.floor(diffMs / (1000 * 60 * 60))
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000)
      setElapsedTime(
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      )
    }

    updateElapsed()
    const interval = setInterval(updateElapsed, 1000)
    return () => clearInterval(interval)
  }, [currentEntry])

  const loadCurrentEntry = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        locationId,
        employeeId,
        openOnly: 'true',
      })
      const response = await fetch(`/api/time-clock?${params}`)
      if (response.ok) {
        const data = await response.json()
        setCurrentEntry(data.entries?.[0] || null)

        // Load pending tips
        await loadPendingTips()
      }
    } catch (err) {
      console.error('Failed to load time clock:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const loadPendingTips = async () => {
    try {
      const response = await fetch(`/api/employees/${employeeId}/tips`)
      if (response.ok) {
        const data = await response.json()
        setPendingTips(data)
        // Show notification if there are pending tips
        if (data.grandTotal > 0) {
          setShowTipsNotification(true)
        }
      }
    } catch (err) {
      console.error('Failed to load pending tips:', err)
    }
  }

  const handleCollectTips = async () => {
    setIsCollectingTips(true)
    setError(null)
    try {
      const response = await fetch(`/api/employees/${employeeId}/tips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'collect_all' }),
      })

      if (response.ok) {
        // Refresh pending tips
        await loadPendingTips()
        setShowTipsNotification(false)
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to collect tips')
      }
    } catch (err) {
      setError('Failed to collect tips')
    } finally {
      setIsCollectingTips(false)
    }
  }

  const loadManagers = async () => {
    try {
      const response = await fetch(`/api/employees?locationId=${locationId}`)
      if (response.ok) {
        const data = await response.json()
        // Filter to employees who can receive transfers (have the permission or are managers/admins)
        const eligibleManagers = (data.employees || []).filter((emp: {
          id: string
          displayName?: string
          firstName: string
          lastName: string
          role: { permissions: string[] }
        }) => {
          if (emp.id === employeeId) return false // Can't transfer to self
          const empPerms = emp.role?.permissions || []
          return hasPermission(empPerms as string[], 'manager.receive_transfers') ||
                 hasPermission(empPerms as string[], 'admin') ||
                 hasPermission(empPerms as string[], 'manager.*')
        }).map((emp: { id: string; displayName?: string; firstName: string; lastName: string }) => ({
          id: emp.id,
          name: emp.displayName || `${emp.firstName} ${emp.lastName}`,
        }))
        setManagers(eligibleManagers)
      }
    } catch (err) {
      console.error('Failed to load managers:', err)
    }
  }

  const checkOpenTabs = async (): Promise<boolean> => {
    try {
      const response = await fetch(
        `/api/employees/${employeeId}/open-tabs?locationId=${locationId}`
      )
      if (response.ok) {
        const data = await response.json()
        if (data.hasOpenTabs) {
          setOpenTabs(data.tabs)
          return true
        }
      }
      return false
    } catch (err) {
      console.error('Failed to check open tabs:', err)
      return false
    }
  }

  const handleClockIn = async () => {
    setIsProcessing(true)
    setError(null)
    try {
      const response = await fetch('/api/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, employeeId }),
      })

      if (response.ok) {
        await loadCurrentEntry()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to clock in')
      }
    } catch (err) {
      setError('Failed to clock in')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClockOutClick = async () => {
    if (!currentEntry) return

    // Check for open tabs first
    const hasOpenTabs = await checkOpenTabs()
    if (hasOpenTabs) {
      // Load managers for transfer option
      await loadManagers()
      setShowOpenTabsWarning(true)
      return
    }

    // No open tabs - proceed with clock out
    await performClockOut()
  }

  const performClockOut = async () => {
    if (!currentEntry) return
    setIsProcessing(true)
    setError(null)
    try {
      const response = await fetch('/api/time-clock', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: currentEntry.id, action: 'clockOut' }),
      })

      if (response.ok) {
        const data = await response.json()
        setCurrentEntry(data)
        setShowOpenTabsWarning(false)
      } else {
        const error = await response.json()
        setError(error.error || 'Failed to clock out')
      }
    } catch (err) {
      setError('Failed to clock out')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleTransferTabs = async () => {
    if (!selectedManagerId) {
      setError('Please select a manager to transfer tabs to')
      return
    }

    setIsTransferring(true)
    setError(null)
    try {
      const response = await fetch(`/api/employees/${employeeId}/open-tabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetEmployeeId: selectedManagerId,
          locationId,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        // After successful transfer, proceed with clock out
        await performClockOut()
      } else {
        const error = await response.json()
        setError(error.error || 'Failed to transfer tabs')
      }
    } catch (err) {
      setError('Failed to transfer tabs')
    } finally {
      setIsTransferring(false)
    }
  }

  const handleForceClockOut = async () => {
    // Only allowed for users with force_clock_out permission
    if (!canForceClockOut) {
      setError('You do not have permission to force clock out')
      return
    }

    if (!confirm('Are you sure you want to clock out with open tabs? This is not recommended.')) {
      return
    }

    await performClockOut()
  }

  const handleBreak = async (action: 'startBreak' | 'endBreak') => {
    if (!currentEntry) return
    setIsProcessing(true)
    setError(null)
    try {
      const response = await fetch('/api/time-clock', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: currentEntry.id, action }),
      })

      if (response.ok) {
        await loadCurrentEntry()
      } else {
        const error = await response.json()
        setError(error.error || `Failed to ${action === 'startBreak' ? 'start' : 'end'} break`)
      }
    } catch (err) {
      setError('Failed to update break status')
    } finally {
      setIsProcessing(false)
    }
  }

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const formatHours = (hours: number | null) => {
    if (!hours) return '0:00'
    const h = Math.floor(hours)
    const m = Math.round((hours - h) * 60)
    return `${h}:${m.toString().padStart(2, '0')}`
  }

  const goToOrders = () => {
    onClose()
    router.push('/orders')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Time Clock</h2>
            <p className="text-sm text-gray-500">{employeeName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : showOpenTabsWarning ? (
            // Open tabs warning
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="p-1 bg-red-100 rounded-full">
                    <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-red-800">Cannot Clock Out</h3>
                    <p className="text-sm text-red-600 mt-1">
                      You have {openTabs.length} open tab{openTabs.length > 1 ? 's' : ''} that must be closed or transferred first.
                    </p>
                  </div>
                </div>
              </div>

              {/* List of open tabs */}
              <div className="max-h-48 overflow-y-auto border rounded-lg">
                {openTabs.map(tab => (
                  <div key={tab.id} className="p-3 border-b last:border-0 flex justify-between items-center">
                    <div>
                      <div className="font-medium">
                        #{tab.orderNumber} - {tab.tabName || tab.tableName || 'Order'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {tab.itemCount} item{tab.itemCount > 1 ? 's' : ''} • {tab.orderType.replace('_', ' ')}
                      </div>
                    </div>
                    <div className="font-semibold">
                      {formatCurrency(tab.total)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Transfer to manager option */}
              {managers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Quick Transfer All Tabs
                  </label>
                  <select
                    value={selectedManagerId || ''}
                    onChange={(e) => setSelectedManagerId(e.target.value || null)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select a manager...</option>
                    {managers.map(mgr => (
                      <option key={mgr.id} value={mgr.id}>{mgr.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2">
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={goToOrders}
                >
                  Go to Orders
                </Button>

                {managers.length > 0 && selectedManagerId && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleTransferTabs}
                    disabled={isTransferring}
                  >
                    {isTransferring ? 'Transferring...' : `Transfer All to ${managers.find(m => m.id === selectedManagerId)?.name}`}
                  </Button>
                )}

                {canForceClockOut && (
                  <Button
                    variant="ghost"
                    className="w-full text-red-600 hover:bg-red-50"
                    onClick={handleForceClockOut}
                    disabled={isProcessing}
                  >
                    Force Clock Out (Manager Override)
                  </Button>
                )}

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setShowOpenTabsWarning(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : currentEntry && !currentEntry.clockOut ? (
            // Currently clocked in
            <div className="space-y-6">
              {/* Pending Tips Notification */}
              {showTipsNotification && pendingTips && pendingTips.grandTotal > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-1 bg-green-100 rounded-full">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-green-800">You have tip shares for payroll!</h3>
                      <div className="mt-2 space-y-1 text-sm">
                        {/* Show pending tips (direct shares while on shift) */}
                        {pendingTips.pending.tips.slice(0, 3).map(tip => (
                          <div key={tip.id} className="flex justify-between text-green-700">
                            <span>From {tip.fromEmployee}{tip.shareType === 'role_tipout' ? ` (${tip.percentage}%)` : ''}</span>
                            <span className="font-medium">{formatCurrency(tip.amount)}</span>
                          </div>
                        ))}
                        {/* Show banked tips (shares while off shift) */}
                        {pendingTips.banked.tips.slice(0, 3 - pendingTips.pending.tips.length).map(tip => (
                          <div key={tip.id} className="flex justify-between text-green-700">
                            <span>From {tip.fromEmployee} <span className="text-xs text-green-500">(banked)</span></span>
                            <span className="font-medium">{formatCurrency(tip.amount)}</span>
                          </div>
                        ))}
                        {(pendingTips.pending.tips.length + pendingTips.banked.tips.length) > 3 && (
                          <div className="text-green-600 text-xs">
                            +{(pendingTips.pending.tips.length + pendingTips.banked.tips.length) - 3} more
                          </div>
                        )}
                      </div>
                      <div className="mt-2 pt-2 border-t border-green-200">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-green-800">Total: {formatCurrency(pendingTips.grandTotal)}</span>
                          <button
                            onClick={() => setShowTipsNotification(false)}
                            className="text-xs text-green-600 hover:underline"
                          >
                            Dismiss
                          </button>
                        </div>
                        <p className="text-xs text-green-600 mt-1">Will be added to your next payroll</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="text-center">
                <div className="text-sm text-gray-500 mb-1">Currently Working</div>
                <div className="text-5xl font-mono font-bold text-green-600">
                  {elapsedTime}
                </div>
                <div className="text-sm text-gray-500 mt-2">
                  Clocked in at {formatTime(currentEntry.clockIn)}
                </div>
              </div>

              {currentEntry.isOnBreak && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
                  <div className="text-yellow-800 font-medium">On Break</div>
                </div>
              )}

              {currentEntry.breakMinutes > 0 && !currentEntry.isOnBreak && (
                <div className="text-center text-sm text-gray-500">
                  Break time: {currentEntry.breakMinutes} minutes
                </div>
              )}

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {currentEntry.isOnBreak ? (
                  <Button
                    variant="outline"
                    className="col-span-2 bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100"
                    onClick={() => handleBreak('endBreak')}
                    disabled={isProcessing}
                  >
                    {isProcessing ? 'Ending Break...' : 'End Break'}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => handleBreak('startBreak')}
                    disabled={isProcessing}
                  >
                    Start Break
                  </Button>
                )}
                {!currentEntry.isOnBreak && (
                  <Button
                    variant="primary"
                    className="bg-red-600 hover:bg-red-700"
                    onClick={handleClockOutClick}
                    disabled={isProcessing}
                  >
                    {isProcessing ? 'Clocking Out...' : 'Clock Out'}
                  </Button>
                )}
              </div>
            </div>
          ) : currentEntry?.clockOut ? (
            // Just clocked out - show summary
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold">Clocked Out</h3>
                <p className="text-sm text-gray-500">Great work today!</p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Clock In</span>
                  <span>{formatTime(currentEntry.clockIn)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Clock Out</span>
                  <span>{formatTime(currentEntry.clockOut)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Break</span>
                  <span>{currentEntry.breakMinutes} min</span>
                </div>
                <hr className="my-2" />
                <div className="flex justify-between font-medium">
                  <span>Regular Hours</span>
                  <span>{formatHours(currentEntry.regularHours)}</span>
                </div>
                {currentEntry.overtimeHours && currentEntry.overtimeHours > 0 && (
                  <div className="flex justify-between font-medium text-orange-600">
                    <span>Overtime</span>
                    <span>{formatHours(currentEntry.overtimeHours)}</span>
                  </div>
                )}
                {currentEntry.hourlyRate && (
                  <>
                    <hr className="my-2" />
                    <div className="flex justify-between font-bold text-green-600">
                      <span>Estimated Pay</span>
                      <span>
                        {formatCurrency(
                          (currentEntry.regularHours || 0) * currentEntry.hourlyRate +
                          (currentEntry.overtimeHours || 0) * currentEntry.hourlyRate * 1.5
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <Button variant="outline" className="w-full" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
            // Not clocked in
            <div className="space-y-6">
              {/* Pending Tips Notification - show before clocking in too */}
              {showTipsNotification && pendingTips && pendingTips.grandTotal > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-1 bg-green-100 rounded-full">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-green-800">You have tip shares for payroll!</h3>
                      <div className="mt-2 space-y-1 text-sm">
                        {pendingTips.pending.tips.slice(0, 3).map(tip => (
                          <div key={tip.id} className="flex justify-between text-green-700">
                            <span>From {tip.fromEmployee}</span>
                            <span className="font-medium">{formatCurrency(tip.amount)}</span>
                          </div>
                        ))}
                        {pendingTips.banked.tips.slice(0, 3 - pendingTips.pending.tips.length).map(tip => (
                          <div key={tip.id} className="flex justify-between text-green-700">
                            <span>From {tip.fromEmployee} <span className="text-xs text-green-500">(banked)</span></span>
                            <span className="font-medium">{formatCurrency(tip.amount)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t border-green-200">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-green-800">Total: {formatCurrency(pendingTips.grandTotal)}</span>
                          <button
                            onClick={() => setShowTipsNotification(false)}
                            className="text-xs text-green-600 hover:underline"
                          >
                            Dismiss
                          </button>
                        </div>
                        <p className="text-xs text-green-600 mt-1">Will be added to your next payroll</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold">Not Clocked In</h3>
                <p className="text-sm text-gray-500">Ready to start your shift?</p>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <Button
                variant="primary"
                className="w-full py-6 text-lg bg-green-600 hover:bg-green-700"
                onClick={handleClockIn}
                disabled={isProcessing}
              >
                {isProcessing ? 'Clocking In...' : 'Clock In'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
