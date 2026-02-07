'use client'

import { useState, useEffect, useRef } from 'react'

interface CourseDelayControlsProps {
  courseNumber: number
  delay?: { delayMinutes: number; startedAt?: string; firedAt?: string }
  onSetDelay: (courseNumber: number, minutes: number) => void
  onFireNow: (courseNumber: number) => void
  isSent: boolean  // true if this course was already fired
}

/**
 * Delay controls rendered between course groups in OrderPanel when coursing is enabled.
 * Shows preset delay buttons, countdown timer, or "Fired" status.
 */
export function CourseDelayControls({
  courseNumber,
  delay,
  onSetDelay,
  onFireNow,
  isSent,
}: CourseDelayControlsProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Timer countdown
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)

    if (delay?.startedAt && !delay.firedAt) {
      const tick = () => {
        const started = new Date(delay.startedAt!).getTime()
        const now = Date.now()
        const elapsed = (now - started) / 1000
        const total = delay.delayMinutes * 60
        const remaining = Math.max(0, total - elapsed)
        setRemainingSeconds(Math.ceil(remaining))

        if (remaining <= 0) {
          // Auto-fire when timer reaches zero
          onFireNow(courseNumber)
          if (intervalRef.current) clearInterval(intervalRef.current)
        }
      }
      tick()
      intervalRef.current = setInterval(tick, 1000)
    } else {
      setRemainingSeconds(null)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [delay?.startedAt, delay?.firedAt, delay?.delayMinutes, courseNumber, onFireNow])

  // Already fired
  if (isSent || delay?.firedAt) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        background: 'rgba(34, 197, 94, 0.1)',
        borderRadius: '6px',
        marginTop: '4px',
      }}>
        <svg width="14" height="14" fill="none" stroke="#22c55e" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: 600 }}>
          Course {courseNumber} Fired
        </span>
      </div>
    )
  }

  // Timer running
  if (remainingSeconds !== null && delay?.startedAt) {
    const minutes = Math.floor(remainingSeconds / 60)
    const seconds = remainingSeconds % 60
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        background: 'rgba(251, 191, 36, 0.1)',
        border: '1px solid rgba(251, 191, 36, 0.2)',
        borderRadius: '6px',
        marginTop: '4px',
      }}>
        <svg width="14" height="14" fill="none" stroke="#fbbf24" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 600, fontFamily: 'monospace' }}>
          Fires in {timeStr}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onFireNow(courseNumber) }}
          style={{
            marginLeft: 'auto',
            padding: '3px 8px',
            fontSize: '10px',
            fontWeight: 600,
            borderRadius: '4px',
            border: 'none',
            background: 'rgba(239, 68, 68, 0.2)',
            color: '#f87171',
            cursor: 'pointer',
          }}
        >
          Fire Now
        </button>
      </div>
    )
  }

  // Delay presets (no timer started yet)
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 0',
      marginTop: '4px',
    }}>
      <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>Delay:</span>
      {[5, 10, 15].map(mins => (
        <button
          key={mins}
          onClick={(e) => { e.stopPropagation(); onSetDelay(courseNumber, mins) }}
          style={{
            padding: '3px 8px',
            fontSize: '10px',
            fontWeight: 500,
            borderRadius: '4px',
            border: `1px solid ${delay?.delayMinutes === mins ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
            background: delay?.delayMinutes === mins ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
            color: delay?.delayMinutes === mins ? '#a5b4fc' : '#94a3b8',
            cursor: 'pointer',
          }}
        >
          {mins}m
        </button>
      ))}
      <button
        onClick={(e) => { e.stopPropagation(); onSetDelay(courseNumber, -1) }}
        style={{
          padding: '3px 8px',
          fontSize: '10px',
          fontWeight: 500,
          borderRadius: '4px',
          border: `1px solid ${delay?.delayMinutes === -1 ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
          background: delay?.delayMinutes === -1 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.04)',
          color: delay?.delayMinutes === -1 ? '#fbbf24' : '#94a3b8',
          cursor: 'pointer',
        }}
      >
        Hold
      </button>
    </div>
  )
}
