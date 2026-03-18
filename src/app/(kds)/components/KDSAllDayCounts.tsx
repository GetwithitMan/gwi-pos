'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface AllDayCountItem {
  name: string
  count: number
}

interface KDSAllDayCountsProps {
  locationId: string
  resetHour?: number // from orderBehavior.allDayCountResetHour
  enabled?: boolean
}

export function KDSAllDayCounts({ locationId, resetHour = 4, enabled = true }: KDSAllDayCountsProps) {
  const [counts, setCounts] = useState<AllDayCountItem[]>([])
  const [since, setSince] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchCounts = useCallback(async () => {
    if (!locationId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/kds/all-day-counts?locationId=${encodeURIComponent(locationId)}&resetHour=${resetHour}`
      )
      if (!res.ok) return
      const json = await res.json()
      const data = json.data
      if (data) {
        setCounts(data.counts || [])
        setSince(data.since || null)
      }
    } catch {
      // Silently fail — panel is informational
    } finally {
      setLoading(false)
    }
  }, [locationId, resetHour])

  // Initial fetch + 60s polling
  useEffect(() => {
    if (!enabled) return

    fetchCounts()
    intervalRef.current = setInterval(fetchCounts, 60_000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, fetchCounts])

  if (!enabled) return null

  const totalItems = counts.reduce((sum, c) => sum + c.count, 0)

  const sinceFormatted = since
    ? new Date(since).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : null

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header — clickable toggle */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-750 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-semibold text-white">All Day Counts</span>
          {loading && (
            <span className="text-xs text-gray-500 ml-1">updating...</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {sinceFormatted && (
            <span className="text-xs text-gray-500">Since {sinceFormatted}</span>
          )}
          <span className="text-xs font-medium text-gray-400 bg-gray-700 px-2 py-0.5 rounded">
            {totalItems} items
          </span>
        </div>
      </button>

      {/* Collapsible content */}
      {isOpen && (
        <div className="border-t border-gray-700 max-h-80 overflow-y-auto">
          {counts.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-500 text-sm">
              No items sent to kitchen yet
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-2 font-medium">Item</th>
                  <th className="text-right px-4 py-2 font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((item) => (
                  <tr
                    key={item.name}
                    className="border-t border-gray-700/50 hover:bg-gray-750"
                  >
                    <td className="px-4 py-2 text-sm text-white">{item.name}</td>
                    <td className="px-4 py-2 text-sm text-right font-mono font-semibold text-blue-400">
                      {item.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
