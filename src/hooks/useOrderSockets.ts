'use client'

import { useEffect, useState, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket, getTerminalId, onSocketReconnect } from '@/lib/shared-socket'
import { useOrderStore } from '@/stores/order-store'

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
  onOpenOrdersChanged?: (data: { locationId: string; trigger: string; orderId?: string; sourceTerminalId?: string }) => void
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
  onEntertainmentWaitlistChanged?: (data: {
    itemId: string
    waitlistCount: number
  }) => void
  onOrderClosed?: (data: {
    orderId: string
    status: string
    closedAt: string
    closedByEmployeeId: string | null
    locationId: string
  }) => void
  onOrderClaimed?: (data: {
    orderId: string
    employeeId: string
    employeeName: string | null
    terminalId: string | null
    claimedAt: string
  }) => void
  onOrderReleased?: (data: {
    orderId: string
  }) => void
  onOrderSummaryUpdated?: (data: {
    orderId: string
    orderNumber: number
    status: string
    tableId: string | null
    tableName: string | null
    tabName: string | null
    guestCount: number
    employeeId: string | null
    subtotalCents: number
    taxTotalCents: number
    discountTotalCents: number
    tipTotalCents: number
    totalCents: number
    itemCount: number
    updatedAt: string
    locationId: string
  }) => void
}

export function useOrderSockets(options: UseOrderSocketsOptions): { isConnected: boolean } {
  const { locationId, enabled = true } = options

  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Store callbacks in a ref so socket listeners always call the latest version
  // without triggering reconnection when callbacks change
  const callbacksRef = useRef(options)
  useEffect(() => { callbacksRef.current = options })

  useEffect(() => {
    if (!locationId || !enabled) return

    const socket = getSharedSocket() as Socket
    socketRef.current = socket

    // Fallback polling: refetch current order + trigger list-changed during disconnect
    const POLL_INTERVAL_MS = 15_000
    const startPolling = () => {
      if (pollingIntervalRef.current) return
      pollingIntervalRef.current = setInterval(() => {
        // Refetch open order if one exists
        const orderId = useOrderStore.getState().currentOrder?.id
        if (orderId) {
          fetch(`/api/orders/${orderId}`)
            .then(res => res.ok ? res.json() : null)
            .then(raw => {
              if (!raw) return
              const order = raw.data ?? raw
              if (useOrderStore.getState().currentOrder?.id === orderId) {
                useOrderStore.getState().loadOrder(order)
              }
            })
            .catch(() => {})
        }
        // Notify list-changed listeners so open orders panel stays current
        callbacksRef.current.onOpenOrdersChanged?.({ locationId: locationId!, trigger: 'poll' })
      }, POLL_INTERVAL_MS)
    }
    const stopPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }

    // Named handlers so we can remove them explicitly on cleanup
    const onConnect = () => {
      setIsConnected(true)
      stopPolling()

      // Join location room via join_station (server joins location:{locationId} room)
      socket.emit('join_station', {
        locationId,
        tags: [],
        terminalId: getTerminalId(),
      })
    }

    const onDisconnect = () => {
      setIsConnected(false)
      startPolling()
    }

    const onConnectError = (error: unknown) => {
      // Downgraded to warn — expected in dev when socket server isn't running
      console.warn('[Order Socket] Connection error (socket server may not be running):', error)
    }

    const onListChanged = (data: unknown) => {
      const payload = data as { locationId: string; trigger: string; orderId?: string; sourceTerminalId?: string }
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

    const onEntertainmentWaitlistChanged = (data: unknown) => {
      const payload = data as { itemId: string; waitlistCount: number }
      callbacksRef.current.onEntertainmentWaitlistChanged?.(payload)
    }

    const onOrderClosed = (data: unknown) => {
      const payload = data as {
        orderId: string
        status: string
        closedAt: string
        closedByEmployeeId: string | null
        locationId: string
      }
      callbacksRef.current.onOrderClosed?.(payload)
    }

    const onOrderClaimed = (data: unknown) => {
      const payload = data as {
        orderId: string
        employeeId: string
        employeeName: string | null
        terminalId: string | null
        claimedAt: string
      }
      callbacksRef.current.onOrderClaimed?.(payload)
    }

    const onOrderReleased = (data: unknown) => {
      const payload = data as { orderId: string }
      callbacksRef.current.onOrderReleased?.(payload)
    }

    const onOrderSummaryUpdated = (data: unknown) => {
      const payload = data as {
        orderId: string
        orderNumber: number
        status: string
        tableId: string | null
        tableName: string | null
        tabName: string | null
        guestCount: number
        employeeId: string | null
        subtotalCents: number
        taxTotalCents: number
        discountTotalCents: number
        tipTotalCents: number
        totalCents: number
        itemCount: number
        updatedAt: string
        locationId: string
      }
      callbacksRef.current.onOrderSummaryUpdated?.(payload)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('orders:list-changed', onListChanged)
    socket.on('order:totals-updated', onTotalsUpdated)
    socket.on('entertainment:status-changed', onEntertainmentChanged)
    socket.on('entertainment:waitlist-changed', onEntertainmentWaitlistChanged)
    socket.on('order:closed', onOrderClosed)
    socket.on('order:claimed', onOrderClaimed)
    socket.on('order:released', onOrderReleased)
    socket.on('order:summary-updated', onOrderSummaryUpdated)

    // On reconnect, refetch the current open order to clear stale data
    const unsubReconnect = onSocketReconnect(() => {
      const orderId = useOrderStore.getState().currentOrder?.id
      if (!orderId) return
      fetch(`/api/orders/${orderId}`)
        .then(res => res.ok ? res.json() : null)
        .then(raw => {
          if (!raw) return
          const order = raw.data ?? raw
          // Only apply if same order is still open
          if (useOrderStore.getState().currentOrder?.id === orderId) {
            useOrderStore.getState().loadOrder(order)
          }
        })
        .catch(err => console.warn('[useOrderSockets] reconnect refetch failed:', err))
    })

    // If already connected (shared socket was created by another consumer), join immediately
    if (socket.connected) {
      onConnect()
    } else {
      // Socket starts disconnected — begin polling immediately
      startPolling()
    }

    // Cleanup: remove our listeners, stop polling, release shared socket reference
    return () => {
      unsubReconnect()
      stopPolling()
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('orders:list-changed', onListChanged)
      socket.off('order:totals-updated', onTotalsUpdated)
      socket.off('entertainment:status-changed', onEntertainmentChanged)
      socket.off('entertainment:waitlist-changed', onEntertainmentWaitlistChanged)
      socket.off('order:closed', onOrderClosed)
      socket.off('order:claimed', onOrderClaimed)
      socket.off('order:released', onOrderReleased)
      socket.off('order:summary-updated', onOrderSummaryUpdated)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [locationId, enabled])

  return { isConnected }
}
