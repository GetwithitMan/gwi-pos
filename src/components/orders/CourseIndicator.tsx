'use client'

import { useMemo } from 'react'

// Course color mapping
const COURSE_COLORS: Record<number, { bg: string; text: string; border: string; name: string }> = {
  0: { bg: 'bg-red-500', text: 'text-white', border: 'border-red-600', name: 'ASAP' },
  1: { bg: 'bg-blue-500', text: 'text-white', border: 'border-blue-600', name: 'Apps' },
  2: { bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-600', name: 'Soup/Salad' },
  3: { bg: 'bg-amber-500', text: 'text-white', border: 'border-amber-600', name: 'Entrees' },
  4: { bg: 'bg-pink-500', text: 'text-white', border: 'border-pink-600', name: 'Dessert' },
  5: { bg: 'bg-violet-500', text: 'text-white', border: 'border-violet-600', name: 'After' },
}

// Course status indicators
const STATUS_INDICATORS: Record<string, { icon: string; className: string }> = {
  pending: { icon: '○', className: 'text-gray-400' },
  fired: { icon: '🔥', className: 'text-yellow-500' },
  ready: { icon: '✓', className: 'text-green-500' },
  served: { icon: '✓✓', className: 'text-gray-400' },
}

interface CourseIndicatorProps {
  courseNumber?: number | null
  courseStatus?: string
  isHeld?: boolean
  size?: 'xs' | 'sm' | 'md'
  showName?: boolean
  showStatus?: boolean
  customColor?: string
  customName?: string
}

export function CourseIndicator({
  courseNumber,
  courseStatus = 'pending',
  isHeld = false,
  size = 'sm',
  showName = false,
  showStatus = false,
  customColor,
  customName,
}: CourseIndicatorProps) {
  const courseInfo = useMemo(() => {
    if (courseNumber == null || courseNumber < 0) return null
    return COURSE_COLORS[courseNumber] || {
      bg: 'bg-gray-500',
      text: 'text-white',
      border: 'border-gray-600',
      name: `C${courseNumber}`,
    }
  }, [courseNumber])

  if (!courseInfo) return null

  const sizeClasses = {
    xs: 'px-1 py-0.5 text-[9px]',
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-1 text-xs',
  }

  const statusInfo = STATUS_INDICATORS[courseStatus] || STATUS_INDICATORS.pending

  // Use custom color if provided
  const bgStyle = customColor ? { backgroundColor: customColor } : {}
  const bgClass = customColor ? '' : courseInfo.bg

  return (
    <span
      className={`
        inline-flex items-center gap-0.5 rounded font-medium
        ${bgClass} ${courseInfo.text} ${sizeClasses[size]}
        ${isHeld ? 'ring-2 ring-red-500 ring-offset-1 animate-pulse' : ''}
      `}
      style={bgStyle}
      title={`Course ${courseNumber}: ${customName || courseInfo.name}${isHeld ? ' (HELD)' : ''}`}
    >
      {/* Course number */}
      <span>C{courseNumber}</span>

      {/* Course name (optional) */}
      {showName && (
        <span className="opacity-90 ml-0.5">{customName || courseInfo.name}</span>
      )}

      {/* Status indicator (optional) */}
      {showStatus && courseStatus !== 'pending' && (
        <span className={statusInfo.className}>{statusInfo.icon}</span>
      )}

      {/* Held indicator */}
      {isHeld && (
        <span className="ml-0.5 text-red-200">⏸</span>
      )}
    </span>
  )
}

// Compact badge for item lists
export function CourseBadge({
  courseNumber,
  courseStatus,
  isHeld,
}: {
  courseNumber?: number | null
  courseStatus?: string
  isHeld?: boolean
}) {
  if (courseNumber == null || courseNumber <= 0) return null

  return (
    <CourseIndicator
      courseNumber={courseNumber}
      courseStatus={courseStatus}
      isHeld={isHeld}
      size="xs"
      showStatus
    />
  )
}

// ASAP indicator
export function ASAPBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white animate-pulse">
      ASAP 🔥
    </span>
  )
}

// HOLD indicator
export function HoldBadge({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-300 animate-pulse hover:bg-red-200"
      title="Item is on hold - click to fire"
    >
      ⏸ HOLD
    </button>
  )
}

// Course status bar showing all courses for an order
interface CourseStatusBarProps {
  courses: Array<{
    courseNumber: number
    name?: string
    color?: string
    status: string
    itemCount: number
    heldCount?: number
  }>
  currentCourse?: number
  onCourseClick?: (courseNumber: number) => void
}

export function CourseStatusBar({ courses, currentCourse = 1, onCourseClick }: CourseStatusBarProps) {
  if (courses.length === 0) return null

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {courses.map(course => {
        const isActive = course.courseNumber === currentCourse
        const isPast = course.status === 'served'
        const isFired = course.status === 'fired'
        const isReady = course.status === 'ready'
        const isHeld = course.status === 'held'

        return (
          <button
            key={course.courseNumber}
            onClick={() => onCourseClick?.(course.courseNumber)}
            className={`
              flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all
              ${isActive ? 'ring-2 ring-offset-1 ring-blue-500' : ''}
              ${isPast ? 'bg-gray-200 text-gray-500' : ''}
              ${isFired ? 'bg-yellow-100 text-yellow-800' : ''}
              ${isReady ? 'bg-green-100 text-green-800' : ''}
              ${isHeld ? 'bg-red-100 text-red-700 animate-pulse' : ''}
              ${!isPast && !isFired && !isReady && !isHeld ? 'bg-blue-100 text-blue-800' : ''}
              hover:opacity-80
            `}
          >
            <span className="font-bold">C{course.courseNumber}</span>
            {course.name && <span className="hidden sm:inline opacity-75">{course.name}</span>}
            <span className="text-[10px] opacity-60">({course.itemCount})</span>
            {isPast && <span>✓</span>}
            {isFired && <span>🔥</span>}
            {isReady && <span>✓</span>}
            {isHeld && <span>⏸</span>}
          </button>
        )
      })}
    </div>
  )
}
