'use client'

import { useEffect } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

// Read from build-time env (injected by next.config.ts from package.json)
const CLIENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'

/**
 * Reports the client's app version to the server on socket connect.
 * Enables the server to track stale clients needing refresh.
 */
export function useVersionHandshake() {
  useEffect(() => {
    const socket = getSharedSocket()

    const reportVersion = () => {
      socket.emit('client:version', {
        clientVersion: CLIENT_VERSION,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      })
    }

    // Report on connect and reconnect
    if (socket.connected) {
      reportVersion()
    }
    socket.on('connect', reportVersion)

    return () => {
      socket.off('connect', reportVersion)
      releaseSharedSocket()
    }
  }, [])
}
