'use client'

import { useEffect, useState } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { SOCKET_EVENTS } from '@/lib/socket-events'

/**
 * FailoverBanner — displays a persistent amber banner when the backup server
 * has been promoted to primary (failover active).
 *
 * Listens for:
 * - `server:failover-active`   → show banner
 * - `server:failover-resolved` → hide banner
 *
 * Also checks /api/health on mount to catch already-active failovers
 * (e.g., page refresh while failover is in progress).
 */
export function FailoverBanner() {
  const [failoverActive, setFailoverActive] = useState(false)
  const [failoverSince, setFailoverSince] = useState<string | null>(null)

  // Check health API on mount for existing failover state
  useEffect(() => {
    let cancelled = false
    async function checkHealth() {
      try {
        const res = await fetch('/api/health')
        if (!res.ok) return
        const json = await res.json()
        const health = json.data
        if (!cancelled && health?.isPromotedBackup) {
          setFailoverActive(true)
          setFailoverSince(health.timestamp || new Date().toISOString())
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

    const onFailoverActive = (data: { message: string; since: string }) => {
      setFailoverActive(true)
      setFailoverSince(data.since)
    }

    const onFailoverResolved = () => {
      setFailoverActive(false)
      setFailoverSince(null)
    }

    socket.on(SOCKET_EVENTS.SERVER_FAILOVER_ACTIVE, onFailoverActive)
    socket.on(SOCKET_EVENTS.SERVER_FAILOVER_RESOLVED, onFailoverResolved)

    return () => {
      socket.off(SOCKET_EVENTS.SERVER_FAILOVER_ACTIVE, onFailoverActive)
      socket.off(SOCKET_EVENTS.SERVER_FAILOVER_RESOLVED, onFailoverResolved)
      releaseSharedSocket()
    }
  }, [])

  if (!failoverActive) return null

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9998,
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
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      Backup Server Active &mdash; Primary server is being restored
      {failoverSince && (
        <span style={{ fontSize: '11px', opacity: 0.7, marginLeft: '8px' }}>
          (since {new Date(failoverSince).toLocaleTimeString()})
        </span>
      )}
    </div>
  )
}
