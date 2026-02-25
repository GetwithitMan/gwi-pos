'use client'

import { useEffect, useState } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

export function OfflineDisconnectBanner() {
  const [socketDisconnected, setSocketDisconnected] = useState(false)
  const [browserOffline, setBrowserOffline] = useState(false)

  // Socket.io connection tracking
  useEffect(() => {
    const socket = getSharedSocket()

    const onDisconnect = () => setSocketDisconnected(true)
    const onConnect = () => setSocketDisconnected(false)

    socket.on('disconnect', onDisconnect)
    socket.on('connect', onConnect)

    if (!socket.connected) {
      setSocketDisconnected(true)
    }

    return () => {
      socket.off('disconnect', onDisconnect)
      socket.off('connect', onConnect)
      releaseSharedSocket()
    }
  }, [])

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

  if (!socketDisconnected && !browserOffline) return null

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
