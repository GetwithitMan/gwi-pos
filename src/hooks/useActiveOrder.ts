import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOrderStore } from '@/stores/order-store'
import { toast } from '@/stores/toast-store'
import { isTempId, buildOrderItemPayload } from '@/lib/order-utils'
import { startPaymentTiming, markRequestSent, completePaymentTiming } from '@/lib/payment-timing'
import { getOrderVersion, handleVersionConflict } from '@/lib/order-version'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import type { OrderPanelItemData } from '@/components/orders/OrderPanelItem'

interface UseActiveOrderOptions {
  locationId?: string
  employeeId?: string
  onEditModifiers?: (itemId: string) => void
  onCompVoid?: (itemId: string) => void
  onSplit?: (itemId: string) => void
  onOrderSent?: (orderId: string) => void
  onOrderCleared?: () => void
}

interface AddItemInput {
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers: Array<{
    id: string
    name: string
    price: number
    preModifier?: string
    depth?: number
    commissionAmount?: number
    parentModifierId?: string
  }>
  ingredientModifications?: Array<{
    ingredientId: string
    name: string
    modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
    priceAdjustment: number
    swappedTo?: { modifierId: string; name: string; price: number }
  }>
  specialNotes?: string
  seatNumber?: number
  courseNumber?: number
  sourceTableId?: string
  commissionAmount?: number
  blockTimeMinutes?: number | null
  pourSize?: string | null       // T-006
  pourMultiplier?: number | null // T-006
  pizzaConfig?: any
}

interface StartOrderOptions {
  locationId?: string
  tableId?: string
  tableName?: string
  tabName?: string
  guestCount?: number
  orderTypeId?: string
  customFields?: Record<string, string>
}

interface UseActiveOrderReturn {
  // === Order Identity ===
  orderId: string | null
  orderNumber: number | string | null
  orderType: string | null
  tabName: string | null
  tableId: string | null
  locationId: string | null

  // === Items ===
  items: OrderPanelItemData[]

  // === Totals ===
  subtotal: number
  tax: number
  discounts: number
  total: number
  guestCount: number

  // === UI State ===
  expandedItemId: string | null
  isSending: boolean
  hasUnsavedItems: boolean
  hasOrder: boolean

  // === Order Lifecycle ===
  startOrder: (orderType: string, options?: StartOrderOptions) => void
  addItem: (item: AddItemInput) => void
  loadOrder: (orderId: string) => Promise<void>
  clearOrder: () => void
  ensureOrderInDB: (employeeId?: string) => Promise<string | null>

  // === Note Editing (for NoteEditModal) ===
  noteEditTarget: { itemId: string; currentNote?: string; itemName?: string } | null
  openNoteEditor: (itemId: string, currentNote?: string) => void
  closeNoteEditor: () => void
  saveNote: (itemId: string, note: string) => Promise<void>

  // === Item Handlers ===
  handleRemoveItem: (itemId: string) => Promise<void>
  handleQuantityChange: (itemId: string, delta: number) => Promise<void>
  handleHoldToggle: (itemId: string) => Promise<void>
  handleNoteEdit: (itemId: string, currentNote?: string) => void
  handleCourseChange: (itemId: string, course: number | null) => Promise<void>
  handleSeatChange: (itemId: string, seat: number | null) => Promise<void>
  handleEditModifiers: (itemId: string) => void
  handleCompVoid: (itemId: string) => void
  handleResend: (itemId: string) => Promise<void>
  handleSplit: (itemId: string) => void
  handleToggleExpand: (itemId: string) => void

  // === Send to Kitchen ===
  handleSendToKitchen: (employeeId?: string) => Promise<void>

  // === Coursing ===
  coursingEnabled: boolean
  courseDelays: Record<number, { delayMinutes: number; startedAt?: string; firedAt?: string }>
  setCoursingEnabled: (enabled: boolean) => void
  setCourseDelay: (courseNumber: number, delayMinutes: number) => void
  fireCourse: (courseNumber: number) => void
  handleFireCourse: (courseNumber: number) => Promise<void>

  // === Order-level Delay ===
  pendingDelay: number | null
  delayStartedAt: string | null
  delayFiredAt: string | null
  setPendingDelay: (minutes: number | null) => void
  handleFireDelayed: () => Promise<void>

  // === Per-Item Delay ===
  setItemDelay: (itemIds: string[], minutes: number | null) => void
  handleFireItem: (itemId: string) => Promise<void>

  // === Reopened Order Tracking ===
  reopenedAt: string | null
  reopenReason: string | null
}

export function useActiveOrder(options: UseActiveOrderOptions = {}): UseActiveOrderReturn {
  const currentOrder = useOrderStore(state => state.currentOrder)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  // Ref to track background draft creation promise (so ensureOrderInDB can await it)
  const draftPromiseRef = useRef<Promise<string | null> | null>(null)

  // Generation counter: bumped on every clearOrder/startOrder to invalidate stale draft callbacks
  const draftGenRef = useRef(0)

  // Bug 8: Timestamp of our last mutation — used to skip socket events from our own actions
  const lastMutationRef = useRef<number>(0)

  // Convert store items to OrderPanelItemData format
  const items: OrderPanelItemData[] = useMemo(() => {
    if (!currentOrder?.items) return []
    return currentOrder.items.map(item => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      modifiers: item.modifiers.map(m => ({ id: m.id, name: m.name, price: m.price, depth: m.depth, preModifier: m.preModifier })),
      specialNotes: item.specialNotes,
      kitchenStatus: item.isCompleted ? 'ready' as const
        : item.sentToKitchen ? 'sent' as const
        : 'pending' as const,
      isHeld: item.isHeld,
      isCompleted: item.isCompleted,
      isTimedRental: !!item.blockTimeMinutes || !!item.blockTimeStartedAt,
      menuItemId: item.menuItemId,
      blockTimeMinutes: item.blockTimeMinutes ?? undefined,
      blockTimeStartedAt: item.blockTimeStartedAt ?? undefined,
      blockTimeExpiresAt: item.blockTimeExpiresAt ?? undefined,
      seatNumber: item.seatNumber,
      courseNumber: item.courseNumber,
      courseStatus: item.courseStatus,
      sentToKitchen: item.sentToKitchen,
      resendCount: item.resendCount,
      completedAt: item.completedAt,
      createdAt: undefined,
      // Per-item delay
      delayMinutes: item.delayMinutes,
      delayStartedAt: item.delayStartedAt,
      delayFiredAt: item.delayFiredAt,
    }))
  }, [currentOrder?.items])

  // Load order from API
  const loadOrder = useCallback(async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}`)
      if (!res.ok) {
        toast.error('Failed to load order')
        return
      }

      const raw = await res.json()
      const order = raw.data ?? raw

      // Pass raw API response directly — store.loadOrder() is the SINGLE source of truth for mapping
      useOrderStore.getState().loadOrder(order)
    } catch (error) {
      console.error('[useActiveOrder] Failed to load order:', error)
      toast.error('Failed to load order')
    }
  }, [])

  // Clear order — cancel draft in DB if it was never sent
  const clearOrder = useCallback(() => {
    const store = useOrderStore.getState()
    const order = store.currentOrder

    // If order has a real DB ID and no items were sent, soft-delete the draft
    if (order?.id && !isTempId(order.id)) {
      const hasSentItems = order.items.some(i => i.sentToKitchen)
      if (!hasSentItems) {
        // Bug 10 fix: Empty drafts (0 items) get deletedAt for proper soft-delete cleanup
        const body: Record<string, unknown> = { status: 'cancelled' }
        if (order.items.length === 0) {
          body.deletedAt = new Date().toISOString()
        }
        fetch(`/api/orders/${order.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {})
      }
    }

    // Abandon any pending draft creation — bump generation so stale callbacks are ignored
    draftGenRef.current++
    draftPromiseRef.current = null

    store.clearOrder()
    setExpandedItemId(null)
    options.onOrderCleared?.()
  }, [options])

  // Start a new order (dine_in, bar_tab, takeout, etc.)
  // Also fires a background POST to create a draft shell in the DB,
  // so "Send to Kitchen" only needs to append items (not create the order).
  const startOrder = useCallback((orderType: string, opts: StartOrderOptions = {}) => {
    const resolvedLocationId = opts.locationId || options.locationId
    const resolvedEmployeeId = options.employeeId

    useOrderStore.getState().startOrder(orderType, {
      locationId: resolvedLocationId,
      tableId: opts.tableId,
      tableName: opts.tableName,
      tabName: opts.tabName,
      guestCount: opts.guestCount,
      orderTypeId: opts.orderTypeId,
      customFields: opts.customFields,
    })

    // Background: create draft order shell in DB (no items, lightweight)
    if (resolvedEmployeeId && resolvedLocationId) {
      // Bump generation so any prior in-flight draft callback is discarded
      const gen = ++draftGenRef.current
      const draftTableId = opts.tableId || null

      const draftPromise = fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: resolvedEmployeeId,
          locationId: resolvedLocationId,
          orderType,
          orderTypeId: opts.orderTypeId,
          tableId: draftTableId,
          tabName: opts.tabName || null,
          guestCount: opts.guestCount || 1,
          items: [],  // Empty = draft shell
          customFields: opts.customFields,
        }),
      }).then(async (res) => {
        // Stale check: if generation changed, another startOrder/clearOrder ran — discard
        if (draftGenRef.current !== gen) return null

        if (res.ok) {
          const raw = await res.json()
          const data = raw.data ?? raw
          // Final stale check before applying
          if (draftGenRef.current !== gen) return null
          // Store the real DB ID so ensureOrderInDB can skip creation
          const store = useOrderStore.getState()
          store.updateOrderId(data.id, data.orderNumber)
          if (data.version !== undefined) {
            store.syncServerTotals({ subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0, version: data.version })
          }
          return data.id as string
        }
        // 409 TABLE_OCCUPIED: table already has an order — adopt it instead of failing
        if (res.status === 409) {
          const err = await res.json().catch(() => ({}))
          const existingId = err.details?.existingOrderId
          if (existingId) {
            if (draftGenRef.current !== gen) return null
            const store = useOrderStore.getState()
            store.updateOrderId(existingId, err.details?.existingOrderNumber)
            // Bug 5 fix: sync version from 409 response to prevent subsequent version conflicts
            if (err.details?.existingOrderVersion !== undefined) {
              store.syncServerTotals({ subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0, version: err.details.existingOrderVersion })
            }
            return existingId as string
          }
        }
        return null
      }).catch(() => null)

      draftPromiseRef.current = draftPromise
    }
  }, [options.locationId, options.employeeId])

  // Add an item to the current order (local only — not saved to DB until send/pay)
  // Track individual item save promises by temp ID (for event-based saves)
  const pendingSavesRef = useRef<Map<string, Promise<void>>>(new Map())

  // Fire-and-forget: persist a single temp-ID item to the DB immediately
  const saveItemToDb = useCallback((tempId: string) => {
    const store = useOrderStore.getState()
    const order = store.currentOrder
    if (!order?.id || isTempId(order.id)) return // no DB ID yet — safety net will catch it
    lastMutationRef.current = Date.now() // Bug 8: stamp to skip own socket events

    const item = order.items.find(i => i.id === tempId)
    if (!item) return

    const promise = (async () => {
      try {
        const res = await fetch(`/api/orders/${order.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [buildOrderItemPayload(item, { includeCorrelationId: true })],
            version: getOrderVersion(),
          }),
        })
        if (res.ok) {
          const rawResult = await res.json()
          const result = rawResult.data ?? rawResult
          if (result.addedItems) {
            const s = useOrderStore.getState()
            for (const added of result.addedItems) {
              if (added.correlationId) {
                s.updateItemId(added.correlationId, added.id)
              }
            }
          }
          if (result.subtotal !== undefined) {
            useOrderStore.getState().syncServerTotals({
              subtotal: result.subtotal,
              discountTotal: result.discountTotal ?? 0,
              taxTotal: result.taxTotal ?? 0,
              tipTotal: result.tipTotal,
              total: result.total,
              version: result.version,
            })
          }
        }
      } catch {
        // Silent — 30s safety net will retry
      } finally {
        pendingSavesRef.current.delete(tempId)
      }
    })()

    pendingSavesRef.current.set(tempId, promise)
  }, [])

  const addItem = useCallback((item: AddItemInput) => {
    const store = useOrderStore.getState()
    if (!store.currentOrder) {
      console.warn('[useActiveOrder] addItem called but no currentOrder — call startOrder first')
      return
    }
    const tempId = store.addItem({
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      modifiers: item.modifiers.map(m => ({
        id: m.id,
        name: m.name,
        price: m.price,
        preModifier: m.preModifier,
        depth: m.depth || 0,
        commissionAmount: m.commissionAmount,
        parentModifierId: m.parentModifierId,
      })),
      ingredientModifications: item.ingredientModifications,
      specialNotes: item.specialNotes,
      seatNumber: item.seatNumber,
      courseNumber: item.courseNumber,
      sourceTableId: item.sourceTableId,
      commissionAmount: item.commissionAmount,
      blockTimeMinutes: item.blockTimeMinutes,
      pourSize: item.pourSize ?? null,
      pourMultiplier: item.pourMultiplier ?? null,
      sentToKitchen: false,
      pizzaConfig: item.pizzaConfig,
    })

    // Event-based save: immediately persist to DB if order has DB ID
    if (tempId) {
      saveItemToDb(tempId)
    }
  }, [saveItemToDb])

  // Computed: any items with temp IDs (not yet in DB)
  const hasUnsavedItems = useMemo(() => {
    if (!currentOrder?.items) return false
    return currentOrder.items.some(item => isTempId(item.id))
  }, [currentOrder?.items])

  // Computed: has any order at all
  const hasOrder = !!currentOrder

  /**
   * Ensure the current order exists in the database.
   * - If no DB order: POST /api/orders with all items → map returned IDs
   * - If DB order exists but has unsaved items: POST /api/orders/{id}/items → map IDs
   * - Returns the real orderId, or null on failure
   */
  const ensureOrderInDB = useCallback(async (employeeId?: string): Promise<string | null> => {
    // If a background draft creation is in flight, wait for it first
    // (typically resolves in <100ms since it's just creating an empty shell)
    if (draftPromiseRef.current) {
      await draftPromiseRef.current
      draftPromiseRef.current = null
    }

    const store = useOrderStore.getState()
    const order = store.currentOrder
    if (!order) return null

    const resolvedEmployeeId = employeeId || options.employeeId
    const resolvedLocationId = order.locationId || options.locationId

    // Check if order already has a DB ID (not a temp ID)
    const hasDbId = order.id && !isTempId(order.id)

    if (!hasDbId) {
      // === CREATE ORDER IN DB ===
      if (!resolvedEmployeeId || !resolvedLocationId) {
        console.error('[useActiveOrder] ensureOrderInDB: missing employeeId or locationId')
        toast.error('Missing employee or location')
        return null
      }

      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: resolvedEmployeeId,
            locationId: resolvedLocationId,
            orderType: order.orderType,
            orderTypeId: order.orderTypeId,
            tableId: order.tableId || null,
            tabName: order.tabName || null,
            guestCount: order.guestCount,
            notes: order.notes || null,
            customFields: order.customFields,
            items: order.items.map(item => buildOrderItemPayload(item, { includeCorrelationId: true })),
          }),
        })

        if (!res.ok) {
          const error = await res.json().catch(() => ({}))
          // 409 TABLE_OCCUPIED: table already has an order — adopt it and append items
          if (res.status === 409 && error.details?.existingOrderId) {
            const existingId = error.details.existingOrderId
            store.updateOrderId(existingId, error.details.existingOrderNumber)
            // Bug 5 fix: sync version from 409 response to prevent subsequent version conflicts
            if (error.details?.existingOrderVersion !== undefined) {
              store.syncServerTotals({ subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0, version: error.details.existingOrderVersion })
            }
            // Append local items to the existing order
            const unsavedItems = order.items.filter(item => isTempId(item.id))
            if (unsavedItems.length > 0) {
              const appendRes = await fetch(`/api/orders/${existingId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  items: unsavedItems.map(item => buildOrderItemPayload(item, { includeCorrelationId: true })),
                }),
              })
              if (appendRes.ok) {
                const rawAppend = await appendRes.json()
                const result = rawAppend.data ?? rawAppend
                if (result.addedItems) {
                  for (const added of result.addedItems) {
                    if (added.correlationId) store.updateItemId(added.correlationId, added.id)
                  }
                }
                if (result.subtotal !== undefined) {
                  store.syncServerTotals({
                    subtotal: result.subtotal,
                    discountTotal: result.discountTotal ?? 0,
                    taxTotal: result.taxTotal ?? 0,
                    tipTotal: result.tipTotal,
                    total: result.total,
                    version: result.version,
                  })
                }
              }
            }
            toast.info('Joined existing order on this table')
            return existingId
          }
          toast.error(error.error || 'Failed to create order')
          return null
        }

        const rawCreated = await res.json()
        const created = rawCreated.data ?? rawCreated

        // Update order ID in store
        store.updateOrderId(created.id, created.orderNumber)

        // Map temp item IDs → real DB IDs using correlationId
        if (created.items) {
          for (const dbItem of created.items) {
            if (dbItem.correlationId) {
              store.updateItemId(dbItem.correlationId, dbItem.id)
            }
          }
        }

        // Sync server-calculated totals (tax, discounts, dual pricing)
        if (created.subtotal !== undefined) {
          store.syncServerTotals({
            subtotal: created.subtotal,
            discountTotal: created.discountTotal ?? 0,
            taxTotal: created.taxTotal ?? 0,
            tipTotal: created.tipTotal,
            total: created.total,
            version: created.version,
          })
        }

        return created.id
      } catch (error) {
        console.error('[useActiveOrder] ensureOrderInDB create failed:', error)
        toast.error('Failed to save order')
        return null
      }
    } else {
      // === ORDER EXISTS — CHECK FOR UNSAVED ITEMS ===
      const unsavedItems = order.items.filter(item => isTempId(item.id))

      if (unsavedItems.length === 0) {
        // All items already in DB
        return order.id!
      }

      // Append unsaved items via atomic POST /api/orders/{id}/items
      // Snapshot before network call so we can revert on failure
      store.saveSnapshot()
      try {
        const res = await fetch(`/api/orders/${order.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: unsavedItems.map(item => buildOrderItemPayload(item, { includeCorrelationId: true })),
            version: getOrderVersion(),
          }),
        })

        if (!res.ok) {
          if (await handleVersionConflict(res, order.id!)) return null
          const error = await res.json()
          store.revertLastChange(error.error || 'Failed to add items')
          return null
        }

        const rawResult = await res.json()
        const result = rawResult.data ?? rawResult

        // Map temp item IDs → real DB IDs
        if (result.addedItems) {
          for (const added of result.addedItems) {
            if (added.correlationId) {
              store.updateItemId(added.correlationId, added.id)
            }
          }
        }

        // Sync server-calculated totals
        if (result.subtotal !== undefined) {
          store.syncServerTotals({
            subtotal: result.subtotal,
            discountTotal: result.discountTotal ?? 0,
            taxTotal: result.taxTotal ?? 0,
            tipTotal: result.tipTotal,
            total: result.total,
            version: result.version,
          })
        }

        return order.id!
      } catch (error) {
        console.error('[useActiveOrder] ensureOrderInDB append failed:', error)
        store.revertLastChange('Failed to save items. Please try again.')
        return null
      }
    }
  }, [options.employeeId, options.locationId])

  // Safety-net autosave: 30s interval catches items that failed event-based save
  const autosaveInFlightRef = useRef(false)
  const autosavePromiseRef = useRef<Promise<void> | null>(null)
  const sendInProgressRef = useRef(false)
  useEffect(() => {
    const interval = setInterval(() => {
      if (autosaveInFlightRef.current) return
      if (sendInProgressRef.current) return
      const store = useOrderStore.getState()
      const order = store.currentOrder
      if (!order?.id || isTempId(order.id)) return
      const unsaved = order.items.filter(item => isTempId(item.id))
      if (unsaved.length === 0) return

      // Only save items that don't already have a pending event-based save
      const toSave = unsaved.filter(item => !pendingSavesRef.current.has(item.id))
      if (toSave.length === 0) return

      autosaveInFlightRef.current = true
      const promise = (async () => {
        try {
          const res = await fetch(`/api/orders/${order.id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: toSave.map(item => buildOrderItemPayload(item, { includeCorrelationId: true })),
              version: getOrderVersion(),
            }),
          })
          if (res.ok) {
            const rawResult = await res.json()
            const result = rawResult.data ?? rawResult
            if (result.addedItems) {
              for (const added of result.addedItems) {
                if (added.correlationId) {
                  store.updateItemId(added.correlationId, added.id)
                }
              }
            }
            if (result.subtotal !== undefined) {
              store.syncServerTotals({
                subtotal: result.subtotal,
                discountTotal: result.discountTotal ?? 0,
                taxTotal: result.taxTotal ?? 0,
                tipTotal: result.tipTotal,
                total: result.total,
                version: result.version,
              })
            }
          }
        } catch {
          // Silent failure — Send/Pay will retry via ensureOrderInDB
        } finally {
          autosaveInFlightRef.current = false
          autosavePromiseRef.current = null
        }
      })()
      autosavePromiseRef.current = promise
    }, 30000) // 30s safety net (event-based saves handle normal flow)

    return () => clearInterval(interval)
  }, []) // stable — reads from store directly

  // Bug 8 fix: Socket listener for cross-terminal order changes
  // When another terminal modifies the active order, refresh from server
  useEffect(() => {
    const orderId = currentOrder?.id
    if (!orderId || isTempId(orderId)) return

    const socket = getSharedSocket() as { on: (e: string, cb: (...args: unknown[]) => void) => void; off: (e: string, cb?: (...args: unknown[]) => void) => void }

    const onListChanged = (data: unknown) => {
      const payload = data as { orderId?: string; trigger?: string }
      if (payload.orderId !== orderId) return

      // Skip events triggered by our own mutations (within 500ms)
      if (Date.now() - lastMutationRef.current < 500) return

      loadOrder(orderId)
    }

    socket.on('orders:list-changed', onListChanged)
    return () => {
      socket.off('orders:list-changed', onListChanged)
      releaseSharedSocket()
    }
  }, [currentOrder?.id, loadOrder])

  // Remove item
  const handleRemoveItem = useCallback(async (itemId: string) => {
    const orderId = currentOrder?.id

    try {
      // If order is saved AND item has a real DB ID, delete from API
      if (orderId && !isTempId(itemId)) {
        const res = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          console.error('[useActiveOrder] DELETE failed:', res.status, errBody)
          toast.error('Failed to remove item')
          return
        }
      }

      // Update store
      const store = useOrderStore.getState()
      store.removeItem(itemId)
      toast.success('Item removed')

      // If that was the last item on an unsent order, clear it entirely
      const remaining = useOrderStore.getState().currentOrder
      if (remaining && remaining.items.length === 0 && !remaining.items.some(i => i.sentToKitchen)) {
        // Cancel DB draft if one exists
        if (remaining.id && !isTempId(remaining.id)) {
          fetch(`/api/orders/${remaining.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'cancelled' }),
          }).catch(() => {})
        }
        store.clearOrder()
      }
    } catch (error) {
      console.error('[useActiveOrder] Failed to remove item:', error)
      toast.error('Failed to remove item')
    }
  }, [currentOrder?.id])

  // Change quantity
  const handleQuantityChange = useCallback(async (itemId: string, delta: number) => {
    const item = items.find(i => i.id === itemId)
    if (!item) return

    const newQty = Math.max(1, item.quantity + delta)
    const orderId = currentOrder?.id

    try {
      // If order is saved, update via API
      if (orderId) {
        const res = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: newQty }),
        })
        if (!res.ok) {
          toast.error('Failed to update quantity')
          return
        }
      }

      // Update store
      useOrderStore.getState().updateQuantity(itemId, newQty)
    } catch (error) {
      console.error('[useActiveOrder] Failed to update quantity:', error)
      toast.error('Failed to update quantity')
    }
  }, [items, currentOrder?.id])

  // Toggle hold
  const handleHoldToggle = useCallback(async (itemId: string) => {
    const item = items.find(i => i.id === itemId)
    if (!item) return

    const newHeldState = !item.isHeld
    const orderId = currentOrder?.id

    try {
      // If order is saved, update via API
      if (orderId) {
        const res = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isHeld: newHeldState }),
        })
        if (!res.ok) {
          toast.error('Failed to toggle hold')
          return
        }
      }

      // Update store — hold and delay are mutually exclusive
      const updates: Record<string, any> = { isHeld: newHeldState }
      if (newHeldState) {
        // Setting hold ON → clear any per-item delay
        updates.delayMinutes = null
        updates.delayStartedAt = null
        updates.delayFiredAt = null
      }
      useOrderStore.getState().updateItem(itemId, updates)
      toast.success(newHeldState ? 'Item held' : 'Hold removed')
    } catch (error) {
      console.error('[useActiveOrder] Failed to toggle hold:', error)
      toast.error('Failed to toggle hold')
    }
  }, [items, currentOrder?.id])

  // Note editing — expose state for NoteEditModal (replaces window.prompt)
  const [noteEditTarget, setNoteEditTarget] = useState<{ itemId: string; currentNote?: string; itemName?: string } | null>(null)

  const openNoteEditor = useCallback((itemId: string, currentNote?: string) => {
    const item = items.find(i => i.id === itemId)
    setNoteEditTarget({ itemId, currentNote, itemName: item?.name })
  }, [items])

  const closeNoteEditor = useCallback(() => {
    setNoteEditTarget(null)
  }, [])

  const saveNote = useCallback(async (itemId: string, note: string) => {
    const orderId = currentOrder?.id

    try {
      // If order is saved, update via API
      if (orderId) {
        const res = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ specialNotes: note || null }),
        })
        if (!res.ok) {
          toast.error('Failed to update note')
          return
        }
      }

      // Update store
      useOrderStore.getState().updateItem(itemId, { specialNotes: note || undefined })
      toast.success('Note updated')
    } catch (error) {
      console.error('[useActiveOrder] Failed to save note:', error)
      toast.error('Failed to update note')
    }
  }, [currentOrder?.id])

  // Legacy handler — opens modal via state (used by onItemNoteEdit callback)
  const handleNoteEdit = useCallback((itemId: string, currentNote?: string) => {
    openNoteEditor(itemId, currentNote)
  }, [openNoteEditor])

  // Change course
  const handleCourseChange = useCallback(async (itemId: string, course: number | null) => {
    const orderId = currentOrder?.id

    try {
      // If order is saved, update via API
      if (orderId) {
        const res = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseNumber: course }),
        })
        if (!res.ok) {
          toast.error('Failed to update course')
          return
        }
      }

      // Update store
      useOrderStore.getState().updateItem(itemId, { courseNumber: course ?? undefined })
      toast.success('Course updated')
    } catch (error) {
      console.error('[useActiveOrder] Failed to update course:', error)
      toast.error('Failed to update course')
    }
  }, [currentOrder?.id])

  // Change seat
  const handleSeatChange = useCallback(async (itemId: string, seat: number | null) => {
    const orderId = currentOrder?.id

    try {
      // If order is saved, update via API
      if (orderId) {
        const res = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seatNumber: seat }),
        })
        if (!res.ok) {
          toast.error('Failed to update seat')
          return
        }
      }

      // Update store
      useOrderStore.getState().updateItem(itemId, { seatNumber: seat ?? undefined })
      toast.success('Seat updated')
    } catch (error) {
      console.error('[useActiveOrder] Failed to update seat:', error)
      toast.error('Failed to update seat')
    }
  }, [currentOrder?.id])

  // Edit modifiers (delegate to page)
  const handleEditModifiers = useCallback((itemId: string) => {
    options.onEditModifiers?.(itemId)
  }, [options])

  // Comp/Void (delegate to page)
  const handleCompVoid = useCallback((itemId: string) => {
    options.onCompVoid?.(itemId)
  }, [options])

  // Resend item
  const handleResend = useCallback(async (itemId: string) => {
    const orderId = currentOrder?.id
    if (!orderId) return

    try {
      const res = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resendToKitchen: true }),
      })
      if (!res.ok) {
        toast.error('Failed to resend item')
        return
      }

      toast.success('Item resent to kitchen')
      // Reload order to get updated state
      await loadOrder(orderId)
    } catch (error) {
      console.error('[useActiveOrder] Failed to resend item:', error)
      toast.error('Failed to resend item')
    }
  }, [currentOrder?.id, loadOrder])

  // Split item (delegate to page)
  const handleSplit = useCallback((itemId: string) => {
    options.onSplit?.(itemId)
  }, [options])

  // Toggle expand
  const handleToggleExpand = useCallback((itemId: string) => {
    setExpandedItemId(prev => prev === itemId ? null : itemId)
  }, [])

  // Send to kitchen — ensures order is in DB first, then sends
  // When coursing is enabled:
  //   - Course 1 + unassigned items fire immediately via /send
  //   - Course 2+ with delays: record startedAt in store (client timer starts)
  //   - Course 2+ without delays: also fire immediately
  const handleSendToKitchen = useCallback(async (employeeId?: string) => {
    // Ref-based guard: prevents duplicate sends when button is tapped rapidly
    // (React state `isSending` only updates after re-render — too slow for multi-tap)
    if (sendInProgressRef.current) return

    if (!currentOrder) {
      toast.error('No active order to send')
      return
    }

    // Must have at least one item
    if (currentOrder.items.length === 0) {
      toast.error('Add items before sending')
      return
    }

    sendInProgressRef.current = true
    setIsSending(true)
    lastMutationRef.current = Date.now() // Bug 8: stamp to skip own socket events

    try {
      // Routing: coursing, delay, or standard (fire-and-forget) send
      if (currentOrder.coursingEnabled) {
        // Coursing needs all items persisted first (blocking — per-course API calls)
        const resolvedOrderId = await ensureOrderInDB(employeeId)
        if (!resolvedOrderId) return
        // Determine which courses have delays set
        const courseDelays = currentOrder.courseDelays || {}
        const pendingItems = currentOrder.items.filter(i => !i.sentToKitchen && !i.isHeld)

        // Group pending items by course number
        const courseGroups = new Map<number, typeof pendingItems>()
        for (const item of pendingItems) {
          const cn = item.courseNumber ?? 1  // unassigned items = course 1
          if (!courseGroups.has(cn)) courseGroups.set(cn, [])
          courseGroups.get(cn)!.push(item)
        }

        // Sort courses
        const sortedCourses = Array.from(courseGroups.keys()).sort((a, b) => a - b)

        // Course 1 always fires immediately via /send (handles routing + socket)
        // The /send route sends ALL pending items — but for coursing we need selective firing.
        // Fire course 1 + any courses without delays via the standard /send route
        // Then set timers for delayed courses

        // Determine which courses fire now vs. later
        const coursesToFireNow: number[] = []
        const coursesToDelay: number[] = []

        for (const cn of sortedCourses) {
          const delay = courseDelays[cn]
          if (cn === 1 || !delay || delay.delayMinutes === 0) {
            // Course 1 always fires now; no delay = fire now
            coursesToFireNow.push(cn)
          } else if (delay.delayMinutes === -1) {
            // -1 = "Hold" — don't fire, don't start timer
            // User must manually fire via "Fire Now"
          } else {
            // Has a positive delay — start timer
            coursesToDelay.push(cn)
          }
        }

        // Fire immediate courses via /send (which sends all pending non-held items)
        // We need to temporarily hold delayed course items so /send skips them
        // Instead, use fire-course API for precise control

        // Fire each immediate course
        let totalSent = 0
        for (const cn of coursesToFireNow) {
          try {
            const res = await fetch(`/api/orders/${resolvedOrderId}/fire-course`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                courseNumber: cn,
                employeeId: employeeId || options.employeeId,
              }),
            })
            if (res.ok) {
              const rawResult = await res.json()
              const result = rawResult.data ?? rawResult
              totalSent += result.sentItemCount || 0
            }
          } catch (err) {
            console.error(`[useActiveOrder] Failed to fire course ${cn}:`, err)
          }
        }

        // Start delay timers for delayed courses by setting startedAt = now
        const store = useOrderStore.getState()
        if (store.currentOrder && coursesToDelay.length > 0) {
          const now = new Date().toISOString()
          const updatedDelays = { ...(store.currentOrder.courseDelays || {}) }
          for (const cn of coursesToDelay) {
            const delay = courseDelays[cn]
            if (delay) {
              updatedDelays[cn] = {
                delayMinutes: delay.delayMinutes,
                startedAt: now,  // CourseDelayControls will see this and start countdown
              }
            }
          }
          // Directly update courseDelays on currentOrder via setState
          useOrderStore.setState({
            currentOrder: { ...store.currentOrder!, courseDelays: updatedDelays }
          })
        }

        // Mark sent items in store (get fresh state after any courseDelays update)
        const freshStore = useOrderStore.getState()
        if (freshStore.currentOrder) {
          for (const cn of coursesToFireNow) {
            for (const item of freshStore.currentOrder.items) {
              const itemCourse = item.courseNumber ?? 1
              if (itemCourse === cn && !item.sentToKitchen && !item.isHeld) {
                freshStore.updateItem(item.id, { sentToKitchen: true, courseStatus: 'fired' })
              }
            }
          }
        }

        if (totalSent > 0) {
          toast.success(`Course${coursesToFireNow.length > 1 ? 's' : ''} ${coursesToFireNow.join(', ')} sent to kitchen`)
        }
        if (coursesToDelay.length > 0) {
          toast.info(`Course${coursesToDelay.length > 1 ? 's' : ''} ${coursesToDelay.join(', ')} on timer`)
        }

        options.onOrderSent?.(resolvedOrderId)

        // Reload from API for fresh server state
        await loadOrder(resolvedOrderId)
      } else if (currentOrder.pendingDelay && currentOrder.pendingDelay > 0 && !currentOrder.delayStartedAt) {
        // Order-level delay: persist items, start timer, don't fire yet
        const resolvedOrderId = await ensureOrderInDB(employeeId)
        if (!resolvedOrderId) return
        const store = useOrderStore.getState()
        store.startDelayTimer()
        toast.info(`Order delayed — fires in ${currentOrder.pendingDelay}m`)
        options.onOrderSent?.(resolvedOrderId)
      } else {
        // ═══ STANDARD SEND — FIRE-AND-FORGET (INSTANT UI) ═══
        // (sendInProgressRef already set at top of handleSendToKitchen)
        const timing = startPaymentTiming('send', currentOrder?.id)

        // Wait for all in-flight saves in parallel (autosave, event saves, draft)
        {
          const waits: Promise<unknown>[] = []
          if (autosavePromiseRef.current) waits.push(autosavePromiseRef.current)
          if (pendingSavesRef.current.size > 0) waits.push(Promise.all(pendingSavesRef.current.values()))
          if (draftPromiseRef.current) waits.push(draftPromiseRef.current)
          if (waits.length > 0) await Promise.all(waits)
          draftPromiseRef.current = null
        }

        // Get fresh state after draft/autosave resolution
        const store = useOrderStore.getState()
        const freshOrder = store.currentOrder
        if (!freshOrder) { sendInProgressRef.current = false; return }

        // Get DB order ID — create in DB now (this is the first time we persist the order)
        // Orders are local-only until Send is pressed; ensureOrderInDB creates the DB record
        // and assigns the orderNumber here, then appends all unsaved items atomically
        let resolvedOrderId = freshOrder.id && !isTempId(freshOrder.id) ? freshOrder.id : null
        const orderJustCreated = !resolvedOrderId  // true when ensureOrderInDB will be called
        if (!resolvedOrderId) {
          resolvedOrderId = await ensureOrderInDB(employeeId)
          if (!resolvedOrderId) { sendInProgressRef.current = false; return }
        }

        // Re-read from store after ensureOrderInDB — item IDs may have been mapped (temp → real)
        // Using freshOrder snapshot here would double-append items that ensureOrderInDB already saved
        const latestOrder = useOrderStore.getState().currentOrder || freshOrder
        const pendingItems = latestOrder.items.filter(i => !i.sentToKitchen && !i.isHeld)
        const delayedItems = pendingItems.filter(i => i.delayMinutes && i.delayMinutes > 0 && !i.delayStartedAt)
        const immediateItems = pendingItems.filter(i => !i.delayMinutes || i.delayMinutes <= 0)
        // If the order was just created (ensureOrderInDB ran), all items are already in the DB
        // — set unsavedItems to [] so bgChain skips the append step (avoids duplicate POSTs)
        const unsavedItems = orderJustCreated ? [] : latestOrder.items.filter(item => isTempId(item.id))

        if (immediateItems.length > 0 || delayedItems.length > 0) {
          // Optimistically mark immediate items as sent — UI clears instantly
          if (immediateItems.length > 0) {
            for (const item of immediateItems) {
              store.updateItem(item.id, { sentToKitchen: true })
            }
          }

          // Fire-and-forget: append unsaved items → send to kitchen
          // Both API calls run in background — user sees instant response
          // Block autosave while bgChain runs to prevent duplicate item creation
          autosaveInFlightRef.current = true
          markRequestSent(timing)
          const orderId = resolvedOrderId
          const bgChain = async () => {
            let itemIdMap: Map<string, string> | null = null

            // Bug 7 fix: Filter out items that have an active save in pendingSavesRef
            // to prevent both saveItemToDb() and bgChain() from POSTing the same item
            const safeUnsavedItems = unsavedItems.filter(item => !pendingSavesRef.current.has(item.id))

            // Step 1: Append unsaved items to DB (if any have temp IDs)
            if (safeUnsavedItems.length > 0) {
              const appendRes = await fetch(`/api/orders/${orderId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  items: safeUnsavedItems.map(item => buildOrderItemPayload(item, { includeCorrelationId: true })),
                  version: getOrderVersion(),
                }),
              })
              if (!appendRes.ok) throw new Error('Failed to save items')
              const rawAppend = await appendRes.json()
              const result = rawAppend.data ?? rawAppend
              itemIdMap = new Map<string, string>()
              if (result.addedItems) {
                const s = useOrderStore.getState()
                for (const added of result.addedItems) {
                  if (added.correlationId) {
                    itemIdMap.set(added.correlationId, added.id)
                    s.updateItemId(added.correlationId, added.id)
                  }
                }
              }
              if (result.subtotal !== undefined) {
                useOrderStore.getState().syncServerTotals({
                  subtotal: result.subtotal,
                  discountTotal: result.discountTotal ?? 0,
                  taxTotal: result.taxTotal ?? 0,
                  tipTotal: result.tipTotal,
                  total: result.total,
                  version: result.version,
                })
              }
            }

            // Step 2: Send to kitchen (items now in DB)
            const sendBody: Record<string, unknown> = {
              employeeId: employeeId || options.employeeId,
              version: getOrderVersion(),
            }
            if (delayedItems.length > 0 && immediateItems.length > 0) {
              sendBody.itemIds = immediateItems.map(i => {
                if (isTempId(i.id) && itemIdMap?.has(i.id)) return itemIdMap.get(i.id)!
                return i.id
              })
            }

            const sendRes = await fetch(`/api/orders/${orderId}/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sendBody),
            })
            if (!sendRes.ok) {
              const err = await sendRes.json().catch(() => ({}))
              throw new Error(err.error || 'Kitchen routing failed')
            }
          }

          bgChain()
            .then(() => { completePaymentTiming(timing, 'success') })
            .catch(err => {
              completePaymentTiming(timing, 'error')
              console.error('[useActiveOrder] Background send failed:', err)
              toast.error('Send failed — tap Send again to retry')
              // Revert optimistic marks on failure so items appear unsent again
              const s = useOrderStore.getState()
              for (const item of immediateItems) {
                s.updateItem(item.id, { sentToKitchen: false })
              }
            })
            .finally(() => {
              autosaveInFlightRef.current = false
              sendInProgressRef.current = false
            })
        }

        // Delay timers (synchronous — no DB call)
        if (delayedItems.length > 0) {
          store.startItemDelayTimers(delayedItems.map(i => i.id))
          const delayDesc = delayedItems.map(i => `${i.name} (${i.delayMinutes}m)`).join(', ')
          toast.info(`Delayed: ${delayDesc}`)
        }

        const storeAfter = useOrderStore.getState()
        if (storeAfter.currentOrder?.pendingDelay) {
          storeAfter.markDelayFired()
        }

        if (immediateItems.length > 0) {
          toast.success(`${immediateItems.length} item${immediateItems.length !== 1 ? 's' : ''} sent to kitchen`)
        }
        options.onOrderSent?.(resolvedOrderId)
      }
    } catch (error) {
      console.error('[useActiveOrder] Failed to send order:', error)
      toast.error('Failed to send order')
    } finally {
      setIsSending(false)
      // Safety net: ensure sendInProgressRef is cleared even if bgChain never ran
      // (bgChain's own .finally is the primary clear for the async case)
      if (!autosaveInFlightRef.current) {
        sendInProgressRef.current = false
      }
    }
  }, [currentOrder, options, loadOrder, ensureOrderInDB])

  // Fire a specific course to kitchen (called by CourseDelayControls timer or "Fire Now")
  const handleFireCourse = useCallback(async (courseNumber: number) => {
    const orderId = currentOrder?.id
    if (!orderId) {
      toast.error('No active order')
      return
    }

    try {
      const res = await fetch(`/api/orders/${orderId}/fire-course`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseNumber,
          employeeId: options.employeeId,
          version: getOrderVersion(),
        }),
      })

      if (!res.ok) {
        if (await handleVersionConflict(res, orderId)) return
        const error = await res.json()
        toast.error(error.error || `Failed to fire course ${courseNumber}`)
        return
      }

      const rawResult = await res.json()
      const result = rawResult.data ?? rawResult

      // Mark course as fired in store
      const store = useOrderStore.getState()
      store.fireCourse(courseNumber)

      // Mark non-held items in this course as sent
      if (store.currentOrder) {
        for (const item of store.currentOrder.items) {
          if (item.courseNumber === courseNumber && !item.sentToKitchen && !item.isHeld) {
            store.updateItem(item.id, { sentToKitchen: true, courseStatus: 'fired' })
          }
        }
      }

      toast.success(`Course ${courseNumber} fired (${result.sentItemCount} items)`)

      // Reload from API for fresh state
      await loadOrder(orderId)
    } catch (error) {
      console.error(`[useActiveOrder] Failed to fire course ${courseNumber}:`, error)
      toast.error(`Failed to fire course ${courseNumber}`)
    }
  }, [currentOrder?.id, options.employeeId, loadOrder])

  // Fire delayed items (order-level delay expired or manual "Fire Now")
  const handleFireDelayed = useCallback(async () => {
    const orderId = currentOrder?.id
    if (!orderId) {
      toast.error('No active order')
      return
    }

    try {
      // Send all remaining pending items via the standard send route
      const res = await fetch(`/api/orders/${orderId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: options.employeeId, version: getOrderVersion() }),
      })

      if (!res.ok) {
        if (await handleVersionConflict(res, orderId)) return
        const error = await res.json()
        toast.error(error.error || 'Failed to fire delayed items')
        return
      }

      // Mark delay as fired in store
      const store = useOrderStore.getState()
      store.markDelayFired()

      // Mark non-held items as sent (held items stay pending)
      if (store.currentOrder) {
        for (const item of store.currentOrder.items) {
          if (!item.sentToKitchen && !item.isHeld) {
            store.updateItem(item.id, { sentToKitchen: true })
          }
        }
      }

      toast.success('Delayed items fired to kitchen')

      // NOTE: Do NOT reload from API here — loadOrder wipes delayFiredAt (client-only field)
      // which can cause infinite re-fire loops. The store already has the correct state.
    } catch (error) {
      console.error('[useActiveOrder] Failed to fire delayed items:', error)
      toast.error('Failed to fire delayed items')
    }
  }, [currentOrder?.id, options.employeeId, loadOrder])

  // Set per-item delay on specific items
  const setItemDelay = useCallback((itemIds: string[], minutes: number | null) => {
    useOrderStore.getState().setItemDelay(itemIds, minutes)
  }, [])

  // Fire a single delayed item to kitchen (timer expired or manual "Fire Now")
  const handleFireItem = useCallback(async (itemId: string) => {
    const orderId = currentOrder?.id
    if (!orderId) {
      toast.error('No active order')
      return
    }

    try {
      // Check if item is held — release hold first before firing
      const item = items.find(i => i.id === itemId)
      if (item?.isHeld) {
        const holdRes = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isHeld: false }),
        })
        if (!holdRes.ok) {
          toast.error('Failed to release hold')
          return
        }
        useOrderStore.getState().updateItem(itemId, { isHeld: false })
      }

      // Send this specific item via /send with itemIds filter
      const res = await fetch(`/api/orders/${orderId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: options.employeeId,
          itemIds: [itemId],
          version: getOrderVersion(),
        }),
      })

      if (!res.ok) {
        if (await handleVersionConflict(res, orderId)) return
        const error = await res.json()
        toast.error(error.error || 'Failed to fire item')
        return
      }

      // Mark item as sent in store
      const store = useOrderStore.getState()
      if (item?.delayMinutes && item.delayMinutes > 0) {
        store.markItemDelayFired(itemId)
      }
      store.updateItem(itemId, { sentToKitchen: true })

      toast.success(item?.isHeld ? 'Held item fired to kitchen' : 'Delayed item fired to kitchen')

      // NOTE: Do NOT reload from API here — loadOrder wipes delayFiredAt (client-only field)
      // which can cause infinite re-fire loops. The store already has the correct state.
    } catch (error) {
      console.error('[useActiveOrder] Failed to fire item:', error)
      toast.error('Failed to fire item')
    }
  }, [currentOrder?.id, items, options.employeeId])

  return {
    // Order identity
    orderId: currentOrder?.id || null,
    orderNumber: currentOrder?.orderNumber || null,
    orderType: currentOrder?.orderType || null,
    tabName: currentOrder?.tabName || null,
    tableId: currentOrder?.tableId || null,
    locationId: currentOrder?.locationId || options.locationId || null,

    // Items
    items,

    // Totals
    subtotal: currentOrder?.subtotal || 0,
    tax: currentOrder?.taxTotal || 0,
    discounts: currentOrder?.discountTotal || 0,
    total: currentOrder?.total || 0,
    guestCount: currentOrder?.guestCount || 1,

    // UI state
    expandedItemId,
    isSending,
    hasUnsavedItems,
    hasOrder,

    // Lifecycle
    startOrder,
    addItem,
    loadOrder,
    clearOrder,
    ensureOrderInDB,

    // Note editing (for NoteEditModal)
    noteEditTarget,
    openNoteEditor,
    closeNoteEditor,
    saveNote,

    // Item handlers
    handleRemoveItem,
    handleQuantityChange,
    handleHoldToggle,
    handleNoteEdit,
    handleCourseChange,
    handleSeatChange,
    handleEditModifiers,
    handleCompVoid,
    handleResend,
    handleSplit,
    handleToggleExpand,

    // Send to kitchen
    handleSendToKitchen,

    // Coursing
    coursingEnabled: currentOrder?.coursingEnabled || false,
    courseDelays: currentOrder?.courseDelays || {},
    setCoursingEnabled: useOrderStore.getState().setCoursingEnabled,
    setCourseDelay: useOrderStore.getState().setCourseDelay,
    fireCourse: useOrderStore.getState().fireCourse,
    handleFireCourse,

    // Order-level delay
    pendingDelay: currentOrder?.pendingDelay ?? null,
    delayStartedAt: currentOrder?.delayStartedAt ?? null,
    delayFiredAt: currentOrder?.delayFiredAt ?? null,
    setPendingDelay: useOrderStore.getState().setPendingDelay,
    handleFireDelayed,

    // Per-item delay
    setItemDelay,
    handleFireItem,

    // Reopened order tracking
    reopenedAt: currentOrder?.reopenedAt ?? null,
    reopenReason: currentOrder?.reopenReason ?? null,
  }
}
