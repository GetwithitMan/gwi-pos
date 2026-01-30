'use client'

import { useState, useRef, useEffect } from 'react'

// Default course options
const DEFAULT_COURSES = [
  { value: 0, label: 'ASAP', sublabel: 'Fire immediately', color: '#EF4444', icon: '🔥' },
  { value: 1, label: 'Course 1', sublabel: 'Appetizers', color: '#3B82F6' },
  { value: 2, label: 'Course 2', sublabel: 'Soup/Salad', color: '#10B981' },
  { value: 3, label: 'Course 3', sublabel: 'Entrees', color: '#F59E0B' },
  { value: 4, label: 'Course 4', sublabel: 'Dessert', color: '#EC4899' },
  { value: 5, label: 'Course 5', sublabel: 'After-Dinner', color: '#8B5CF6' },
]

// Special options
const SPECIAL_OPTIONS = [
  { value: -1, label: 'HOLD', sublabel: 'Hold until released', color: '#DC2626', icon: '⏸', isHold: true },
]

interface CourseOption {
  value: number
  label: string
  sublabel?: string
  color?: string
  icon?: string
  isHold?: boolean
}

interface CourseSelectorDropdownProps {
  currentCourse?: number | null
  isHeld?: boolean
  onSelect: (course: number | null, isHold: boolean) => void
  customCourses?: CourseOption[]
  showHoldOption?: boolean
  showASAPOption?: boolean
  size?: 'xs' | 'sm' | 'md'
  disabled?: boolean
}

export function CourseSelectorDropdown({
  currentCourse,
  isHeld = false,
  onSelect,
  customCourses,
  showHoldOption = true,
  showASAPOption = true,
  size = 'sm',
  disabled = false,
}: CourseSelectorDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Build course options
  const courses = customCourses || DEFAULT_COURSES
  const options: CourseOption[] = [
    ...(showASAPOption ? [courses.find(c => c.value === 0) || DEFAULT_COURSES[0]] : []),
    ...courses.filter(c => c.value > 0),
    ...(showHoldOption ? SPECIAL_OPTIONS : []),
  ]

  // Get current display
  const getCurrentDisplay = () => {
    if (isHeld) {
      return { label: 'HOLD', icon: '⏸', color: '#DC2626' }
    }
    if (currentCourse === 0) {
      return { label: 'ASAP', icon: '🔥', color: '#EF4444' }
    }
    if (currentCourse && currentCourse > 0) {
      const course = courses.find(c => c.value === currentCourse)
      return {
        label: `C${currentCourse}`,
        icon: course?.icon,
        color: course?.color || '#6B7280',
      }
    }
    return { label: 'Course', icon: undefined, color: '#9CA3AF' }
  }

  const current = getCurrentDisplay()

  const sizeClasses = {
    xs: 'px-1 py-0.5 text-[9px]',
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-1 text-xs',
  }

  const handleSelect = (option: CourseOption) => {
    if (option.isHold) {
      onSelect(currentCourse ?? null, true)
    } else {
      onSelect(option.value, false)
    }
    setIsOpen(false)
  }

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          inline-flex items-center gap-0.5 rounded font-medium
          ${sizeClasses[size]}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}
          ${isHeld ? 'animate-pulse ring-1 ring-red-400' : ''}
        `}
        style={{ backgroundColor: current.color, color: 'white' }}
      >
        {current.icon && <span>{current.icon}</span>}
        <span>{current.label}</span>
        <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 left-0 min-w-[140px] bg-white rounded-lg shadow-lg border border-gray-200 py-1 max-h-64 overflow-y-auto">
          {/* Clear option */}
          <button
            onClick={() => {
              onSelect(null, false)
              setIsOpen(false)
            }}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center gap-2 text-gray-500"
          >
            <span className="w-4 h-4 rounded border border-gray-300 flex items-center justify-center text-[10px]">-</span>
            <span>No Course</span>
          </button>

          <div className="border-t border-gray-100 my-1" />

          {/* Course options */}
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => handleSelect(option)}
              className={`
                w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center gap-2
                ${option.isHold ? 'border-t border-gray-100 mt-1 pt-2' : ''}
                ${(currentCourse === option.value && !isHeld) || (option.isHold && isHeld) ? 'bg-gray-100' : ''}
              `}
            >
              <span
                className="w-4 h-4 rounded flex items-center justify-center text-white text-[10px] font-bold"
                style={{ backgroundColor: option.color }}
              >
                {option.icon || option.value}
              </span>
              <div className="flex flex-col">
                <span className="font-medium">{option.label}</span>
                {option.sublabel && (
                  <span className="text-[10px] text-gray-500">{option.sublabel}</span>
                )}
              </div>
              {((currentCourse === option.value && !isHeld && !option.isHold) || (option.isHold && isHeld)) && (
                <span className="ml-auto text-green-500">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Simple inline course buttons (alternative to dropdown)
interface CourseButtonsProps {
  currentCourse?: number | null
  isHeld?: boolean
  onSelect: (course: number | null, isHold: boolean) => void
  maxCourse?: number
  showHold?: boolean
  size?: 'xs' | 'sm'
}

export function CourseButtons({
  currentCourse,
  isHeld = false,
  onSelect,
  maxCourse = 5,
  showHold = true,
  size = 'xs',
}: CourseButtonsProps) {
  const buttonSize = size === 'xs' ? 'w-5 h-5 text-[9px]' : 'w-6 h-6 text-[10px]'

  return (
    <div className="flex items-center gap-0.5">
      {/* Clear */}
      <button
        onClick={() => onSelect(null, false)}
        className={`${buttonSize} rounded bg-gray-100 hover:bg-gray-200 text-gray-500 font-medium`}
        title="Remove course"
      >
        -
      </button>

      {/* ASAP */}
      <button
        onClick={() => onSelect(0, false)}
        className={`
          ${buttonSize} rounded font-medium text-white
          ${currentCourse === 0 && !isHeld ? 'bg-red-600 ring-2 ring-red-300' : 'bg-red-500 hover:bg-red-600'}
        `}
        title="ASAP - Fire immediately"
      >
        🔥
      </button>

      {/* Course numbers */}
      {Array.from({ length: maxCourse }, (_, i) => i + 1).map(num => (
        <button
          key={num}
          onClick={() => onSelect(num, false)}
          className={`
            ${buttonSize} rounded font-medium text-white
            ${currentCourse === num && !isHeld ? 'ring-2 ring-offset-1 ring-blue-400' : 'hover:opacity-80'}
          `}
          style={{
            backgroundColor: DEFAULT_COURSES.find(c => c.value === num)?.color || '#6B7280',
          }}
          title={`Course ${num}: ${DEFAULT_COURSES.find(c => c.value === num)?.sublabel}`}
        >
          {num}
        </button>
      ))}

      {/* Hold */}
      {showHold && (
        <button
          onClick={() => onSelect(currentCourse ?? null, !isHeld)}
          className={`
            ${buttonSize} rounded font-medium
            ${isHeld ? 'bg-red-600 text-white ring-2 ring-red-300 animate-pulse' : 'bg-red-100 text-red-700 hover:bg-red-200'}
          `}
          title={isHeld ? 'Release hold' : 'Hold item'}
        >
          ⏸
        </button>
      )}
    </div>
  )
}
