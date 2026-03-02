'use client'

/**
 * Thin React hook for socket.io via getSharedSocket().
 *
 * All socket consumers should use this hook (or getSharedSocket() directly)
 * instead of the useEvents() provider abstraction.
 *
 * Returns { socket, isConnected } — callers use socket.on/off directly.
 */

import { useEffect, useState } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import type { Socket } from 'socket.io-client'

export function useSocket(): { socket: Socket | null; isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)

  useEffect(() => {
    const s = getSharedSocket()
    setSocket(s)

    const onConnect = () => setIsConnected(true)
    const onDisconnect = () => setIsConnected(false)

    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)

    // If already connected (shared socket created by another consumer)
    if (s.connected) {
      setIsConnected(true)
    }

    return () => {
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      setSocket(null)
      releaseSharedSocket()
    }
  }, [])

  return { socket, isConnected }
}
