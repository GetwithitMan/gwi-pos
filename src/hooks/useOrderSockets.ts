'use client'

import { useEffect, useState, useRef } from 'react'

// Socket.io client type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SocketCallback = (...args: any[]) => void
type Socket = {
  connected: boolean
  emit: (event: string, data?: unknown) => void
  on: (event: string, callback: SocketCallback) => void
  off: (event: string, callback?: SocketCallback) => void
  connect: () => void
  disconnect: () => void
}

// Stable terminal ID — generated once per browser tab, persists across re-mounts
let stableTerminalId: string | null = null
function getTerminalId(): string {
  if (!stableTerminalId) {
    stableTerminalId = 'pos-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  }
  return stableTerminalId
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

    let socket: Socket | null = null

    // Named handlers so we can remove them explicitly on cleanup
    const onConnect = () => {
      setIsConnected(true)

      // Join location room via join_station (server joins location:{locationId} room)
      socket!.emit('join_station', {
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

    const onJoined = (_response: { success: boolean; rooms: number }) => {
    }

    async function initSocket() {
      try {
        const { io } = await import('socket.io-client')

        const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin

        socket = io(serverUrl, {
          path: '/api/socket',
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 3,
          reconnectionDelay: 2000,
          reconnectionDelayMax: 10000,
        }) as Socket

        socketRef.current = socket

        socket.on('connect', onConnect)
        socket.on('disconnect', onDisconnect)
        socket.on('connect_error', onConnectError)

        // orders:list-changed covers creates, pays, voids, transfers
        // (no separate order:created listener — that's a KDS event and would double-refresh)
        socket.on('orders:list-changed', onListChanged)
        socket.on('order:totals-updated', onTotalsUpdated)
        socket.on('entertainment:status-changed', onEntertainmentChanged)
        socket.on('joined', onJoined)
      } catch (error) {
        console.error('[Order Socket] Failed to initialize:', error)
      }
    }

    initSocket()

    // Cleanup: remove listeners explicitly, then disconnect
    return () => {
      if (socket) {
        socket.off('connect', onConnect)
        socket.off('disconnect', onDisconnect)
        socket.off('connect_error', onConnectError)
        socket.off('orders:list-changed', onListChanged)
        socket.off('order:totals-updated', onTotalsUpdated)
        socket.off('entertainment:status-changed', onEntertainmentChanged)
        socket.off('joined', onJoined)
        socket.disconnect()
        socketRef.current = null
      }
    }
  }, [locationId, enabled])

  return { isConnected }
}
