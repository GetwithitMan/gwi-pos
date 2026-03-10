'use client'

import { useEffect, useState, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

/**
 * OutageBanner — displays a persistent amber banner when the upstream sync
 * worker detects an internet outage (3 consecutive Neon failures).
 *
 * Listens for:
 * - `sync:outage-status` { isInOutage: boolean } → show/hide banner
 *
 * Also checks /api/health on mount to catch already-active outages
 * (e.g., page refresh while outage is in progress).
 *
 * When outage clears, shows a brief green "Connection restored" flash
 * for 3 seconds before hiding.
 */
export function OutageBanner() {
  const [isInOutage, setIsInOutage] = useState(false)
  const [showRestored, setShowRestored] = useState(false)
  const wasInOutageRef = useRef(false)
  const restoredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check health API on mount for existing outage state
  useEffect(() => {
    let cancelled = false
    async function checkHealth() {
      try {
        const res = await fetch('/api/health')
        if (!res.ok) return
        const json = await res.json()
        const health = json.data
        if (!cancelled && health?.upstreamSync?.inOutage) {
          setIsInOutage(true)
          wasInOutageRef.current = true
        }
      } catch {
        // Non-critical — socket events will catch it
      }
    }
    checkHealth()
    return () => { cancelled = true }
  }, [])

  // Listen for socket events
  useEffect(() => {
    const socket = getSharedSocket()

    const onOutageStatus = (data: { isInOutage: boolean }) => {
      if (data.isInOutage) {
        // Clear any pending "restored" timer
        if (restoredTimerRef.current) {
          clearTimeout(restoredTimerRef.current)
          restoredTimerRef.current = null
        }
        setShowRestored(false)
        setIsInOutage(true)
        wasInOutageRef.current = true
      } else {
        setIsInOutage(false)
        // Only show "restored" flash if we were previously in outage
        if (wasInOutageRef.current) {
          setShowRestored(true)
          wasInOutageRef.current = false
          restoredTimerRef.current = setTimeout(() => {
            setShowRestored(false)
            restoredTimerRef.current = null
          }, 3000)
        }
      }
    }

    socket.on('sync:outage-status', onOutageStatus)

    return () => {
      socket.off('sync:outage-status', onOutageStatus)
      releaseSharedSocket()
      if (restoredTimerRef.current) {
        clearTimeout(restoredTimerRef.current)
      }
    }
  }, [])

  // Show green "restored" flash
  if (showRestored) {
    return (
      <div
        role="status"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9997,
          backgroundColor: '#22c55e',
          color: '#fff',
          textAlign: 'center',
          padding: '6px 16px',
          fontSize: '14px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        Connection restored
      </div>
    )
  }

  // Show amber outage banner
  if (!isInOutage) return null

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9997,
        backgroundColor: '#f59e0b',
        color: '#000',
        textAlign: 'center',
        padding: '6px 16px',
        fontSize: '14px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      Internet connection lost &mdash; operating in offline mode. Orders are being saved locally.
    </div>
  )
}
