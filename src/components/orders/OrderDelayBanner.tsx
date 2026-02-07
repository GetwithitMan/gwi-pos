'use client'

import { useState, useEffect, useRef } from 'react'

interface OrderDelayBannerProps {
  /** Delay preset in minutes (5, 10, etc.) — shown before timer starts */
  delayMinutes: number
  /** ISO timestamp when delay timer started (null = not started yet) */
  startedAt: string | null
  /** ISO timestamp when items were fired (null = not fired yet) */
  firedAt: string | null
  /** Called when countdown reaches zero — auto-fire items */
  onAutoFire: () => void
  /** Called when user taps "Fire Now" to manually fire before timer */
  onFireNow: () => void
  /** Called when user taps "Cancel" to remove delay */
  onCancelDelay: () => void
}

/**
 * Countdown banner displayed at the top of OrderPanel's pending section.
 *
 * Three states:
 *   1. Preset set, timer not started → "⏱ 5m delay set — starts on Send"
 *   2. Timer running → "⏱ Fires in 3:42  [Fire Now]"
 *   3. Fired → "✓ Fired" (green)
 */
export function OrderDelayBanner({
  delayMinutes,
  startedAt,
  firedAt,
  onAutoFire,
  onFireNow,
  onCancelDelay,
}: OrderDelayBannerProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasFiredRef = useRef(false)

  // Timer countdown
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    hasFiredRef.current = false

    if (startedAt && !firedAt) {
      const tick = () => {
        const started = new Date(startedAt).getTime()
        const now = Date.now()
        const elapsed = (now - started) / 1000
        const total = delayMinutes * 60
        const remaining = Math.max(0, total - elapsed)
        setRemainingSeconds(Math.ceil(remaining))

        if (remaining <= 0 && !hasFiredRef.current) {
          hasFiredRef.current = true
          onAutoFire()
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
  }, [startedAt, firedAt, delayMinutes, onAutoFire])

  // Already fired
  if (firedAt) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 12px',
        background: 'rgba(34, 197, 94, 0.12)',
        border: '1px solid rgba(34, 197, 94, 0.25)',
        borderRadius: '8px',
        marginBottom: '12px',
      }}>
        <svg width="14" height="14" fill="none" stroke="#22c55e" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span style={{ fontSize: '12px', color: '#4ade80', fontWeight: 600 }}>
          Delayed items fired
        </span>
      </div>
    )
  }

  // Timer running
  if (remainingSeconds !== null && startedAt) {
    const minutes = Math.floor(remainingSeconds / 60)
    const seconds = remainingSeconds % 60
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
    const isUrgent = remainingSeconds <= 30

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        background: isUrgent ? 'rgba(239, 68, 68, 0.12)' : 'rgba(251, 191, 36, 0.12)',
        border: `1px solid ${isUrgent ? 'rgba(239, 68, 68, 0.3)' : 'rgba(251, 191, 36, 0.25)'}`,
        borderRadius: '8px',
        marginBottom: '12px',
        animation: isUrgent ? 'pulse 1s ease-in-out infinite' : undefined,
      }}>
        <svg width="16" height="16" fill="none" stroke={isUrgent ? '#f87171' : '#fbbf24'} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span style={{
          fontSize: '13px',
          color: isUrgent ? '#f87171' : '#fbbf24',
          fontWeight: 700,
          fontFamily: 'monospace',
          flex: 1,
        }}>
          Fires in {timeStr}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onFireNow() }}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 700,
            borderRadius: '6px',
            border: 'none',
            background: 'rgba(239, 68, 68, 0.25)',
            color: '#f87171',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          Fire Now
        </button>
      </div>
    )
  }

  // Preset set but not started yet (timer starts on Send)
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      background: 'rgba(59, 130, 246, 0.1)',
      border: '1px solid rgba(59, 130, 246, 0.2)',
      borderRadius: '8px',
      marginBottom: '12px',
    }}>
      <svg width="14" height="14" fill="none" stroke="#60a5fa" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span style={{ fontSize: '12px', color: '#60a5fa', fontWeight: 600, flex: 1 }}>
        {delayMinutes}m delay — starts on Send
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onCancelDelay() }}
        style={{
          padding: '3px 8px',
          fontSize: '10px',
          fontWeight: 600,
          borderRadius: '4px',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.08)',
          color: '#94a3b8',
          cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  )
}
