'use client'

import { useEffect, useState, useRef } from 'react'
import { getSharedSocket, releaseSharedSocket, getTerminalId, onSocketReconnect } from '@/lib/shared-socket'
import { useOrderStore } from '@/stores/order-store'
import { clientLog } from '@/lib/client-logger'

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
  onMenuModifierChanged?: (data: {
    menuItemId: string | null
    modifierGroupId: string
  }) => void
  onSettingsUpdated?: (data: {
    changedKeys?: string[]
  }) => void
}

export function useOrderSockets(options: UseOrderSocketsOptions): { isConnected: boolean } {
  const { locationId, enabled = true } = options

  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // FIX C7: Guard against socket handlers firing after component unmount.
  // Uses a ref (not state) to avoid re-renders — only checked inside handlers.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  // Store callbacks in a ref so socket listeners always call the latest version
  // without triggering reconnection when callbacks change
  const callbacksRef = useRef(options)
  useEffect(() => { callbacksRef.current = options })

  useEffect(() => {
    if (!locationId || !enabled) return

    const socket = getSharedSocket() as Socket
    socketRef.current = socket

    // FIX C11: Cache terminal ID for sourceTerminalId filtering
    const thisTerminalId = getTerminalId()

    // Fallback polling: refetch current order + trigger list-changed during disconnect
    const POLL_INTERVAL_MS = 15_000
    const startPolling = () => {
      if (pollingIntervalRef.current) return
      pollingIntervalRef.current = setInterval(() => {
        // FIX C7: Skip if component unmounted
        if (!isMountedRef.current) return

        // Refetch open order if one exists
        const orderId = useOrderStore.getState().currentOrder?.id
        if (orderId) {
          fetch(`/api/orders/${orderId}`)
            .then(res => res.ok ? res.json() : null)
            .then(raw => {
              if (!raw || !isMountedRef.current) return
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
        terminalId: thisTerminalId,
      })
    }

    const onDisconnect = () => {
      setIsConnected(false)
      startPolling()
    }

    const onConnectError = (error: unknown) => {
      // Downgraded to warn — expected in dev when socket server isn't running
      clientLog.warn('[Order Socket] Connection error (socket server may not be running):', error)
    }

    const onListChanged = (data: unknown) => {
      // FIX C7: Skip if unmounted
      if (!isMountedRef.current) return
      const payload = data as { locationId: string; trigger: string; orderId?: string; sourceTerminalId?: string }
      // FIX C11: Skip events from this terminal — it already has latest state from its own API response
      if (payload.sourceTerminalId && payload.sourceTerminalId === thisTerminalId) return
      callbacksRef.current.onOpenOrdersChanged?.(payload)
    }

    const onTotalsUpdated = (data: unknown) => {
      if (!isMountedRef.current) return
      const payload = data as {
        orderId: string
        sourceTerminalId?: string
        totals: {
          subtotal: number
          taxTotal: number
          tipTotal: number
          discountTotal: number
          total: number
        }
      }
      // FIX C11: Skip own events
      if (payload.sourceTerminalId && payload.sourceTerminalId === thisTerminalId) return
      callbacksRef.current.onOrderTotalsUpdated?.(payload)
    }

    const onEntertainmentChanged = (data: unknown) => {
      if (!isMountedRef.current) return
      const payload = data as {
        itemId: string
        entertainmentStatus: string
        currentOrderId: string | null
      }
      callbacksRef.current.onEntertainmentStatusChanged?.(payload)
    }

    const onEntertainmentWaitlistChanged = (data: unknown) => {
      if (!isMountedRef.current) return
      const payload = data as { itemId: string; waitlistCount: number }
      callbacksRef.current.onEntertainmentWaitlistChanged?.(payload)
    }

    const onOrderClosed = (data: unknown) => {
      if (!isMountedRef.current) return
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
      if (!isMountedRef.current) return
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
      if (!isMountedRef.current) return
      const payload = data as { orderId: string }
      callbacksRef.current.onOrderReleased?.(payload)
    }

    const onOrderSummaryUpdated = (data: unknown) => {
      if (!isMountedRef.current) return
      const payload = data as {
        orderId: string
        orderNumber: number
        status: string
        sourceTerminalId?: string
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
      // FIX C11: Skip own events
      if (payload.sourceTerminalId && payload.sourceTerminalId === thisTerminalId) return
      callbacksRef.current.onOrderSummaryUpdated?.(payload)
    }

    // order:item-voided — item voided/comped after being sent to kitchen
    const onItemVoided = (data: unknown) => {
      if (!isMountedRef.current) return
      const payload = data as { orderId: string; itemId: string; action: string; reason: string | null; sourceTerminalId?: string }
      // FIX C11: Skip own events
      if (payload.sourceTerminalId && payload.sourceTerminalId === thisTerminalId) return
      // Refresh open orders list so totals/counts update across terminals
      callbacksRef.current.onOpenOrdersChanged?.({ locationId: locationId!, trigger: 'item_voided', orderId: payload.orderId })
      // If voided item belongs to the current order, refetch it
      const currentOrderId = useOrderStore.getState().currentOrder?.id
      if (currentOrderId && currentOrderId === payload.orderId) {
        fetch(`/api/orders/${currentOrderId}`)
          .then(res => res.ok ? res.json() : null)
          .then(raw => {
            if (!raw || !isMountedRef.current) return
            const order = raw.data ?? raw
            if (useOrderStore.getState().currentOrder?.id === currentOrderId) {
              useOrderStore.getState().loadOrder(order)
            }
          })
          .catch(() => {})
      }
    }

    // order:item-held — item hold status toggled
    const onItemHeld = (data: unknown) => {
      if (!isMountedRef.current) return
      const payload = data as { orderId: string; itemId: string; isHeld: boolean; sourceTerminalId?: string }
      // FIX C11: Skip own events
      if (payload.sourceTerminalId && payload.sourceTerminalId === thisTerminalId) return
      // If held item belongs to current order, refetch to reflect hold state
      const currentOrderId = useOrderStore.getState().currentOrder?.id
      if (currentOrderId && currentOrderId === payload.orderId) {
        fetch(`/api/orders/${currentOrderId}`)
          .then(res => res.ok ? res.json() : null)
          .then(raw => {
            if (!raw || !isMountedRef.current) return
            const order = raw.data ?? raw
            if (useOrderStore.getState().currentOrder?.id === currentOrderId) {
              useOrderStore.getState().loadOrder(order)
            }
          })
          .catch(() => {})
      }
    }

    // order:reopened — closed order was reopened, add it back to open orders list
    const onOrderReopened = (data: unknown) => {
      if (!isMountedRef.current) return
      const payload = data as { orderId: string; reason: string | null }
      callbacksRef.current.onOpenOrdersChanged?.({ locationId: locationId!, trigger: 'reopened', orderId: payload.orderId })
    }

    // menu:modifier-changed — modifier group or modifier updated
    const onMenuModifierChanged = (data: unknown) => {
      if (!isMountedRef.current) return
      const payload = data as { menuItemId: string | null; modifierGroupId: string }
      callbacksRef.current.onMenuModifierChanged?.(payload)
    }

    // settings:updated — location settings changed (tax rates, pricing rules, etc.)
    const onSettingsUpdated = (data: unknown) => {
      if (!isMountedRef.current) return
      const payload = data as { changedKeys?: string[] }
      clientLog.warn('[useOrderSockets] settings:updated — location settings changed, terminals should refresh', payload)
      callbacksRef.current.onSettingsUpdated?.(payload)
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
    socket.on('order:item-voided', onItemVoided)
    socket.on('order:item-held', onItemHeld)
    socket.on('order:reopened', onOrderReopened)
    socket.on('menu:modifier-changed', onMenuModifierChanged)
    socket.on('settings:updated', onSettingsUpdated)

    // On reconnect, refetch the current open order to clear stale data
    const unsubReconnect = onSocketReconnect(() => {
      // FIX C7: Skip if unmounted
      if (!isMountedRef.current) return
      const orderId = useOrderStore.getState().currentOrder?.id
      if (!orderId) return
      fetch(`/api/orders/${orderId}`)
        .then(res => res.ok ? res.json() : null)
        .then(raw => {
          if (!raw || !isMountedRef.current) return
          const order = raw.data ?? raw
          // Only apply if same order is still open
          if (useOrderStore.getState().currentOrder?.id === orderId) {
            useOrderStore.getState().loadOrder(order)
          }
        })
        .catch(err => clientLog.warn('[useOrderSockets] reconnect refetch failed:', err))
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
      socket.off('order:item-voided', onItemVoided)
      socket.off('order:item-held', onItemHeld)
      socket.off('order:reopened', onOrderReopened)
      socket.off('menu:modifier-changed', onMenuModifierChanged)
      socket.off('settings:updated', onSettingsUpdated)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [locationId, enabled])

  return { isConnected }
}
