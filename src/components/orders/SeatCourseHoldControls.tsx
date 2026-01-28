'use client'

import { useState } from 'react'

interface SeatCourseHoldControlsProps {
  orderId: string
  itemId: string
  itemName: string
  seatNumber?: number
  courseNumber?: number
  courseStatus?: 'pending' | 'fired' | 'ready' | 'served'
  isHeld?: boolean
  holdUntil?: string
  firedAt?: string
  sentToKitchen?: boolean
  guestCount?: number
  onUpdate: (updates: {
    seatNumber?: number
    courseNumber?: number
    courseStatus?: 'pending' | 'fired' | 'ready' | 'served'
    isHeld?: boolean
    holdUntil?: string
    firedAt?: string
  }) => void
}

export function SeatCourseHoldControls({
  orderId,
  itemId,
  itemName,
  seatNumber,
  courseNumber,
  courseStatus = 'pending',
  isHeld = false,
  holdUntil,
  sentToKitchen = false,
  guestCount = 4,
  onUpdate,
}: SeatCourseHoldControlsProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [showControls, setShowControls] = useState(false)

  const handleAction = async (action: string, data?: Record<string, unknown>) => {
    setIsUpdating(true)
    try {
      const response = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data }),
      })

      if (response.ok) {
        const result = await response.json()
        if (result.item) {
          onUpdate({
            seatNumber: result.item.seatNumber,
            courseNumber: result.item.courseNumber,
            courseStatus: result.item.courseStatus as 'pending' | 'fired' | 'ready' | 'served' | undefined,
            isHeld: result.item.isHeld,
            holdUntil: result.item.holdUntil,
            firedAt: result.item.firedAt,
          })
        }
      }
    } catch (error) {
      console.error('Failed to update item:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleSeatChange = (seat: number | null) => {
    handleAction('assign_seat', { seatNumber: seat })
  }

  const handleCourseChange = (course: number | null) => {
    handleAction('assign_course', { courseNumber: course })
  }

  const handleHold = () => {
    handleAction('hold')
  }

  const handleFire = () => {
    handleAction('fire')
  }

  const handleRelease = () => {
    handleAction('release')
  }

  const getCourseStatusColor = () => {
    switch (courseStatus) {
      case 'fired': return 'bg-yellow-100 text-yellow-800'
      case 'ready': return 'bg-green-100 text-green-800'
      case 'served': return 'bg-gray-100 text-gray-600'
      default: return 'bg-blue-100 text-blue-800'
    }
  }

  // Compact badge view (always visible)
  const badges = (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Seat badge */}
      {seatNumber && (
        <span className="px-1.5 py-0.5 text-xs rounded bg-purple-100 text-purple-700 font-medium">
          S{seatNumber}
        </span>
      )}

      {/* Course badge */}
      {courseNumber && (
        <span className={`px-1.5 py-0.5 text-xs rounded font-medium ${getCourseStatusColor()}`}>
          C{courseNumber}
          {courseStatus !== 'pending' && (
            <span className="ml-1 capitalize">{courseStatus}</span>
          )}
        </span>
      )}

      {/* Held badge */}
      {isHeld && (
        <span className="px-1.5 py-0.5 text-xs rounded bg-red-100 text-red-700 font-medium animate-pulse">
          HELD
        </span>
      )}
    </div>
  )

  // Only show controls for items not yet sent to kitchen, or allow fire/ready actions for sent items
  if (!sentToKitchen) {
    return (
      <div className="mt-1 ml-[72px]">
        {badges}

        <button
          onClick={() => setShowControls(!showControls)}
          className="text-xs text-gray-500 hover:text-blue-600 mt-1"
          disabled={isUpdating}
        >
          {showControls ? '▼ Hide controls' : '▶ Seat / Course / Hold'}
        </button>

        {showControls && (
          <div className="mt-2 p-2 bg-gray-50 rounded-lg space-y-2">
            {/* Seat Assignment */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-12">Seat:</span>
              <div className="flex gap-1">
                <button
                  onClick={() => handleSeatChange(null)}
                  className={`px-2 py-1 text-xs rounded ${!seatNumber ? 'bg-gray-300' : 'bg-gray-100 hover:bg-gray-200'}`}
                  disabled={isUpdating}
                >
                  -
                </button>
                {Array.from({ length: Math.max(guestCount, 4) }, (_, i) => i + 1).map(seat => (
                  <button
                    key={seat}
                    onClick={() => handleSeatChange(seat)}
                    className={`w-7 h-7 text-xs rounded ${
                      seatNumber === seat
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-100 hover:bg-purple-100'
                    }`}
                    disabled={isUpdating}
                  >
                    {seat}
                  </button>
                ))}
              </div>
            </div>

            {/* Course Assignment */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-12">Course:</span>
              <div className="flex gap-1">
                <button
                  onClick={() => handleCourseChange(null)}
                  className={`px-2 py-1 text-xs rounded ${!courseNumber ? 'bg-gray-300' : 'bg-gray-100 hover:bg-gray-200'}`}
                  disabled={isUpdating}
                >
                  -
                </button>
                {[1, 2, 3, 4, 5].map(course => (
                  <button
                    key={course}
                    onClick={() => handleCourseChange(course)}
                    className={`w-7 h-7 text-xs rounded ${
                      courseNumber === course
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 hover:bg-blue-100'
                    }`}
                    disabled={isUpdating}
                  >
                    {course}
                  </button>
                ))}
              </div>
            </div>

            {/* Hold Control */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-12">Hold:</span>
              {isHeld ? (
                <div className="flex gap-2">
                  <button
                    onClick={handleFire}
                    className="px-3 py-1 text-xs rounded bg-green-500 text-white hover:bg-green-600"
                    disabled={isUpdating}
                  >
                    🔥 Fire Now
                  </button>
                  <button
                    onClick={handleRelease}
                    className="px-3 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
                    disabled={isUpdating}
                  >
                    Release
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleHold}
                  className="px-3 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200"
                  disabled={isUpdating}
                >
                  ⏸ Hold Item
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // For sent items, show badges and course firing controls
  return (
    <div className="mt-1 ml-[72px]">
      {badges}

      {/* Course controls for sent items */}
      {courseNumber && courseStatus && courseStatus !== 'served' && (
        <div className="mt-1 flex gap-1">
          {courseStatus === 'pending' && !isHeld && (
            <button
              onClick={() => handleAction('fire_course')}
              className="px-2 py-0.5 text-xs rounded bg-yellow-500 text-white hover:bg-yellow-600"
              disabled={isUpdating}
            >
              🔥 Fire Course {courseNumber}
            </button>
          )}
          {courseStatus === 'fired' && (
            <button
              onClick={() => handleAction('mark_ready')}
              className="px-2 py-0.5 text-xs rounded bg-green-500 text-white hover:bg-green-600"
              disabled={isUpdating}
            >
              ✓ Mark Ready
            </button>
          )}
          {courseStatus === 'ready' && (
            <button
              onClick={() => handleAction('mark_served')}
              className="px-2 py-0.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
              disabled={isUpdating}
            >
              ✓ Served
            </button>
          )}
        </div>
      )}

      {/* Hold controls for sent items */}
      {isHeld && (
        <div className="mt-1">
          <button
            onClick={handleFire}
            className="px-2 py-0.5 text-xs rounded bg-green-500 text-white hover:bg-green-600"
            disabled={isUpdating}
          >
            🔥 Fire Now
          </button>
        </div>
      )}
    </div>
  )
}

// Compact inline badges for order item display
export function ItemBadges({
  seatNumber,
  courseNumber,
  courseStatus,
  isHeld,
}: {
  seatNumber?: number
  courseNumber?: number
  courseStatus?: string
  isHeld?: boolean
}) {
  if (!seatNumber && !courseNumber && !isHeld) return null

  const getCourseStatusColor = () => {
    switch (courseStatus) {
      case 'fired': return 'bg-yellow-100 text-yellow-800'
      case 'ready': return 'bg-green-100 text-green-800'
      case 'served': return 'bg-gray-100 text-gray-600'
      default: return 'bg-blue-100 text-blue-800'
    }
  }

  return (
    <span className="inline-flex items-center gap-1 ml-2">
      {seatNumber && (
        <span className="px-1 py-0.5 text-[10px] rounded bg-purple-100 text-purple-700 font-medium">
          S{seatNumber}
        </span>
      )}
      {courseNumber && (
        <span className={`px-1 py-0.5 text-[10px] rounded font-medium ${getCourseStatusColor()}`}>
          C{courseNumber}
        </span>
      )}
      {isHeld && (
        <span className="px-1 py-0.5 text-[10px] rounded bg-red-100 text-red-700 font-medium animate-pulse">
          HELD
        </span>
      )}
    </span>
  )
}
