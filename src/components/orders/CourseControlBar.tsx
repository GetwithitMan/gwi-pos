'use client'

import { useState, useEffect, useCallback } from 'react'

interface Course {
  courseNumber: number
  name: string
  displayName?: string
  color: string
  status: 'pending' | 'fired' | 'ready' | 'served' | 'held'
  itemCount: number
  firedCount: number
  readyCount: number
  servedCount: number
  heldCount: number
}

interface CourseControlBarProps {
  orderId: string
  courseMode?: 'off' | 'manual' | 'auto'
  currentCourse?: number
  onCourseUpdate?: () => void
  compact?: boolean
}

export function CourseControlBar({
  orderId,
  courseMode: initialMode = 'off',
  currentCourse: initialCurrent = 1,
  onCourseUpdate,
  compact = false,
}: CourseControlBarProps) {
  const [courses, setCourses] = useState<Course[]>([])
  const [currentCourse, setCurrentCourse] = useState(initialCurrent)
  const [courseMode, setCourseMode] = useState(initialMode)
  const [loading, setLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(!compact)

  const fetchCourses = useCallback(async () => {
    if (!orderId) return
    try {
      const res = await fetch(`/api/orders/${orderId}/courses`)
      if (res.ok) {
        const raw = await res.json()
        const data = raw.data ?? raw
        setCourses(data.courses || [])
        setCurrentCourse(data.currentCourse || 1)
        setCourseMode(data.courseMode || 'off')
      }
    } catch (error) {
      console.error('Failed to fetch courses:', error)
    }
  }, [orderId])

  useEffect(() => {
    fetchCourses()
  }, [fetchCourses])

  const handleCourseAction = async (courseNumber: number, action: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseNumber, action }),
      })

      if (res.ok) {
        await fetchCourses()
        onCourseUpdate?.()
      }
    } catch (error) {
      console.error('Failed to update course:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAdvanceCourse = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/advance-course`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markServed: true }),
      })

      if (res.ok) {
        await fetchCourses()
        onCourseUpdate?.()
      }
    } catch (error) {
      console.error('Failed to advance course:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSetMode = async (mode: 'off' | 'manual' | 'auto') => {
    try {
      const res = await fetch(`/api/orders/${orderId}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_mode', courseMode: mode }),
      })

      if (res.ok) {
        setCourseMode(mode)
        onCourseUpdate?.()
      }
    } catch (error) {
      console.error('Failed to set course mode:', error)
    }
  }

  // Filter to only courses with items
  const activeCourses = courses.filter(c => c.itemCount > 0 && c.courseNumber > 0)
  const hasCourses = activeCourses.length > 0

  // Find next course to fire
  const nextToFire = activeCourses.find(c => c.status === 'pending' && c.heldCount < c.itemCount)
  const allFired = activeCourses.every(c => c.status !== 'pending')
  const allServed = activeCourses.every(c => c.status === 'served')

  if (!hasCourses && courseMode === 'off') {
    return null
  }

  // Compact mode - just show a summary
  if (compact && !isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="w-full px-3 py-2 text-left text-sm bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 border-t border-blue-100 flex items-center justify-between"
      >
        <span className="flex items-center gap-2">
          <span className="text-blue-600">📋</span>
          <span className="font-medium text-blue-800">
            {hasCourses ? `${activeCourses.length} Courses` : 'Course Mode'}
          </span>
          {hasCourses && (
            <span className="text-xs text-blue-600">
              {allServed ? 'All Served ✓' : `Current: C${currentCourse}`}
            </span>
          )}
        </span>
        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    )
  }

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-t border-blue-100">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="text-blue-600">📋</span>
          <span className="font-medium text-blue-800">Course Control</span>
        </span>

        <div className="flex items-center gap-2">
          {/* Course Mode Toggle */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-500">Mode:</span>
            <div className="inline-flex rounded-md shadow-sm">
              {(['off', 'manual', 'auto'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleSetMode(mode)}
                  className={`
                    px-2 py-1 text-xs font-medium first:rounded-l-md last:rounded-r-md border
                    ${courseMode === mode
                      ? 'bg-blue-600 text-white border-blue-600 z-10'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }
                  `}
                >
                  {mode === 'off' ? 'Off' : mode === 'manual' ? 'Manual' : 'Auto'}
                </button>
              ))}
            </div>
          </div>

          {/* Collapse button for compact mode */}
          {compact && (
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 hover:bg-blue-100 rounded"
            >
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Course Tiles */}
      {hasCourses && (
        <div className="px-3 pb-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {activeCourses.map((course) => {
              const isActive = course.courseNumber === currentCourse
              const isPending = course.status === 'pending'
              const isFired = course.status === 'fired'
              const isReady = course.status === 'ready'
              const isServed = course.status === 'served'
              const isHeld = course.status === 'held'
              const hasHeldItems = course.heldCount > 0

              return (
                <div
                  key={course.courseNumber}
                  className={`
                    flex-shrink-0 rounded-lg p-2 min-w-[100px] border-2 transition-all
                    ${isActive ? 'border-blue-500 shadow-md' : 'border-transparent'}
                    ${isServed ? 'bg-gray-100 opacity-60' : ''}
                    ${isFired ? 'bg-yellow-50' : ''}
                    ${isReady ? 'bg-green-50' : ''}
                    ${isHeld ? 'bg-red-50' : ''}
                    ${isPending && !isHeld ? 'bg-white shadow-sm' : ''}
                  `}
                >
                  {/* Course Header */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1">
                      <span
                        className="w-5 h-5 rounded flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: course.color }}
                      >
                        {course.courseNumber}
                      </span>
                      <span className="text-xs font-medium text-gray-700">
                        {course.displayName || course.name}
                      </span>
                    </div>
                    {isHeld && <span className="text-red-500 animate-pulse">⏸</span>}
                    {isFired && <span className="text-yellow-600">🔥</span>}
                    {isReady && <span className="text-green-600">✓</span>}
                    {isServed && <span className="text-gray-400">✓✓</span>}
                  </div>

                  {/* Item Count */}
                  <div className="text-[10px] text-gray-500 mb-1.5">
                    {course.itemCount} items
                    {course.firedCount > 0 && course.firedCount < course.itemCount && (
                      <span className="text-yellow-600"> • {course.firedCount} fired</span>
                    )}
                    {course.readyCount > 0 && (
                      <span className="text-green-600"> • {course.readyCount} ready</span>
                    )}
                    {hasHeldItems && (
                      <span className="text-red-600"> • {course.heldCount} held</span>
                    )}
                  </div>

                  {/* Action Button */}
                  <div className="flex gap-1">
                    {isPending && !isHeld && (
                      <button
                        onClick={() => handleCourseAction(course.courseNumber, 'fire')}
                        disabled={loading}
                        className="flex-1 px-2 py-1 text-[10px] font-medium rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        🔥 Fire
                      </button>
                    )}
                    {isHeld && (
                      <button
                        onClick={() => handleCourseAction(course.courseNumber, 'release')}
                        disabled={loading}
                        className="flex-1 px-2 py-1 text-[10px] font-medium rounded bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                      >
                        ▶ Release
                      </button>
                    )}
                    {isFired && (
                      <button
                        onClick={() => handleCourseAction(course.courseNumber, 'mark_ready')}
                        disabled={loading}
                        className="flex-1 px-2 py-1 text-[10px] font-medium rounded bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                      >
                        ✓ Ready
                      </button>
                    )}
                    {isReady && (
                      <button
                        onClick={() => handleCourseAction(course.courseNumber, 'mark_served')}
                        disabled={loading}
                        className="flex-1 px-2 py-1 text-[10px] font-medium rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                      >
                        ✓ Served
                      </button>
                    )}
                    {isPending && !isHeld && (
                      <button
                        onClick={() => handleCourseAction(course.courseNumber, 'hold')}
                        disabled={loading}
                        className="px-2 py-1 text-[10px] font-medium rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                        title="Hold all items in this course"
                      >
                        ⏸
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      {hasCourses && (
        <div className="px-3 pb-2 flex gap-2 flex-wrap">
          {/* Fire Next Course */}
          {nextToFire && !allFired && (
            <button
              onClick={() => handleCourseAction(nextToFire.courseNumber, 'fire')}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1"
            >
              🔥 Fire Course {nextToFire.courseNumber}
            </button>
          )}

          {/* Advance Course */}
          {!allServed && currentCourse > 0 && (
            <button
              onClick={handleAdvanceCourse}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
            >
              ➡ Advance Course
            </button>
          )}

          {/* Fire All Pending */}
          {activeCourses.some(c => c.status === 'pending') && (
            <button
              onClick={async () => {
                for (const course of activeCourses.filter(c => c.status === 'pending')) {
                  await handleCourseAction(course.courseNumber, 'fire')
                }
              }}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 flex items-center gap-1"
            >
              🔥 Fire All Pending
            </button>
          )}

          {/* All Served Indicator */}
          {allServed && (
            <span className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded-lg flex items-center gap-1">
              ✓ All Courses Served
            </span>
          )}
        </div>
      )}

      {/* No Courses Message */}
      {!hasCourses && courseMode !== 'off' && (
        <div className="px-3 pb-2 text-xs text-gray-500">
          Assign items to courses to enable course control.
        </div>
      )}
    </div>
  )
}
