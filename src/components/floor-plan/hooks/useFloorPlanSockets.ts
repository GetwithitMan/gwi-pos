/**
 * useFloorPlanSockets — Socket event handlers for floor plan real-time updates.
 * Extracted from FloorPlanHome.tsx to reduce component complexity.
 *
 * Handles: floor-plan:updated, orders:list-changed, order:totals-updated,
 * table:status-changed, entertainment:session-update, entertainment:status-changed,
 * eod:reset-complete, order:closed, entertainment:waitlist-notify, settings:updated
 */

import { useEffect, useRef } from 'react'
import { useSocket } from '@/hooks/useSocket'
import { useOrderStore } from '@/stores/order-store'
import { logger } from '@/lib/logger'
import { toast } from '@/stores/toast-store'
import type { PricingRule } from '@/lib/settings'
import type { TableStatus } from '../use-floor-plan'

function playNotificationSound() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const oscillator = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()
    oscillator.connect(gainNode)
    gainNode.connect(audioCtx.destination)
    oscillator.frequency.value = 800
    oscillator.type = 'sine'
    gainNode.gain.value = 0.3
    oscillator.start()
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5)
    oscillator.stop(audioCtx.currentTime + 0.5)
  } catch (e) {
    // Audio not available
  }
}

interface UseFloorPlanSocketsOptions {
  loadFloorPlanData: (showLoading?: boolean) => Promise<void>
  clearOrderPanel: () => void
  activeOrderIdRef: React.MutableRefObject<string | null>
  tablesRef: React.MutableRefObject<any[]>
  optimisticGraceRef: React.MutableRefObject<number>
  // Store actions
  addTableOrder: (tableId: string, order: any) => void
  removeTableOrder: (tableId: string) => void
  patchTableOrder: (tableId: string, patch: any) => void
  updateSingleTableStatus: (tableId: string, status: TableStatus) => void
  // Callbacks
  setEodSummary: (summary: { cancelledDrafts: number; rolledOverOrders: number; tablesReset: number; businessDay: string } | null) => void
  setPricingRules: (rules: PricingRule[]) => void
}

interface UseFloorPlanSocketsReturn {
  socket: any
  isConnected: boolean
}

export function useFloorPlanSockets({
  loadFloorPlanData,
  clearOrderPanel,
  activeOrderIdRef,
  tablesRef,
  optimisticGraceRef,
  addTableOrder,
  removeTableOrder,
  patchTableOrder,
  updateSingleTableStatus,
  setEodSummary,
  setPricingRules,
}: UseFloorPlanSocketsOptions): UseFloorPlanSocketsReturn {
  const { socket, isConnected } = useSocket()

  // Ref for loadFloorPlanData to avoid stale closures in event handlers
  const loadFloorPlanDataRef = useRef(loadFloorPlanData)
  useEffect(() => { loadFloorPlanDataRef.current = loadFloorPlanData })

  // Settings:updated — recompute pricing rules
  useEffect(() => {
    if (!socket) return
    const handler = (payload: any) => {
      const s = payload?.settings
      if (s?.pricingRules) {
        setPricingRules(s.pricingRules)
      }
    }
    socket.on('settings:updated', handler)
    return () => { socket.off('settings:updated', handler) }
  }, [socket, setPricingRules])

  // Force data refresh on socket REconnect
  const wasEverConnectedRef = useRef(false)
  useEffect(() => {
    if (isConnected) {
      if (wasEverConnectedRef.current) {
        loadFloorPlanDataRef.current()
      }
      wasEverConnectedRef.current = true
    }
  }, [isConnected])

  // 20s fallback polling ONLY when socket is disconnected
  useEffect(() => {
    if (isConnected) return
    const fallback = setInterval(() => {
      loadFloorPlanDataRef.current()
    }, 20000)
    return () => clearInterval(fallback)
  }, [isConnected])

  // Visibility change: instant refresh when user switches back to this tab/app
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadFloorPlanDataRef.current()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  // Main socket event subscriptions
  useEffect(() => {
    if (!socket || !isConnected) return

    // Optimistic grace period: after an optimistic update, defer socket-triggered
    // full refreshes for 3s to prevent "table disappears then reappears" flicker.
    const refreshAll = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      const now = Date.now()
      const graceRemaining = optimisticGraceRef.current ? optimisticGraceRef.current - now : 0
      const delay = Math.max(100, graceRemaining)
      debounceTimer = setTimeout(() => {
        loadFloorPlanDataRef.current()
      }, delay)
    }
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    // Floor plan layout changes from another terminal (structure change — full reload)
    const onFloorPlanUpdated = () => {
      logger.log('[FloorPlanHome] floor-plan:updated — full reload (structure change)')
      refreshAll()
    }

    // Open orders list changed (create/send/pay/void)
    const onOrdersListChanged = (data: any) => {
      const { trigger, tableId, orderNumber, status } = data || {}
      logger.log(`[FloorPlanHome] orders:list-changed trigger=${trigger} tableId=${tableId}`)
      if ((trigger === 'sent' || trigger === 'created') && tableId) {
        const currentTables = tablesRef.current
        const table = currentTables.find((t: any) => t.id === tableId)
        if (table && !table.currentOrder) {
          addTableOrder(tableId, {
            id: data.orderId || '',
            orderNumber: orderNumber || 0,
            guestCount: 1,
            total: 0,
            openedAt: new Date().toISOString(),
            server: '',
            status: status || 'occupied',
          })
        }
      } else if ((trigger === 'paid' || trigger === 'voided') && tableId) {
        removeTableOrder(tableId)
      } else {
        refreshAll()
      }
    }

    // Order totals changed — delta patch the table's displayed total
    const onTotalsUpdated = (data: any) => {
      const { orderId, totals } = data || {}
      if (orderId && totals) {
        const currentTables = tablesRef.current
        const table = currentTables.find((t: any) => t.currentOrder?.id === orderId)
        if (table) {
          logger.log(`[FloorPlanHome] order:totals-updated — delta patch table ${table.id}`)
          patchTableOrder(table.id, { total: totals.total })
        }
      }
    }

    // Explicit table status change
    const onTableStatusChanged = (data: any) => {
      const { tableId, status: newStatus } = data || {}
      if (tableId && newStatus) {
        logger.log(`[FloorPlanHome] table:status-changed — delta patch ${tableId}`)
        updateSingleTableStatus(tableId, newStatus)
      } else {
        refreshAll()
      }
    }

    // Entertainment session update — status glow changes
    const onEntertainmentUpdate = () => {
      logger.log('[FloorPlanHome] entertainment:session-update — full reload')
      loadFloorPlanDataRef.current()
    }

    // Entertainment element status changed
    const onEntertainmentStatusChanged = (data: any) => {
      const { itemId, entertainmentStatus } = data || {}
      logger.log(`[FloorPlanHome] entertainment:status-changed itemId=${itemId} status=${entertainmentStatus}`)
      loadFloorPlanDataRef.current()
    }

    // EOD reset complete — show manager summary overlay
    const onEodReset = (data: any) => {
      logger.log('[FloorPlanHome] eod:reset-complete received', data)
      toast.success('End of day reset complete')
      setEodSummary({
        cancelledDrafts: data.cancelledDrafts,
        rolledOverOrders: data.rolledOverOrders,
        tablesReset: data.tablesReset,
        businessDay: data.businessDay,
      })
      refreshAll()
    }

    // Order closed (paid/voided/cancelled from another terminal)
    const onOrderClosed = (data: any) => {
      const { orderId } = data || {}
      if (!orderId) return
      logger.log(`[FloorPlanHome] order:closed orderId=${orderId}`)

      const currentActiveId = activeOrderIdRef.current
      const storeOrderId = useOrderStore.getState().currentOrder?.id
      if (orderId === currentActiveId || orderId === storeOrderId) {
        logger.log(`[FloorPlanHome] order:closed — clearing active order panel (matched ${orderId})`)
        clearOrderPanel()
        toast.info('Order was closed on another terminal')
      }

      const currentTables = tablesRef.current
      const table = currentTables.find((t: any) => t.currentOrder?.id === orderId)
      if (table) {
        removeTableOrder(table.id)
      }

      // FIX C4: Ensure order store is consistent with floor plan
      const storeOrderIdAfter = useOrderStore.getState().currentOrder?.id
      if (storeOrderIdAfter === orderId) {
        useOrderStore.getState().clearOrder()
      }
    }

    const onWaitlistNotify = (data: { customerName?: string; elementName?: string; message?: string; action?: string }) => {
      if (data.action === 'notified' || data.action === 'added') {
        if (data.action === 'notified') {
          playNotificationSound()
        }
        const msg = data.message || `${data.customerName || 'Customer'} — waitlist update`
        toast.info(msg)
      }
    }

    socket.on('floor-plan:updated', onFloorPlanUpdated)
    socket.on('orders:list-changed', onOrdersListChanged)
    socket.on('order:totals-updated', onTotalsUpdated)
    socket.on('table:status-changed', onTableStatusChanged)
    socket.on('entertainment:session-update', onEntertainmentUpdate)
    socket.on('entertainment:status-changed', onEntertainmentStatusChanged)
    socket.on('eod:reset-complete', onEodReset)
    socket.on('order:closed', onOrderClosed)
    socket.on('entertainment:waitlist-notify', onWaitlistNotify)

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      socket.off('floor-plan:updated', onFloorPlanUpdated)
      socket.off('orders:list-changed', onOrdersListChanged)
      socket.off('order:totals-updated', onTotalsUpdated)
      socket.off('table:status-changed', onTableStatusChanged)
      socket.off('entertainment:session-update', onEntertainmentUpdate)
      socket.off('entertainment:status-changed', onEntertainmentStatusChanged)
      socket.off('eod:reset-complete', onEodReset)
      socket.off('order:closed', onOrderClosed)
      socket.off('entertainment:waitlist-notify', onWaitlistNotify)
    }
  }, [socket, isConnected])

  return { socket, isConnected }
}
