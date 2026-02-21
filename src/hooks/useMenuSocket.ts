'use client'

import { useEffect, useState, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

// Socket.io client type (mirrors pattern from useOrderSockets.ts)
type SocketCallback = (...args: unknown[]) => void
type Socket = {
  connected: boolean
  emit: (event: string, data?: unknown) => void
  on: (event: string, callback: SocketCallback) => void
  off: (event: string, callback?: SocketCallback) => void
  connect: () => void
  disconnect: () => void
}

interface UseMenuSocketOptions {
  locationId: string
  onItemChanged?: (payload: {
    itemId: string
    action: 'created' | 'updated' | 'deleted' | 'restored'
    changes?: Record<string, unknown>
  }) => void
  onStockChanged?: (payload: {
    itemId: string
    stockStatus: string
    isOrderableOnline: boolean
  }) => void
  onStructureChanged?: (payload: {
    action: string
    entityId: string
    entityType: string
  }) => void
}

export function useMenuSocket(options: UseMenuSocketOptions): { isConnected: boolean } {
  const { locationId } = options

  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  // Store callbacks in a ref so socket listeners always call the latest version
  // without triggering reconnection when callbacks change
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  useEffect(() => {
    if (!locationId) return

    const socket = getSharedSocket() as Socket
    socketRef.current = socket

    // Named handlers so we can remove them explicitly on cleanup
    const onConnect = () => {
      setIsConnected(true)

      // Subscribe to the location room for menu events
      socket.emit('subscribe', `location:${locationId}`)
    }

    const onDisconnect = () => {
      setIsConnected(false)
    }

    const onConnectError = (error: unknown) => {
      console.warn('[Menu Socket] Connection error (socket server may not be running):', error)
    }

    const onItemChanged = (data: unknown) => {
      const payload = data as {
        itemId: string
        action: 'created' | 'updated' | 'deleted' | 'restored'
        changes?: Record<string, unknown>
      }
      callbacksRef.current.onItemChanged?.(payload)
    }

    const onStockChanged = (data: unknown) => {
      const payload = data as {
        itemId: string
        stockStatus: string
        isOrderableOnline: boolean
      }
      callbacksRef.current.onStockChanged?.(payload)
    }

    const onStructureChanged = (data: unknown) => {
      const payload = data as {
        action: string
        entityId: string
        entityType: string
      }
      callbacksRef.current.onStructureChanged?.(payload)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('menu:item-changed', onItemChanged)
    socket.on('menu:stock-changed', onStockChanged)
    socket.on('menu:structure-changed', onStructureChanged)

    // If already connected (shared socket was created by another consumer), subscribe immediately
    if (socket.connected) {
      onConnect()
    }

    // Cleanup: remove our listeners, release shared socket reference
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('menu:item-changed', onItemChanged)
      socket.off('menu:stock-changed', onStockChanged)
      socket.off('menu:structure-changed', onStructureChanged)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [locationId])

  return { isConnected }
}
