'use client'

/**
 * Thin React hook for socket.io via getSharedSocket().
 *
 * All socket consumers should use this hook (or getSharedSocket() directly)
 * instead of the useEvents() provider abstraction.
 *
 * Returns { socket, isConnected } — callers use socket.on/off directly.
 */

import { useEffect, useState, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import type { Socket } from 'socket.io-client'

export function useSocket(): { socket: Socket | null; isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = getSharedSocket()
    socketRef.current = socket

    const onConnect = () => setIsConnected(true)
    const onDisconnect = () => setIsConnected(false)

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)

    // If already connected (shared socket created by another consumer)
    if (socket.connected) {
      setIsConnected(true)
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [])

  return { socket: socketRef.current, isConnected }
}
