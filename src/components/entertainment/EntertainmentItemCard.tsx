'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  calculateTimeRemaining,
  calculateElapsedTime,
  type EntertainmentItem,
  type WaitlistEntry,
} from '@/lib/entertainment'

interface EntertainmentItemCardProps {
  item: EntertainmentItem
  onOpenTab?: (orderId: string) => void
  onExtendTime?: (itemId: string) => void
  onStopSession?: (itemId: string) => void
  onAddToWaitlist?: (itemId: string) => void
}

export function EntertainmentItemCard({
  item,
  onOpenTab,
  onExtendTime,
  onStopSession,
  onAddToWaitlist,
}: EntertainmentItemCardProps) {
  const [timerDisplay, setTimerDisplay] = useState<string>('')
  const [urgencyLevel, setUrgencyLevel] = useState<'normal' | 'warning' | 'critical' | 'expired'>('normal')

  // Update timer every second
  useEffect(() => {
    if (!item.timeInfo) {
      setTimerDisplay('')
      return
    }

    const updateTimer = () => {
      if (item.timeInfo?.type === 'block' && item.timeInfo.expiresAt) {
        const result = calculateTimeRemaining(item.timeInfo.expiresAt)
        setTimerDisplay(result.formatted)
        setUrgencyLevel(result.urgencyLevel)
      } else if (item.timeInfo?.type === 'per_minute' && item.timeInfo.startedAt) {
        const result = calculateElapsedTime(item.timeInfo.startedAt)
        setTimerDisplay(result.formatted)
        setUrgencyLevel('normal')
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [item.timeInfo])

  const isInUse = item.status === 'in_use'
  const isAvailable = item.status === 'available'
  const isMaintenance = item.status === 'maintenance'

  // Get urgency colors for timer
  const getTimerColor = () => {
    switch (urgencyLevel) {
      case 'expired': return 'text-red-600 bg-red-100'
      case 'critical': return 'text-orange-600 bg-orange-100'
      case 'warning': return 'text-yellow-600 bg-yellow-100'
      default: return 'text-gray-900 bg-gray-100'
    }
  }

  // Get card background based on status
  const getCardStyle = () => {
    if (isInUse) {
      if (urgencyLevel === 'expired' || urgencyLevel === 'critical') {
        return 'border-red-500 bg-red-50'
      }
      return 'border-red-400 bg-red-50'
    }
    if (isAvailable) return 'border-green-500 bg-green-50'
    if (isMaintenance) return 'border-gray-400 bg-gray-100'
    return 'border-gray-300 bg-white'
  }

  const nextUp = item.waitlist?.[0]

  return (
    <Card className={cn('relative overflow-hidden border-2 h-full flex flex-col', getCardStyle())}>
      {/* Header with large item name */}
      <div className={cn(
        'p-4 text-center',
        isInUse ? 'bg-red-600 text-white' : isAvailable ? 'bg-green-600 text-white' : 'bg-gray-500 text-white'
      )}>
        <h2 className="text-2xl font-bold tracking-wide">
          {item.displayName}
        </h2>
        <div className="text-sm font-medium opacity-90 mt-1">
          {isAvailable && '● AVAILABLE'}
          {isInUse && '● IN USE'}
          {isMaintenance && '● MAINTENANCE'}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 p-4 flex flex-col">
        {/* Timer / Status display */}
        {isInUse && (
          <div className="mb-4">
            {/* Current tab info */}
            {item.currentOrder && (
              <div className="text-center mb-3">
                <span className="text-sm text-gray-600">Tab:</span>
                <span className="ml-2 font-semibold text-gray-800">{item.currentOrder.tabName}</span>
              </div>
            )}

            {/* Timer display */}
            {item.timeInfo && timerDisplay && (
              <div className={cn('text-center p-3 rounded-lg', getTimerColor())}>
                <div className="text-4xl font-mono font-bold">
                  {timerDisplay}
                </div>
                <div className="text-xs mt-1 opacity-75">
                  {item.timeInfo.type === 'block' ? `${item.timeInfo.blockMinutes} min block` : 'Elapsed time'}
                </div>
              </div>
            )}
          </div>
        )}

        {isAvailable && (
          <div className="text-center py-6 text-green-700">
            <div className="text-lg font-medium">Ready for customers</div>
          </div>
        )}

        {isMaintenance && (
          <div className="text-center py-6 text-gray-600">
            <div className="text-lg">🔧 Under maintenance</div>
          </div>
        )}

        {/* Waitlist section - inside the card */}
        <div className="mt-auto">
          {item.waitlistCount > 0 ? (
            <div className="bg-amber-50 border-t-2 border-amber-400 pt-3 px-2 pb-2 -mx-4 -mb-4 rounded-b">
              <div className="text-sm font-bold text-amber-800 uppercase mb-2 flex items-center gap-2">
                <span className="bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full">
                  {item.waitlistCount}
                </span>
                Waiting
              </div>

              {/* Next up - prominent display */}
              {nextUp && (
                <div className="bg-blue-600 text-white rounded-lg p-3 mb-2 shadow-sm">
                  <div className="text-xs font-bold opacity-90">NEXT UP</div>
                  <div className="text-xl font-bold">
                    {nextUp.customerName.split(' ')[0]}
                  </div>
                  <div className="text-sm opacity-90">
                    Party of {nextUp.partySize} • {nextUp.waitMinutes} min wait
                  </div>
                </div>
              )}

              {/* Rest of waitlist */}
              {item.waitlist && item.waitlist.length > 1 && (
                <div className="space-y-1 max-h-24 overflow-y-auto bg-white rounded p-2">
                  {item.waitlist.slice(1, 4).map((entry: WaitlistEntry, idx: number) => (
                    <div key={entry.id} className="flex justify-between text-sm font-medium text-gray-800 px-1">
                      <span>{idx + 2}. {entry.customerName.split(' ')[0]} ({entry.partySize})</span>
                      <span className="text-amber-600 font-semibold">{entry.waitMinutes}m</span>
                    </div>
                  ))}
                  {item.waitlist.length > 4 && (
                    <div className="text-xs text-gray-600 px-1 font-medium">
                      +{item.waitlist.length - 4} more waiting
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="border-t pt-3 text-center text-sm text-gray-500 font-medium">
              No one waiting
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="p-3 bg-gray-50 border-t flex flex-col gap-2">
        {isInUse && item.currentOrder && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onOpenTab?.(item.currentOrder!.orderId)}
              aria-label={`Open tab for ${item.displayName}`}
            >
              Open Tab
            </Button>
            <div className="flex gap-2">
              {item.timeInfo?.type === 'block' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => onExtendTime?.(item.id)}
                  aria-label={`Extend time for ${item.displayName}`}
                >
                  Extend
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-red-600 border-red-300 hover:bg-red-50"
                onClick={() => onStopSession?.(item.id)}
                aria-label={`Stop session for ${item.displayName}`}
              >
                Stop
              </Button>
            </div>
          </>
        )}

        <Button
          variant={isAvailable ? "default" : "outline"}
          size="sm"
          className={cn("w-full", isAvailable && "bg-blue-600 hover:bg-blue-700")}
          onClick={() => onAddToWaitlist?.(item.id)}
          aria-label={`Add to waitlist for ${item.displayName}`}
        >
          + Add to Waitlist
        </Button>
      </div>
    </Card>
  )
}
