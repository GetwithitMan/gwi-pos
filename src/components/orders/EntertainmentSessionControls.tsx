'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface EntertainmentSessionControlsProps {
  orderItemId: string
  menuItemId: string
  itemName: string
  blockTimeMinutes: number | null
  blockTimeStartedAt: string | null
  blockTimeExpiresAt: string | null
  isTimedRental?: boolean  // Show controls even if timer not started
  defaultBlockMinutes?: number  // Default minutes for starting timer
  onSessionEnded?: () => void
  onTimeExtended?: () => void
  onTimerStarted?: () => void
}

export function EntertainmentSessionControls({
  orderItemId,
  menuItemId,
  itemName,
  blockTimeMinutes,
  blockTimeStartedAt,
  blockTimeExpiresAt,
  isTimedRental = false,
  defaultBlockMinutes = 60,
  onSessionEnded,
  onTimeExtended,
  onTimerStarted,
}: EntertainmentSessionControlsProps) {
  const [timeDisplay, setTimeDisplay] = useState<string>('')
  const [isExpired, setIsExpired] = useState(false)
  const [isExpiringSoon, setIsExpiringSoon] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showExtendOptions, setShowExtendOptions] = useState(false)
  const [showStartOptions, setShowStartOptions] = useState(false)

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

    // Block time - show countdown
    const updateCountdown = () => {
      const expiresAt = new Date(blockTimeExpiresAt)
      const now = new Date()
      const remainingMs = expiresAt.getTime() - now.getTime()

      if (remainingMs <= 0) {
        setTimeDisplay('EXPIRED')
        setIsExpired(true)
        setIsExpiringSoon(false)
        return
      }

      const mins = Math.floor(remainingMs / 60000)
      const secs = Math.floor((remainingMs % 60000) / 1000)
      setTimeDisplay(`${mins}:${secs.toString().padStart(2, '0')}`)
      setIsExpired(false)
      setIsExpiringSoon(mins < 5)
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
      const response = await fetch(`/api/entertainment/block-time?orderItemId=${orderItemId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        const result = await response.json()
        console.log('Session stopped:', result.message)
        onSessionEnded?.()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to stop session')
      }
    } catch (err) {
      console.error('Error stopping session:', err)
      alert('Failed to stop session')
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
          additionalMinutes: minutes,
        }),
      })

      if (response.ok) {
        setShowExtendOptions(false)
        onTimeExtended?.()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to extend time')
      }
    } catch (err) {
      console.error('Error extending time:', err)
      alert('Failed to extend time')
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
          minutes,
        }),
      })

      if (response.ok) {
        setShowStartOptions(false)
        onTimerStarted?.()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to start timer')
      }
    } catch (err) {
      console.error('Error starting timer:', err)
      alert('Failed to start timer')
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
          Start the timer to track session time for {itemName}
        </p>

        {showStartOptions ? (
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

      {/* Extend options */}
      {showExtendOptions ? (
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
      )}

      {isExpired && (
        <div className="mt-2 p-2 bg-red-100 border border-red-400 rounded text-sm text-red-800 font-medium">
          ⚠️ Time has expired! Stop the session or extend time.
        </div>
      )}
    </div>
  )
}
