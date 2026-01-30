'use client'

import { useState, useEffect, useCallback } from 'react'
import { CourseIndicator } from './CourseIndicator'

interface CourseItem {
  id: string
  name: string
  seatNumber: number | null
  courseStatus: string
  isHeld: boolean
  firedAt: string | null
}

interface Course {
  courseNumber: number
  name: string
  displayName?: string
  color: string
  status: string
  itemCount: number
  firedCount: number
  readyCount: number
  servedCount: number
  heldCount: number
  items: CourseItem[]
}

interface CourseOverviewPanelProps {
  orderId: string
  onCourseUpdate: () => void
}

export function CourseOverviewPanel({ orderId, onCourseUpdate }: CourseOverviewPanelProps) {
  const [courses, setCourses] = useState<Course[]>([])
  const [currentCourse, setCurrentCourse] = useState(1)
  const [courseMode, setCourseMode] = useState<'off' | 'manual' | 'auto'>('off')
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const fetchCourses = useCallback(async () => {
    if (!orderId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/courses`)
      if (res.ok) {
        const data = await res.json()
        setCourses(data.courses || [])
        setCurrentCourse(data.currentCourse || 1)
        setCourseMode(data.courseMode || 'off')
      }
    } catch (error) {
      console.error('Failed to fetch courses:', error)
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    if (isOpen && orderId) {
      fetchCourses()
    }
  }, [isOpen, orderId, fetchCourses])

  const handleCourseAction = async (courseNumber: number, action: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseNumber, action }),
      })

      if (res.ok) {
        fetchCourses()
        onCourseUpdate()
      }
    } catch (error) {
      console.error('Failed to update course:', error)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'fired': return 'bg-yellow-500'
      case 'ready': return 'bg-green-500'
      case 'served': return 'bg-gray-400'
      case 'held': return 'bg-red-500'
      default: return 'bg-blue-500'
    }
  }

  const getStatusTextColor = (status: string) => {
    switch (status) {
      case 'fired': return 'text-yellow-700 bg-yellow-100'
      case 'ready': return 'text-green-700 bg-green-100'
      case 'served': return 'text-gray-600 bg-gray-100'
      case 'held': return 'text-red-700 bg-red-100'
      default: return 'text-blue-700 bg-blue-100'
    }
  }

  if (!orderId) return null

  // Check if there are any items with course numbers
  const hasCourses = courses.length > 0 && courses.some(c => c.courseNumber > 0)

  return (
    <div className="border-t border-gray-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-between"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          Course Manager
          {hasCourses && (
            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
              {courses.filter(c => c.courseNumber > 0).length} courses
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="px-4 py-3 bg-gray-50">
          {loading ? (
            <div className="text-center text-gray-500 text-sm py-4">Loading courses...</div>
          ) : !hasCourses ? (
            <div className="text-center text-gray-500 text-sm py-4">
              <p>No courses assigned yet.</p>
              <p className="text-xs mt-1">Assign items to courses using the item controls above.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {courses
                .filter(c => c.courseNumber > 0)
                .sort((a, b) => a.courseNumber - b.courseNumber)
                .map(course => (
                  <div
                    key={course.courseNumber}
                    className="bg-white rounded-lg p-3 shadow-sm border border-gray-200"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${getStatusColor(course.status)}`} />
                        <span className="font-medium">Course {course.courseNumber}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${getStatusTextColor(course.status)}`}>
                          {course.status}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {course.itemCount} items
                        {course.readyCount > 0 && ` • ${course.readyCount} ready`}
                        {course.servedCount > 0 && ` • ${course.servedCount} served`}
                      </span>
                    </div>

                    {/* Course Items */}
                    <div className="text-xs text-gray-600 mb-2 max-h-20 overflow-y-auto">
                      {course.items.map((item, idx) => (
                        <div key={item.id} className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            item.isHeld ? 'bg-red-400' :
                            item.courseStatus === 'ready' ? 'bg-green-400' :
                            item.courseStatus === 'fired' ? 'bg-yellow-400' :
                            item.courseStatus === 'served' ? 'bg-gray-400' :
                            'bg-blue-400'
                          }`} />
                          <span>{item.name}</span>
                          {item.seatNumber && (
                            <span className="text-purple-600">(S{item.seatNumber})</span>
                          )}
                          {item.isHeld && (
                            <span className="text-red-600 font-medium">HELD</span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Course Actions */}
                    <div className="flex gap-2">
                      {course.status === 'pending' && (
                        <button
                          onClick={() => handleCourseAction(course.courseNumber, 'fire')}
                          className="flex-1 px-2 py-1.5 text-xs font-medium rounded bg-yellow-500 text-white hover:bg-yellow-600"
                        >
                          🔥 Fire Course
                        </button>
                      )}
                      {course.status === 'pending' && (
                        <button
                          onClick={() => handleCourseAction(course.courseNumber, 'hold')}
                          className="px-2 py-1.5 text-xs font-medium rounded bg-red-100 text-red-700 hover:bg-red-200"
                        >
                          Hold All
                        </button>
                      )}
                      {course.status === 'fired' && (
                        <button
                          onClick={() => handleCourseAction(course.courseNumber, 'mark_ready')}
                          className="flex-1 px-2 py-1.5 text-xs font-medium rounded bg-green-500 text-white hover:bg-green-600"
                        >
                          ✓ All Ready
                        </button>
                      )}
                      {course.status === 'ready' && (
                        <button
                          onClick={() => handleCourseAction(course.courseNumber, 'mark_served')}
                          className="flex-1 px-2 py-1.5 text-xs font-medium rounded bg-blue-500 text-white hover:bg-blue-600"
                        >
                          ✓ All Served
                        </button>
                      )}
                      {course.status === 'held' && (
                        <button
                          onClick={() => handleCourseAction(course.courseNumber, 'fire')}
                          className="flex-1 px-2 py-1.5 text-xs font-medium rounded bg-green-500 text-white hover:bg-green-600"
                        >
                          🔥 Fire Course
                        </button>
                      )}
                    </div>
                  </div>
                ))}

              {/* Quick fire all button */}
              {courses.some(c => c.status === 'pending' && c.courseNumber > 0) && (
                <div className="pt-2 border-t border-gray-200">
                  <button
                    onClick={async () => {
                      for (const course of courses.filter(c => c.status === 'pending' && c.courseNumber > 0)) {
                        await handleCourseAction(course.courseNumber, 'fire')
                      }
                    }}
                    className="w-full px-3 py-2 text-sm font-medium rounded bg-orange-500 text-white hover:bg-orange-600"
                  >
                    🔥 Fire All Pending Courses
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
