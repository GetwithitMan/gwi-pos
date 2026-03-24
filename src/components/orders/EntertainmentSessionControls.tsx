'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast-store'

interface EntertainmentSessionControlsProps {
  orderItemId: string
  menuItemId: string
  locationId: string
  itemName: string
  blockTimeMinutes: number | null
  blockTimeStartedAt: string | null
  blockTimeExpiresAt: string | null
  isTimedRental?: boolean  // Show controls even if timer not started
  defaultBlockMinutes?: number  // Default minutes for starting timer
  onSessionEnded?: () => void
  onTimeExtended?: () => void
  onTimerStarted?: () => void
  // Overtime settings
  overtimeGracePeriodMinutes?: number  // Grace period before overtime charges (default: 2)
  overtimeRatePerMinute?: number       // Dollar per minute of overtime (default: 0.50)
  // Finish Game settings
  finishGameExtensionMinutes?: number  // Minutes added by Finish Game (default: 5)
  finishGameExtensionPrice?: number    // Flat fee for Finish Game (default: 3.00)
  // Permission gate: when false, action buttons are hidden but timer/status is still visible
  canManageEntertainment?: boolean
}

export function EntertainmentSessionControls({
  orderItemId,
  menuItemId,
  locationId,
  itemName,
  blockTimeMinutes,
  blockTimeStartedAt,
  blockTimeExpiresAt,
  isTimedRental = false,
  defaultBlockMinutes = 60,
  onSessionEnded,
  onTimeExtended,
  onTimerStarted,
  overtimeGracePeriodMinutes = 2,
  overtimeRatePerMinute = 0.50,
  finishGameExtensionMinutes = 5,
  finishGameExtensionPrice = 3.00,
  canManageEntertainment = true,
}: EntertainmentSessionControlsProps) {
  const [timeDisplay, setTimeDisplay] = useState<string>('')
  const [isExpired, setIsExpired] = useState(false)
  const [isExpiringSoon, setIsExpiringSoon] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showExtendOptions, setShowExtendOptions] = useState(false)
  const [showStartOptions, setShowStartOptions] = useState(false)
  // Overtime tracking
  const [isInOvertime, setIsInOvertime] = useState(false)
  const [overtimeAmount, setOvertimeAmount] = useState(0)
  const [overtimeMinutes, setOvertimeMinutes] = useState(0)
  // Finish Game — one-time use
  const [finishGameUsed, setFinishGameUsed] = useState(false)

  const hasActiveTimer = blockTimeStartedAt || blockTimeExpiresAt || blockTimeMinutes

  // Update timer every second
  useEffect(() => {
    if (!blockTimeExpiresAt) {
      // Per-minute billing - show elapsed time
      if (blockTimeStartedAt) {
        const updateElapsed = () => {
          const started = new Date(blockTimeStartedAt)
          const now = new Date()
          const elapsedMs = now.getTime() - started.getTime()
          const mins = Math.floor(elapsedMs / 60000)
          const secs = Math.floor((elapsedMs % 60000) / 1000)
          setTimeDisplay(`${mins}:${secs.toString().padStart(2, '0')} elapsed`)
        }
        updateElapsed()
        const interval = setInterval(updateElapsed, 1000)
        return () => clearInterval(interval)
      }
      return
    }

    // Block time - show countdown (with overtime tracking)
    const updateCountdown = () => {
      const expiresAt = new Date(blockTimeExpiresAt)
      const now = new Date()
      const remainingMs = expiresAt.getTime() - now.getTime()

      if (remainingMs <= 0) {
        const overMinutes = Math.abs(remainingMs) / 60000
        const gracePeriod = overtimeGracePeriodMinutes

        if (overMinutes > gracePeriod) {
          // Past grace period — in overtime
          const chargeableMinutes = Math.floor(overMinutes - gracePeriod)
          const charge = chargeableMinutes * overtimeRatePerMinute
          setIsInOvertime(true)
          setOvertimeMinutes(chargeableMinutes)
          setOvertimeAmount(Math.round(charge * 100) / 100)
          setTimeDisplay(`OT +${chargeableMinutes}m`)
        } else {
          // In grace period
          const graceRemaining = Math.ceil(gracePeriod - overMinutes)
          setTimeDisplay(`Grace: ${graceRemaining}m`)
          setIsInOvertime(false)
          setOvertimeAmount(0)
          setOvertimeMinutes(0)
        }

        setIsExpired(true)
        setIsExpiringSoon(false)
        return
      }

      const mins = Math.floor(remainingMs / 60000)
      const secs = Math.floor((remainingMs % 60000) / 1000)
      setTimeDisplay(`${mins}:${secs.toString().padStart(2, '0')}`)
      setIsExpired(false)
      setIsExpiringSoon(mins <= 10)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [blockTimeExpiresAt, blockTimeStartedAt])

  const handleStopSession = async () => {
    if (!confirm(`Stop session for ${itemName}? This will end the timer and make the item available.`)) {
      return
    }

    setIsProcessing(true)
    try {
      // Stop the block time - this also updates MenuItem status to 'available'
      const response = await fetch(`/api/entertainment/block-time?orderItemId=${orderItemId}&locationId=${locationId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        onSessionEnded?.()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to stop session')
      }
    } catch (err) {
      console.error('Error stopping session:', err)
      toast.error('Failed to stop session')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleExtendTime = async (minutes: number) => {
    setIsProcessing(true)
    try {
      const response = await fetch('/api/entertainment/block-time', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderItemId,
          locationId,
          additionalMinutes: minutes,
        }),
      })

      if (response.ok) {
        setShowExtendOptions(false)
        onTimeExtended?.()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to extend time')
      }
    } catch (err) {
      console.error('Error extending time:', err)
      toast.error('Failed to extend time')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleStartTimer = async (minutes: number) => {
    setIsProcessing(true)
    try {
      const response = await fetch('/api/entertainment/block-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderItemId,
          locationId,
          minutes,
        }),
      })

      if (response.ok) {
        setShowStartOptions(false)
        onTimerStarted?.()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to start timer')
      }
    } catch (err) {
      console.error('Error starting timer:', err)
      toast.error('Failed to start timer')
    } finally {
      setIsProcessing(false)
    }
  }

  // Only show if there's an active session OR if it's a timed rental item
  if (!hasActiveTimer && !isTimedRental) {
    return null
  }

  // Show "Start Timer" UI if no timer is running but it's a timed rental
  if (!hasActiveTimer && isTimedRental) {
    return (
      <div className="mt-2 p-3 bg-amber-50 border-2 border-amber-400 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🎱</span>
          <span className="font-bold text-amber-800">Timer Not Started</span>
        </div>
        <p className="text-sm text-amber-700 mb-3">
          {canManageEntertainment
            ? `Start the timer to track session time for ${itemName}`
            : `Awaiting manager to start timer for ${itemName}`}
        </p>

        {canManageEntertainment && (
          showStartOptions ? (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">Select duration:</div>
              <div className="flex gap-2 flex-wrap">
                {[30, 60, 90, 120].map(mins => (
                  <Button
                    key={mins}
                    size="sm"
                    variant="outline"
                    onClick={() => handleStartTimer(mins)}
                    disabled={isProcessing}
                    className="border-amber-400 text-amber-700 hover:bg-amber-100"
                  >
                    {mins} min
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowStartOptions(false)}
                  className="text-gray-500"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={() => setShowStartOptions(true)}
              disabled={isProcessing}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white"
            >
              Start Timer
            </Button>
          )
        )}
      </div>
    )
  }

  return (
    <div className="mt-2 p-3 bg-green-50 border-2 border-green-400 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎱</span>
          <span className="font-bold text-green-800">Active Session</span>
        </div>
        <div className={`text-2xl font-mono font-bold ${
          isExpired ? 'text-red-600 animate-pulse' :
          isExpiringSoon ? 'text-orange-600' :
          'text-green-700'
        }`}>
          {timeDisplay || 'Loading...'}
        </div>
      </div>

      {blockTimeMinutes && (
        <div className="text-sm text-green-700 mb-3">
          {blockTimeMinutes} minute block
          {blockTimeStartedAt && (
            <span className="ml-2 text-gray-500">
              • Started {new Date(blockTimeStartedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Extend / Stop controls — only visible to employees with settings.entertainment permission */}
      {canManageEntertainment && (
        showExtendOptions ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-700">Extend by:</div>
            <div className="flex gap-2 flex-wrap">
              {[15, 30, 45, 60].map(mins => (
                <Button
                  key={mins}
                  size="sm"
                  variant="outline"
                  onClick={() => handleExtendTime(mins)}
                  disabled={isProcessing}
                  className="border-green-400 text-green-700 hover:bg-green-100"
                >
                  +{mins} min
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowExtendOptions(false)}
                className="text-gray-500"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowExtendOptions(true)}
              disabled={isProcessing}
              className="flex-1 border-green-500 text-green-700 hover:bg-green-100"
            >
              Extend Time
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleStopSession}
              disabled={isProcessing}
              className="flex-1 border-red-400 text-red-600 hover:bg-red-50"
            >
              {isProcessing ? 'Stopping...' : 'Stop Session'}
            </Button>
          </div>
        )
      )}

      {isExpired && !isInOvertime && (
        <div className="mt-2 p-2 bg-yellow-100 border border-yellow-400 rounded text-sm text-yellow-800 font-medium">
          Time expired — grace period active. Stop the session or extend time.
        </div>
      )}

      {isExpired && isInOvertime && (
        <div className="mt-2 p-2 bg-red-200 border border-red-500 rounded text-sm text-red-900 font-bold">
          Overtime: ${overtimeAmount.toFixed(2)} ({overtimeMinutes}m at ${overtimeRatePerMinute.toFixed(2)}/min)
        </div>
      )}

      {/* Finish Game button — shows after expiry, one-time use, gated on permission */}
      {isExpired && !finishGameUsed && canManageEntertainment && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              setIsProcessing(true)
              try {
                // Extend time by finishGameExtensionMinutes
                const response = await fetch('/api/entertainment/block-time', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    orderItemId,
                    locationId,
                    additionalMinutes: finishGameExtensionMinutes,
                    finishGameCharge: finishGameExtensionPrice,
                  }),
                })
                if (response.ok) {
                  setFinishGameUsed(true)
                  setIsExpired(false)
                  setIsInOvertime(false)
                  setOvertimeAmount(0)
                  setOvertimeMinutes(0)
                  onTimeExtended?.()
                  toast.success(`Finish Game: +${finishGameExtensionMinutes}m added ($${finishGameExtensionPrice.toFixed(2)} charge)`)
                } else {
                  const data = await response.json()
                  toast.error(data.error || 'Failed to extend time')
                }
              } catch (err) {
                console.error('Finish Game error:', err)
                toast.error('Failed to extend time')
              } finally {
                setIsProcessing(false)
              }
            }}
            disabled={isProcessing}
            className="w-full border-orange-500 text-orange-700 hover:bg-orange-100 font-semibold"
          >
            {isProcessing ? 'Extending...' : `Finish Game (+${finishGameExtensionMinutes}m / $${finishGameExtensionPrice.toFixed(2)})`}
          </Button>
        </div>
      )}

      {isExpired && finishGameUsed && (
        <div className="mt-2 p-2 bg-green-100 border border-green-400 rounded text-sm text-green-800 font-medium">
          Extended — Finish Game used
        </div>
      )}
    </div>
  )
}
