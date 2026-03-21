'use client'

import { useEffect, useState, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

export function OfflineDisconnectBanner() {
  const [showBanner, setShowBanner] = useState(false)
  const [browserOffline, setBrowserOffline] = useState(false)
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Don't show socket banner on cloud/Vercel — no Socket.IO server there
  const isCloud = typeof window !== 'undefined' &&
    (window.location.hostname.includes('vercel') ||
     window.location.hostname.includes('ordercontrolcenter') ||
     window.location.hostname.includes('barpos.restaurant') ||
     window.location.hostname.includes('thepasspos.com'))

  // Socket.io connection tracking — only on local NUC
  useEffect(() => {
    if (isCloud) return

    const socket = getSharedSocket()

    const onDisconnect = () => {
      // Grace period: only show banner after 10s of sustained disconnect
      // Prevents flashing during brief reconnects
      if (disconnectTimer.current) clearTimeout(disconnectTimer.current)
      disconnectTimer.current = setTimeout(() => setShowBanner(true), 10000)
    }
    const onConnect = () => {
      if (disconnectTimer.current) clearTimeout(disconnectTimer.current)
      disconnectTimer.current = null
      setShowBanner(false)
    }

    socket.on('disconnect', onDisconnect)
    socket.on('connect', onConnect)

    // Don't immediately show banner on mount — give socket time to connect
    if (!socket.connected) {
      disconnectTimer.current = setTimeout(() => setShowBanner(true), 15000)
    }

    return () => {
      socket.off('disconnect', onDisconnect)
      socket.off('connect', onConnect)
      if (disconnectTimer.current) clearTimeout(disconnectTimer.current)
      releaseSharedSocket()
    }
  }, [isCloud])

  // Browser online/offline tracking
  useEffect(() => {
    const goOffline = () => setBrowserOffline(true)
    const goOnline = () => setBrowserOffline(false)

    setBrowserOffline(!navigator.onLine)

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  // Cloud mode: only show if browser is actually offline
  if (isCloud && !browserOffline) return null
  // Local mode: show if socket disconnected for 10s+ or browser offline
  if (!showBanner && !browserOffline) return null

  // Red for fully offline, amber for socket-only disconnect
  const isFullyOffline = browserOffline
  const bgColor = isFullyOffline ? '#ef4444' : '#f59e0b'
  const textColor = isFullyOffline ? '#fff' : '#000'
  const borderColor = isFullyOffline ? '#fff' : '#000'
  const message = isFullyOffline
    ? 'No network connection — orders will not sync'
    : 'Connection lost — reconnecting...'

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        backgroundColor: bgColor,
        color: textColor,
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
      {!isFullyOffline && (
        <span
          style={{
            display: 'inline-block',
            width: '14px',
            height: '14px',
            border: `2px solid ${borderColor}`,
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }}
        />
      )}
      {isFullyOffline && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      )}
      {message}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
