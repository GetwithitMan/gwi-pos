import { create } from 'zustand'
import type { UiModifier } from '@/types/orders'
import { generateTempItemId } from '@/lib/order-utils'

interface OrderItemModifier extends UiModifier {
  // Additional fields specific to order store
  commissionAmount?: number  // Commission earned on this modifier
}

// Ingredient modification types
interface IngredientModification {
  ingredientId: string
  name: string
  modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
  priceAdjustment: number
  swappedTo?: { modifierId: string; name: string; price: number }
}

// Pizza order configuration (inline type to avoid circular imports)
interface PizzaSauceSelectionStore {
  sauceId: string
  name: string
  sections: number[]
  amount: 'none' | 'light' | 'regular' | 'extra'
  price: number
}

interface PizzaCheeseSelectionStore {
  cheeseId: string
  name: string
  sections: number[]
  amount: 'none' | 'light' | 'regular' | 'extra'
  price: number
}

interface PizzaOrderConfigStore {
  sizeId: string
  crustId: string
  // Legacy fields for backwards compatibility
  sauceId: string | null
  cheeseId: string | null
  sauceAmount: 'none' | 'light' | 'regular' | 'extra'
  cheeseAmount: 'none' | 'light' | 'regular' | 'extra'
  // New sectional arrays
  sauces?: PizzaSauceSelectionStore[]
  cheeses?: PizzaCheeseSelectionStore[]
  toppings: Array<{
    toppingId: string
    name: string
    sections: number[]
    amount: 'light' | 'regular' | 'extra'
    price: number
    basePrice: number
  }>
  cookingInstructions?: string
  cutStyle?: string
  specialNotes?: string
  totalPrice: number
  priceBreakdown: {
    sizePrice: number
    crustPrice: number
    saucePrice: number
    cheesePrice: number
    toppingsPrice: number
  }
}

interface OrderItem {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers: OrderItemModifier[]
  ingredientModifications?: IngredientModification[]  // "No onion", "Extra bacon", etc.
  specialNotes?: string
  seatNumber?: number
  courseNumber?: number
  courseStatus?: 'pending' | 'fired' | 'ready' | 'served'
  isHeld?: boolean
  holdUntil?: string
  firedAt?: string
  commissionAmount?: number  // Commission earned on this item
  sentToKitchen?: boolean  // Track if this item has been sent to kitchen
  isCompleted?: boolean  // KDS completion status (kitchen marked done)
  completedAt?: string  // When kitchen marked it done
  resendCount?: number  // How many times resent to kitchen
  status?: 'active' | 'comped' | 'voided'  // Item status for comp/void tracking
  voidReason?: string  // Reason for comp/void
  wasMade?: boolean  // Was item made before void? For waste tracking
  // Per-item delay (5m, 10m, etc.)
  delayMinutes?: number | null      // Delay preset in minutes
  delayStartedAt?: string | null    // ISO timestamp when delay timer started (on Send)
  delayFiredAt?: string | null      // ISO timestamp when item was fired to kitchen
  // Entertainment/timed rental fields
  blockTimeMinutes?: number | null
  blockTimeStartedAt?: string | null
  blockTimeExpiresAt?: string | null
  sourceTableId?: string  // Which table this item was ordered from
  // Pizza builder configuration
  pizzaConfig?: PizzaOrderConfigStore
  // Category type for tax-inclusive pricing
  categoryType?: string
}

export interface CourseDelay {
  delayMinutes: number
  startedAt?: string  // ISO timestamp when delay timer started
  firedAt?: string    // ISO timestamp when course was fired
}

interface Order {
  id?: string
  orderNumber?: number  // For display purposes
  orderType: 'dine_in' | 'takeout' | 'delivery' | 'bar_tab' | string  // Allow custom order types
  orderTypeId?: string  // Reference to OrderType record
  locationId?: string  // Required for API calls
  tableId?: string
  tableName?: string
  tabName?: string
  guestCount: number
  items: OrderItem[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  tipTotal?: number  // Gratuity amount
  total: number
  notes?: string
  primaryPaymentMethod?: 'cash' | 'card'
  commissionTotal: number  // Total commission for the order
  customFields?: Record<string, string>  // Custom fields for configurable order types
  // Coursing
  coursingEnabled?: boolean  // Whether coursing is active for this order
  courseDelays?: Record<number, CourseDelay>  // Per-course delay settings
  // Order-level delay (non-coursing mode: delays ALL pending items after Send)
  pendingDelay?: number | null       // Preset delay minutes (5, 10, etc.) — set by gutter 5m/10m
  delayStartedAt?: string | null     // ISO timestamp when delay timer started (on Send)
  delayFiredAt?: string | null       // ISO timestamp when delayed items were fired
  // Reopened order tracking
  reopenedAt?: string | null
  reopenReason?: string | null
}

interface LoadedOrderData {
  id: string
  orderNumber?: number
  orderType: Order['orderType']
  tableId?: string
  tableName?: string
  tabName?: string
  guestCount: number
  status?: string
  items: {
    id: string
    menuItemId: string
    name: string
    price: number
    quantity: number
    itemTotal: number
    specialNotes?: string | null
    seatNumber?: number | null
    courseNumber?: number | null
    courseStatus?: string | null
    isHeld?: boolean
    holdUntil?: string | null
    firedAt?: string | null
    isCompleted?: boolean
    completedAt?: string | null
    resendCount?: number
    status?: string
    voidReason?: string | null
    wasMade?: boolean
    // Entertainment/timed rental fields
    blockTimeMinutes?: number | null
    blockTimeStartedAt?: string | null
    blockTimeExpiresAt?: string | null
    kitchenStatus?: string | null
    // Per-item delay
    delayMinutes?: number | null
    delayStartedAt?: string | null
    sourceTableId?: string | null
    modifiers: {
      id: string
      modifierId: string
      name: string
      price: number
      preModifier?: string | null
      depth?: number
    }[]
    ingredientModifications?: (IngredientModification & {
      id: string
      ingredientName: string
      swappedToModifierId?: string | null
      swappedToModifierName?: string | null
    })[]
    // Pizza configuration
    pizzaConfig?: PizzaOrderConfigStore
  }[]
  subtotal: number
  discountTotal?: number
  taxTotal: number
  tipTotal?: number
  total: number
  notes?: string
  reopenedAt?: string | null
  reopenReason?: string | null
}

interface OrderState {
  currentOrder: Order | null
  orderHistory: Order[]

  // Actions
  startOrder: (orderType: Order['orderType'], options?: { locationId?: string; tableId?: string; tableName?: string; tabName?: string; guestCount?: number; orderTypeId?: string; customFields?: Record<string, string> }) => void
  updateOrderType: (orderType: Order['orderType'], options?: { locationId?: string; tableId?: string; tableName?: string; tabName?: string; guestCount?: number; orderTypeId?: string; customFields?: Record<string, string> }) => void
  loadOrder: (orderData: LoadedOrderData) => void
  addItem: (item: Omit<OrderItem, 'id'>) => void
  updateItem: (itemId: string, updates: Partial<OrderItem>) => void
  removeItem: (itemId: string) => void
  updateQuantity: (itemId: string, quantity: number) => void
  setGuestCount: (count: number) => void
  setNotes: (notes: string) => void
  setPaymentMethod: (method: 'cash' | 'card') => void
  applyDiscount: (amount: number) => void
  calculateTotals: () => void
  clearOrder: () => void
  saveOrder: () => void
  // New methods for shared order domain
  updateOrderId: (id: string, orderNumber?: number) => void
  updateItemId: (tempId: string, realId: string) => void
  syncServerTotals: (totals: { subtotal: number; discountTotal: number; taxTotal: number; tipTotal?: number; total: number; commissionTotal?: number }) => void
  // Coursing
  setCoursingEnabled: (enabled: boolean) => void
  setCourseDelay: (courseNumber: number, delayMinutes: number) => void
  fireCourse: (courseNumber: number) => void
  clearCourseDelay: (courseNumber: number) => void
  // Order-level delay
  setPendingDelay: (minutes: number | null) => void
  startDelayTimer: () => void
  markDelayFired: () => void
  // Per-item delay
  setItemDelay: (itemIds: string[], minutes: number | null) => void
  startItemDelayTimers: (itemIds: string[]) => void
  markItemDelayFired: (itemId: string) => void
  // Tax rate (from location settings)
  setEstimatedTaxRate: (rate: number) => void
}

// Client-side tax rate estimate — overridden by syncServerTotals after API calls.
// Set via setEstimatedTaxRate when location settings load.
let estimatedTaxRate = 0.08

// Pure function to compute totals from an order — used by mutations to batch into a single set()
function computeTotals(order: Order): { subtotal: number; taxTotal: number; total: number; commissionTotal: number } {
  let subtotal = 0
  let commissionTotal = 0

  order.items.forEach(item => {
    // Skip voided and comped items — they don't contribute to totals
    if (item.status === 'voided' || item.status === 'comped') return

    const itemPrice = item.price * item.quantity
    const modifiersPrice = item.modifiers.reduce((modSum, mod) => modSum + mod.price, 0) * item.quantity
    const ingredientModsPrice = (item.ingredientModifications || []).reduce((sum, ing) => sum + (ing.priceAdjustment || 0), 0) * item.quantity
    subtotal += itemPrice + modifiersPrice + ingredientModsPrice

    // Calculate commission for item
    const itemCommission = (item.commissionAmount || 0) * item.quantity
    const modifiersCommission = item.modifiers.reduce(
      (modSum, mod) => modSum + (mod.commissionAmount || 0),
      0
    ) * item.quantity
    commissionTotal += itemCommission + modifiersCommission
  })

  const afterDiscount = subtotal - order.discountTotal
  // Client-side estimate only — server totals via syncServerTotals are authoritative
  const taxTotal = Math.round(afterDiscount * estimatedTaxRate * 100) / 100
  const total = Math.round((afterDiscount + taxTotal) * 100) / 100

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxTotal,
    total,
    commissionTotal: Math.round(commissionTotal * 100) / 100,
  }
}

export const useOrderStore = create<OrderState>((set, get) => ({
  currentOrder: null,
  orderHistory: [],

  startOrder: (orderType, options = {}) => {
    set({
      currentOrder: {
        orderType,
        orderTypeId: options.orderTypeId,
        locationId: options.locationId,
        tableId: options.tableId,
        tableName: options.tableName,
        tabName: options.tabName,
        guestCount: options.guestCount || 1,
        items: [],
        subtotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        total: 0,
        commissionTotal: 0,
        customFields: options.customFields,
      },
    })
  },

  updateOrderType: (orderType, options = {}) => {
    const { currentOrder } = get()
    if (!currentOrder) {
      // No existing order, just start a new one
      get().startOrder(orderType, options)
      return
    }

    // Update order type while preserving items
    set({
      currentOrder: {
        ...currentOrder,
        orderType,
        orderTypeId: options.orderTypeId ?? currentOrder.orderTypeId,
        tableId: options.tableId ?? currentOrder.tableId,
        tableName: options.tableName ?? currentOrder.tableName,
        tabName: options.tabName ?? currentOrder.tabName,
        guestCount: options.guestCount ?? currentOrder.guestCount,
        customFields: options.customFields ?? currentOrder.customFields,
      },
    })
  },

  loadOrder: (orderData) => {
    // Convert API order data to store format - mark existing items as sent to kitchen
    const items: OrderItem[] = orderData.items.map(item => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      specialNotes: item.specialNotes || undefined,
      seatNumber: item.seatNumber || undefined,
      courseNumber: item.courseNumber || undefined,
      courseStatus: (item.courseStatus as OrderItem['courseStatus']) || undefined,
      isHeld: item.isHeld || false,
      holdUntil: item.holdUntil || undefined,
      firedAt: item.firedAt || undefined,
      sentToKitchen: item.kitchenStatus ? item.kitchenStatus !== 'pending' : true,
      sourceTableId: item.sourceTableId || undefined,
      isCompleted: item.isCompleted || false,
      completedAt: item.completedAt || undefined,
      resendCount: item.resendCount || 0,
      status: (item.status || 'active') as OrderItem['status'],
      voidReason: item.voidReason || undefined,
      wasMade: item.wasMade,
      // Per-item delay fields
      delayMinutes: item.delayMinutes || null,
      delayStartedAt: item.delayStartedAt || null,
      // Entertainment/timed rental fields
      blockTimeMinutes: item.blockTimeMinutes,
      blockTimeStartedAt: item.blockTimeStartedAt,
      blockTimeExpiresAt: item.blockTimeExpiresAt,
      modifiers: item.modifiers.map(mod => ({
        id: mod.modifierId,
        name: mod.name,
        price: mod.price,
        preModifier: mod.preModifier || undefined,
        depth: mod.depth || 0,
      })),
      // Ingredient modifications (No, Lite, On Side, Extra, Swap)
      ingredientModifications: item.ingredientModifications?.map(ing => ({
        ingredientId: ing.ingredientId,
        name: ing.ingredientName,
        modificationType: ing.modificationType,
        priceAdjustment: ing.priceAdjustment,
        swappedTo: ing.swappedToModifierId ? {
          modifierId: ing.swappedToModifierId,
          name: ing.swappedToModifierName || '',
          price: 0, // Price already included in priceAdjustment
        } : undefined,
      })),
      // Pizza configuration
      pizzaConfig: item.pizzaConfig,
    }))

    set({
      currentOrder: {
        id: orderData.id,
        orderNumber: orderData.orderNumber,
        orderType: orderData.orderType,
        tableId: orderData.tableId,
        tableName: orderData.tableName,
        tabName: orderData.tabName,
        guestCount: orderData.guestCount,
        items,
        subtotal: orderData.subtotal,
        discountTotal: 0,
        taxTotal: orderData.taxTotal,
        tipTotal: orderData.tipTotal || 0,
        total: orderData.total,
        notes: orderData.notes,
        commissionTotal: 0,
        reopenedAt: orderData.reopenedAt || null,
        reopenReason: orderData.reopenReason || null,
      },
    })
  },

  addItem: (item) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    const newItem: OrderItem = {
      ...item,
      id: generateTempItemId(),
    }

    const updatedOrder = { ...currentOrder, items: [...currentOrder.items, newItem] }
    const totals = computeTotals(updatedOrder)
    set({ currentOrder: { ...updatedOrder, ...totals } })
  },

  updateItem: (itemId, updates) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    const updatedOrder = {
      ...currentOrder,
      items: currentOrder.items.map((item) =>
        item.id === itemId ? { ...item, ...updates } : item
      ),
    }
    const totals = computeTotals(updatedOrder)
    set({ currentOrder: { ...updatedOrder, ...totals } })
  },

  removeItem: (itemId) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    const updatedOrder = {
      ...currentOrder,
      items: currentOrder.items.filter((item) => item.id !== itemId),
    }
    const totals = computeTotals(updatedOrder)
    set({ currentOrder: { ...updatedOrder, ...totals } })
  },

  updateQuantity: (itemId, quantity) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    if (quantity <= 0) {
      get().removeItem(itemId)
      return
    }

    get().updateItem(itemId, { quantity })
  },

  setGuestCount: (count) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    set({
      currentOrder: {
        ...currentOrder,
        guestCount: count,
      },
    })
  },

  setNotes: (notes) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    set({
      currentOrder: {
        ...currentOrder,
        notes,
      },
    })
  },

  setPaymentMethod: (method) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    set({
      currentOrder: {
        ...currentOrder,
        primaryPaymentMethod: method,
      },
    })
  },

  applyDiscount: (amount) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    const updatedOrder = { ...currentOrder, discountTotal: amount }
    const totals = computeTotals(updatedOrder)
    set({ currentOrder: { ...updatedOrder, ...totals } })
  },

  calculateTotals: () => {
    const { currentOrder } = get()
    if (!currentOrder) return

    const totals = computeTotals(currentOrder)
    set({ currentOrder: { ...currentOrder, ...totals } })
  },

  clearOrder: () => {
    set({ currentOrder: null })
  },

  saveOrder: () => {
    const { currentOrder, orderHistory } = get()
    if (!currentOrder) return

    set({
      orderHistory: [...orderHistory, currentOrder],
      currentOrder: null,
    })
  },

  // Update order's DB ID without resetting items (after creating in DB)
  updateOrderId: (id, orderNumber) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    set({
      currentOrder: {
        ...currentOrder,
        id,
        ...(orderNumber !== undefined ? { orderNumber } : {}),
      },
    })
  },

  // Replace a temp item ID with a real DB ID (after saving to DB)
  updateItemId: (tempId, realId) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    set({
      currentOrder: {
        ...currentOrder,
        items: currentOrder.items.map(item =>
          item.id === tempId ? { ...item, id: realId } : item
        ),
      },
    })
  },

  // Overwrite client-calculated totals with server-calculated values
  syncServerTotals: (totals) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    set({
      currentOrder: {
        ...currentOrder,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        ...(totals.tipTotal !== undefined ? { tipTotal: totals.tipTotal } : {}),
        ...(totals.commissionTotal !== undefined ? { commissionTotal: totals.commissionTotal } : {}),
      },
    })
  },

  // Coursing
  setCoursingEnabled: (enabled) => {
    const { currentOrder } = get()
    if (!currentOrder) return
    set({
      currentOrder: {
        ...currentOrder,
        coursingEnabled: enabled,
        // When disabling, clear course delays
        courseDelays: enabled ? currentOrder.courseDelays : {},
      },
    })
  },

  setCourseDelay: (courseNumber, delayMinutes) => {
    const { currentOrder } = get()
    if (!currentOrder) return
    set({
      currentOrder: {
        ...currentOrder,
        courseDelays: {
          ...(currentOrder.courseDelays || {}),
          [courseNumber]: { delayMinutes },
        },
      },
    })
  },

  fireCourse: (courseNumber) => {
    const { currentOrder } = get()
    if (!currentOrder) return
    const existing = currentOrder.courseDelays?.[courseNumber]
    set({
      currentOrder: {
        ...currentOrder,
        courseDelays: {
          ...(currentOrder.courseDelays || {}),
          [courseNumber]: {
            delayMinutes: existing?.delayMinutes || 0,
            startedAt: existing?.startedAt,
            firedAt: new Date().toISOString(),
          },
        },
      },
    })
  },

  clearCourseDelay: (courseNumber) => {
    const { currentOrder } = get()
    if (!currentOrder) return
    const delays = { ...(currentOrder.courseDelays || {}) }
    delete delays[courseNumber]
    set({
      currentOrder: {
        ...currentOrder,
        courseDelays: delays,
      },
    })
  },

  // Order-level delay (non-coursing / always-available delay)
  setPendingDelay: (minutes) => {
    const { currentOrder } = get()
    if (!currentOrder) return
    set({
      currentOrder: {
        ...currentOrder,
        pendingDelay: minutes,
        // If setting to null or changing, reset timer state
        delayStartedAt: null,
        delayFiredAt: null,
      },
    })
  },

  startDelayTimer: () => {
    const { currentOrder } = get()
    if (!currentOrder || !currentOrder.pendingDelay) return
    set({
      currentOrder: {
        ...currentOrder,
        delayStartedAt: new Date().toISOString(),
      },
    })
  },

  markDelayFired: () => {
    const { currentOrder } = get()
    if (!currentOrder) return
    set({
      currentOrder: {
        ...currentOrder,
        delayFiredAt: new Date().toISOString(),
      },
    })
  },

  // Per-item delay: set delay on specific items (or clear with null)
  // Hold and delay are mutually exclusive — setting delay clears hold
  setItemDelay: (itemIds, minutes) => {
    const { currentOrder } = get()
    if (!currentOrder) return
    set({
      currentOrder: {
        ...currentOrder,
        items: currentOrder.items.map(item =>
          itemIds.includes(item.id)
            ? {
                ...item,
                delayMinutes: minutes,
                delayStartedAt: null,
                delayFiredAt: null,
                // Clear hold when setting a delay (mutually exclusive)
                ...(minutes && minutes > 0 ? { isHeld: false } : {}),
              }
            : item
        ),
      },
    })
  },

  // Per-item delay: start timers on specific items (called on Send)
  startItemDelayTimers: (itemIds) => {
    const { currentOrder } = get()
    if (!currentOrder) return
    const now = new Date().toISOString()
    set({
      currentOrder: {
        ...currentOrder,
        items: currentOrder.items.map(item =>
          itemIds.includes(item.id) && item.delayMinutes && item.delayMinutes > 0
            ? { ...item, delayStartedAt: now }
            : item
        ),
      },
    })
  },

  // Per-item delay: mark a single item as fired (timer expired or manual fire)
  markItemDelayFired: (itemId) => {
    const { currentOrder } = get()
    if (!currentOrder) return
    set({
      currentOrder: {
        ...currentOrder,
        items: currentOrder.items.map(item =>
          item.id === itemId
            ? { ...item, delayFiredAt: new Date().toISOString() }
            : item
        ),
      },
    })
  },

  // Set estimated tax rate from location settings (for client-side UX before server sync)
  setEstimatedTaxRate: (rate) => {
    estimatedTaxRate = rate
  },
}))
