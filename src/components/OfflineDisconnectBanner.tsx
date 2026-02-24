'use client'

import { useEffect, useState } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

export function OfflineDisconnectBanner() {
  const [disconnected, setDisconnected] = useState(false)

  useEffect(() => {
    const socket = getSharedSocket()

    const onDisconnect = () => setDisconnected(true)
    const onConnect = () => setDisconnected(false)

    socket.on('disconnect', onDisconnect)
    socket.on('connect', onConnect)

    // Set initial state
    if (!socket.connected) {
      setDisconnected(true)
    }

    return () => {
      socket.off('disconnect', onDisconnect)
      socket.off('connect', onConnect)
      releaseSharedSocket()
    }
  }, [])

  if (!disconnected) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        backgroundColor: '#f59e0b',
        color: '#000',
        textAlign: 'center',
        padding: '6px 16px',
        fontSize: '14px',
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '14px',
          height: '14px',
          border: '2px solid #000',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
      />
      Connection lost — reconnecting...
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
