'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

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

interface TimeClockModalProps {
  isOpen: boolean
  onClose: () => void
  employeeId: string
  employeeName: string
  locationId: string
}

export function TimeClockModal({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  locationId,
}: TimeClockModalProps) {
  const [currentEntry, setCurrentEntry] = useState<TimeClockEntry | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsedTime, setElapsedTime] = useState('')

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
      }
    } catch (err) {
      console.error('Failed to load time clock:', err)
    } finally {
      setIsLoading(false)
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

  const handleClockOut = async () => {
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
          ) : currentEntry && !currentEntry.clockOut ? (
            // Currently clocked in
            <div className="space-y-6">
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
                    onClick={handleClockOut}
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
