'use client'

import { useEffect, useState, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket, getTerminalId } from '@/lib/shared-socket'

// Socket.io client type
type SocketCallback = (...args: unknown[]) => void
type Socket = {
  connected: boolean
  emit: (event: string, data?: unknown) => void
  on: (event: string, callback: SocketCallback) => void
  off: (event: string, callback?: SocketCallback) => void
  connect: () => void
  disconnect: () => void
}

interface UseOrderSocketsOptions {
  locationId: string | undefined
  enabled?: boolean
  onOpenOrdersChanged?: (data: { locationId: string; trigger: string; orderId?: string }) => void
  onOrderTotalsUpdated?: (data: {
    orderId: string
    totals: {
      subtotal: number
      taxTotal: number
      tipTotal: number
      discountTotal: number
      total: number
    }
  }) => void
  onEntertainmentStatusChanged?: (data: {
    itemId: string
    entertainmentStatus: string
    currentOrderId: string | null
  }) => void
}

export function useOrderSockets(options: UseOrderSocketsOptions): { isConnected: boolean } {
  const { locationId, enabled = true } = options

  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  // Store callbacks in a ref so socket listeners always call the latest version
  // without triggering reconnection when callbacks change
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  useEffect(() => {
    if (!locationId || !enabled) return

    const socket = getSharedSocket() as Socket
    socketRef.current = socket

    // Named handlers so we can remove them explicitly on cleanup
    const onConnect = () => {
      setIsConnected(true)

      // Join location room via join_station (server joins location:{locationId} room)
      socket.emit('join_station', {
        locationId,
        tags: [],
        terminalId: getTerminalId(),
      })
    }

    const onDisconnect = () => {
      setIsConnected(false)
    }

    const onConnectError = (error: unknown) => {
      // Downgraded to warn — expected in dev when socket server isn't running
      console.warn('[Order Socket] Connection error (socket server may not be running):', error)
    }

    const onListChanged = (data: unknown) => {
      const payload = data as { locationId: string; trigger: string; orderId?: string }
      callbacksRef.current.onOpenOrdersChanged?.(payload)
    }

    const onTotalsUpdated = (data: unknown) => {
      const payload = data as {
        orderId: string
        totals: {
          subtotal: number
          taxTotal: number
          tipTotal: number
          discountTotal: number
          total: number
        }
      }
      callbacksRef.current.onOrderTotalsUpdated?.(payload)
    }

    const onEntertainmentChanged = (data: unknown) => {
      const payload = data as {
        itemId: string
        entertainmentStatus: string
        currentOrderId: string | null
      }
      callbacksRef.current.onEntertainmentStatusChanged?.(payload)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('orders:list-changed', onListChanged)
    socket.on('order:totals-updated', onTotalsUpdated)
    socket.on('entertainment:status-changed', onEntertainmentChanged)

    // If already connected (shared socket was created by another consumer), join immediately
    if (socket.connected) {
      onConnect()
    }

    // Cleanup: remove our listeners, release shared socket reference
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('orders:list-changed', onListChanged)
      socket.off('order:totals-updated', onTotalsUpdated)
      socket.off('entertainment:status-changed', onEntertainmentChanged)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [locationId, enabled])

  return { isConnected }
}
