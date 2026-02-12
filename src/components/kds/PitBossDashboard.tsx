'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'

/**
 * PitBossDashboard - Entertainment Expo for gaming areas
 *
 * Features:
 * - Timed heatmap: Green -> Yellow -> Pulsing Red as expiration approaches
 * - Waitlist integration
 * - "ADD 30 MIN" and "STOP SESSION" quick actions
 */

interface EntertainmentTable {
  id: string
  name: string
  displayName?: string
  abbreviation?: string
  status: 'available' | 'in_use' | 'maintenance'
  currentOrder?: {
    id: string
    orderNumber: number
    tabName?: string
  }
  timeInfo?: {
    startedAt: Date
    expiresAt: Date
    blockMinutes: number
  }
}

interface ActiveSession {
  id: string
  partyName: string
  tables: EntertainmentTable[]
  startTime: Date
  totalMinutes: number
}

interface WaitlistEntry {
  id: string
  customerName: string
  partySize: number
  menuItem: {
    id: string
    name: string
  }
  createdAt: Date
  waitMinutes: number
  notes?: string
}

interface PitBossDashboardProps {
  locationId: string
  entertainmentItems?: EntertainmentTable[]
  waitlist?: WaitlistEntry[]
  onRefresh?: () => void
  onAddTime?: (tableId: string, minutes: number) => Promise<void>
  onStopSession?: (tableId: string) => Promise<void>
  onAssignWaitlist?: (waitlistId: string, tableId: string) => Promise<void>
}

// Calculate time remaining with urgency level
function calculateTimeRemaining(expiresAt: Date | string): {
  totalSeconds: number
  formatted: string
  urgencyLevel: 'normal' | 'warning' | 'critical'
  isExpired: boolean
} {
  const expires = new Date(expiresAt)
  const now = new Date()
  const totalSeconds = Math.floor((expires.getTime() - now.getTime()) / 1000)

  if (totalSeconds <= 0) {
    return {
      totalSeconds: 0,
      formatted: 'EXPIRED',
      urgencyLevel: 'critical',
      isExpired: true,
    }
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  let urgencyLevel: 'normal' | 'warning' | 'critical' = 'normal'
  if (minutes <= 5) urgencyLevel = 'critical'
  else if (minutes <= 15) urgencyLevel = 'warning'

  const formatted =
    minutes > 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : `${minutes}:${seconds.toString().padStart(2, '0')}`

  return {
    totalSeconds,
    formatted,
    urgencyLevel,
    isExpired: false,
  }
}

// Get color based on urgency
function getUrgencyColor(level: 'normal' | 'warning' | 'critical'): string {
  switch (level) {
    case 'critical':
      return 'text-red-500'
    case 'warning':
      return 'text-amber-400'
    default:
      return 'text-green-400'
  }
}

function getProgressBarColor(level: 'normal' | 'warning' | 'critical'): string {
  switch (level) {
    case 'critical':
      return 'bg-red-500'
    case 'warning':
      return 'bg-amber-400'
    default:
      return 'bg-green-500'
  }
}

export function PitBossDashboard({
  locationId,
  entertainmentItems = [],
  waitlist = [],
  onRefresh,
  onAddTime,
  onStopSession,
  onAssignWaitlist,
}: PitBossDashboardProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  // Update time every second for accurate countdowns
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Build active sessions (one per in-use table)
  const activeSessions = useMemo(() => {
    const inUseItems = entertainmentItems.filter(
      (item) => item.status === 'in_use' && item.currentOrder
    )

    return inUseItems.map((item) => ({
      id: item.id,
      partyName: item.currentOrder?.tabName || 'Walk-in',
      tables: [item],
      startTime: item.timeInfo?.startedAt || new Date(),
      totalMinutes: item.timeInfo?.blockMinutes || 60,
    })).sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    )
  }, [entertainmentItems])

  // Available tables
  const availableTables = useMemo(
    () => entertainmentItems.filter((item) => item.status === 'available'),
    [entertainmentItems]
  )

  // Handle add time
  const handleAddTime = async (tableId: string, minutes: number = 30) => {
    if (!onAddTime) return
    setIsLoading(true)
    try {
      await onAddTime(tableId, minutes)
      onRefresh?.()
    } catch (error) {
      console.error('Failed to add time:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Handle stop session
  const handleStopSession = async (tableId: string) => {
    if (!onStopSession) return
    setIsLoading(true)
    try {
      await onStopSession(tableId)
      onRefresh?.()
    } catch (error) {
      console.error('Failed to stop session:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 overflow-hidden">
      {/* Main Game Floor */}
      <main className="flex-1 p-6 overflow-y-auto border-r border-slate-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black flex items-center gap-2">
            <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
            ACTIVE SESSIONS
          </h2>
          <div className="flex items-center gap-4">
            <span className="text-slate-400 text-sm">
              {activeSessions.length} active |{' '}
              {availableTables.length} available
            </span>
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isLoading}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <svg
                  className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {activeSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-12 h-12 text-cyan-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <p className="text-slate-400 text-xl">No active sessions</p>
            <p className="text-slate-500 text-sm mt-2">
              {availableTables.length} tables ready for customers
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {activeSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onAddTime={handleAddTime}
                onStopSession={handleStopSession}
              />
            ))}
          </div>
        )}

        {/* Available Tables */}
        {availableTables.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-bold text-slate-400 mb-4">
              AVAILABLE TABLES
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {availableTables.map((table) => (
                <div
                  key={table.id}
                  className="p-4 bg-slate-900/50 border border-slate-700 rounded-lg text-center"
                >
                  <div className="text-lg font-bold text-cyan-400">
                    {table.displayName || table.name}
                  </div>
                  <div className="text-xs text-green-500 uppercase mt-1">
                    Available
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Waitlist Sidebar */}
      <aside className="w-96 bg-slate-900/50 p-4 flex flex-col">
        <h2 className="text-lg font-bold mb-4 text-cyan-400 uppercase tracking-widest">
          Waitlist Queue
        </h2>

        {waitlist.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-slate-500 text-center">
              No one waiting
              <br />
              <span className="text-xs">Add customers from POS</span>
            </p>
          </div>
        ) : (
          <div className="space-y-3 overflow-y-auto flex-1">
            {waitlist.map((entry) => (
              <div
                key={entry.id}
                className="p-4 bg-slate-800 rounded-xl border border-slate-700 shadow-sm hover:border-cyan-500/50 transition-colors cursor-pointer"
              >
                <div className="flex justify-between items-start">
                  <span className="font-bold">{entry.customerName}</span>
                  <span className="text-xs text-slate-500">
                    {entry.waitMinutes}m
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {entry.menuItem.name} | Party of {entry.partySize}
                </p>
                {entry.notes && (
                  <p className="text-xs text-amber-400/70 mt-1 italic">
                    {entry.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Quick Stats */}
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-green-400">
                {activeSessions.reduce((sum, s) => sum + s.tables.length, 0)}
              </div>
              <div className="text-xs text-slate-500 uppercase">In Use</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-cyan-400">
                {waitlist.length}
              </div>
              <div className="text-xs text-slate-500 uppercase">Waiting</div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

// Session Card Component
function SessionCard({
  session,
  onAddTime,
  onStopSession,
}: {
  session: ActiveSession
  onAddTime: (tableId: string, minutes: number) => void
  onStopSession: (tableId: string) => void
}) {
  return (
    <div
      className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
    >
      {/* Header */}
      <div className="p-4 bg-slate-800/50 border-b border-slate-700 flex justify-between items-center">
        <h3 className="font-black text-lg text-white truncate max-w-[200px]">
          {session.partyName}
        </h3>
      </div>

      {/* Tables in session */}
      <div className="p-4 space-y-4">
        {session.tables.map((table) => {
          const time = table.timeInfo
            ? calculateTimeRemaining(table.timeInfo.expiresAt)
            : null
          const progress = time && table.timeInfo
            ? (time.totalSeconds / (table.timeInfo.blockMinutes * 60)) * 100
            : 0

          return (
            <div
              key={table.id}
              className="flex items-center justify-between gap-4"
            >
              <div className="flex-1">
                <div className="text-sm font-bold">
                  {table.displayName || table.name}
                </div>
                {/* Progress Bar */}
                <div className="w-full h-2 bg-slate-800 rounded-full mt-1 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-1000 ${
                      time ? getProgressBarColor(time.urgencyLevel) : 'bg-slate-600'
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                  />
                </div>
              </div>
              <div
                className={`font-mono text-xl font-bold ${
                  time ? getUrgencyColor(time.urgencyLevel) : 'text-slate-400'
                } ${time?.urgencyLevel === 'critical' ? 'animate-pulse' : ''}`}
              >
                {time?.formatted || '--:--'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 border-t border-slate-700">
        <button
          onClick={() => onAddTime(session.tables[0].id, 30)}
          className="py-3 text-xs font-bold hover:bg-slate-800 border-r border-slate-700 transition-colors text-cyan-400"
        >
          ADD 30 MIN
        </button>
        <button
          onClick={() => {
            if (confirm('Stop this session?')) {
              session.tables.forEach((t) => onStopSession(t.id))
            }
          }}
          className="py-3 text-xs font-bold text-red-400 hover:bg-red-500/10 transition-colors"
        >
          STOP SESSION
        </button>
      </div>
    </div>
  )
}
