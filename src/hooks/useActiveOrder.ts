import { useCallback, useMemo, useState } from 'react'
import { useOrderStore } from '@/stores/order-store'
import { toast } from '@/stores/toast-store'
import { isTempId, buildOrderItemPayload } from '@/lib/order-utils'
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

      const order = await res.json()

      // Pass raw API response directly — store.loadOrder() is the SINGLE source of truth for mapping
      useOrderStore.getState().loadOrder(order)
    } catch (error) {
      console.error('[useActiveOrder] Failed to load order:', error)
      toast.error('Failed to load order')
    }
  }, [])

  // Clear order
  const clearOrder = useCallback(() => {
    useOrderStore.getState().clearOrder()
    setExpandedItemId(null)
    options.onOrderCleared?.()
  }, [options])

  // Start a new order (dine_in, bar_tab, takeout, etc.)
  const startOrder = useCallback((orderType: string, opts: StartOrderOptions = {}) => {
    useOrderStore.getState().startOrder(orderType, {
      locationId: opts.locationId || options.locationId,
      tableId: opts.tableId,
      tableName: opts.tableName,
      tabName: opts.tabName,
      guestCount: opts.guestCount,
      orderTypeId: opts.orderTypeId,
      customFields: opts.customFields,
    })
  }, [options.locationId])

  // Add an item to the current order (local only — not saved to DB until send/pay)
  const addItem = useCallback((item: AddItemInput) => {
    const store = useOrderStore.getState()
    if (!store.currentOrder) {
      console.warn('[useActiveOrder] addItem called but no currentOrder — call startOrder first')
      return
    }
    store.addItem({
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
      sentToKitchen: false,
      pizzaConfig: item.pizzaConfig,
    })
  }, [])

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
          toast.error(error.error || 'Failed to create order')
          return null
        }

        const created = await res.json()

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
      try {
        const res = await fetch(`/api/orders/${order.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: unsavedItems.map(item => buildOrderItemPayload(item, { includeCorrelationId: true })),
          }),
        })

        if (!res.ok) {
          const error = await res.json()
          toast.error(error.error || 'Failed to add items')
          return null
        }

        const result = await res.json()

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
          })
        }

        return order.id!
      } catch (error) {
        console.error('[useActiveOrder] ensureOrderInDB append failed:', error)
        toast.error('Failed to save items')
        return null
      }
    }
  }, [options.employeeId, options.locationId])

  // Remove item
  const handleRemoveItem = useCallback(async (itemId: string) => {
    const orderId = currentOrder?.id

    try {
      // If order is saved, delete from API
      if (orderId) {
        const res = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          toast.error('Failed to remove item')
          return
        }
      }

      // Update store
      useOrderStore.getState().removeItem(itemId)
      toast.success('Item removed')
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
    if (!currentOrder) {
      toast.error('No active order to send')
      return
    }

    // Must have at least one item
    if (currentOrder.items.length === 0) {
      toast.error('Add items before sending')
      return
    }

    setIsSending(true)

    try {
      // Step 1: Ensure order exists in DB (creates if needed, appends unsaved items)
      const resolvedOrderId = await ensureOrderInDB(employeeId)
      if (!resolvedOrderId) {
        // ensureOrderInDB already showed error toast
        return
      }

      // Step 2: If coursing is enabled, handle course-based firing
      if (currentOrder.coursingEnabled) {
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
              const result = await res.json()
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
        // Order-level delay: Save items to DB but DON'T fire to kitchen yet.
        // Start the delay timer — items will fire when timer expires or user taps "Fire Now"
        const store = useOrderStore.getState()
        store.startDelayTimer()
        toast.info(`Order delayed — fires in ${currentOrder.pendingDelay}m`)
        options.onOrderSent?.(resolvedOrderId)
      } else {
        // Standard send — check for per-item delays
        const store = useOrderStore.getState()
        const freshOrder = store.currentOrder
        if (!freshOrder) return

        const pendingItems = freshOrder.items.filter(i => !i.sentToKitchen && !i.isHeld)
        const heldItems = freshOrder.items.filter(i => !i.sentToKitchen && i.isHeld)
        const delayedItems = pendingItems.filter(i => i.delayMinutes && i.delayMinutes > 0 && !i.delayStartedAt)
        const immediateItems = pendingItems.filter(i => !i.delayMinutes || i.delayMinutes <= 0)

        // ALWAYS call the send route when there are pending items (immediate or delayed).
        // The send route handles delayed items by stamping delayStartedAt on the server.
        // Without this call, delayed-only sends would never persist delayStartedAt,
        // and loadOrder would wipe the client-side timestamp.
        if (immediateItems.length > 0 || delayedItems.length > 0) {
          const res = await fetch(`/api/orders/${resolvedOrderId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employeeId: employeeId || options.employeeId,
              // Only send specific item IDs when we have a mix of delayed and immediate
              ...(delayedItems.length > 0 && immediateItems.length > 0
                ? { itemIds: immediateItems.map(i => i.id) }
                : {}),
            }),
          })

          if (!res.ok) {
            const error = await res.json()
            toast.error(error.error || 'Failed to send order')
            return
          }

          // Mark immediate items as sent in store
          if (immediateItems.length > 0) {
            const storeAfterSend = useOrderStore.getState()
            if (storeAfterSend.currentOrder) {
              for (const item of immediateItems) {
                storeAfterSend.updateItem(item.id, { sentToKitchen: true })
              }
            }
          }
        }

        // Start delay timers on delayed items (client-side backup, server already stamped)
        if (delayedItems.length > 0) {
          store.startItemDelayTimers(delayedItems.map(i => i.id))
          const delayDesc = delayedItems.map(i => `${i.name} (${i.delayMinutes}m)`).join(', ')
          toast.info(`Delayed: ${delayDesc}`)
        }

        // Clear order-level delay state after successful send
        const storeAfter = useOrderStore.getState()
        if (storeAfter.currentOrder?.pendingDelay) {
          storeAfter.markDelayFired()
        }

        if (immediateItems.length > 0) {
          toast.success(`${immediateItems.length} item${immediateItems.length !== 1 ? 's' : ''} sent to kitchen`)
        }
        options.onOrderSent?.(resolvedOrderId)

        // Reload from API for fresh server state (delayStartedAt now persisted server-side)
        if (immediateItems.length > 0 || delayedItems.length > 0) {
          await loadOrder(resolvedOrderId)
        }
      }
    } catch (error) {
      console.error('[useActiveOrder] Failed to send order:', error)
      toast.error('Failed to send order')
    } finally {
      setIsSending(false)
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
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        toast.error(error.error || `Failed to fire course ${courseNumber}`)
        return
      }

      const result = await res.json()

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
        body: JSON.stringify({ employeeId: options.employeeId }),
      })

      if (!res.ok) {
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
        }),
      })

      if (!res.ok) {
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
