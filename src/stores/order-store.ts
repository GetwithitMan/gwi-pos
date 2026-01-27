import { create } from 'zustand'

interface OrderItemModifier {
  id: string
  name: string
  price: number
  preModifier?: string
  depth: number  // 0 = top-level, 1 = child, 2 = grandchild, etc.
  parentModifierId?: string  // ID of parent modifier if this is a child
  commissionAmount?: number  // Commission earned on this modifier
}

interface OrderItem {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers: OrderItemModifier[]
  specialNotes?: string
  seatNumber?: number
  courseNumber?: number
  commissionAmount?: number  // Commission earned on this item
  sentToKitchen?: boolean  // Track if this item has been sent to kitchen
}

interface Order {
  id?: string
  orderNumber?: number  // For display purposes
  orderType: 'dine_in' | 'takeout' | 'delivery' | 'bar_tab'
  tableId?: string
  tableName?: string
  tabName?: string
  guestCount: number
  items: OrderItem[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
  notes?: string
  primaryPaymentMethod?: 'cash' | 'card'
  commissionTotal: number  // Total commission for the order
}

interface LoadedOrderData {
  id: string
  orderNumber?: number
  orderType: Order['orderType']
  tableId?: string
  tabName?: string
  guestCount: number
  items: {
    id: string
    menuItemId: string
    name: string
    price: number
    quantity: number
    itemTotal: number
    specialNotes?: string | null
    modifiers: {
      id: string
      modifierId: string
      name: string
      price: number
      preModifier?: string | null
    }[]
  }[]
  subtotal: number
  taxTotal: number
  total: number
  notes?: string
}

interface OrderState {
  currentOrder: Order | null
  orderHistory: Order[]

  // Actions
  startOrder: (orderType: Order['orderType'], options?: { tableId?: string; tableName?: string; tabName?: string; guestCount?: number }) => void
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
}

const TAX_RATE = 0.08 // 8% - should come from location settings

function generateItemId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export const useOrderStore = create<OrderState>((set, get) => ({
  currentOrder: null,
  orderHistory: [],

  startOrder: (orderType, options = {}) => {
    set({
      currentOrder: {
        orderType,
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
      sentToKitchen: true, // Items from database have already been sent
      modifiers: item.modifiers.map(mod => ({
        id: mod.modifierId,
        name: mod.name,
        price: mod.price,
        preModifier: mod.preModifier || undefined,
        depth: 0,
      })),
    }))

    set({
      currentOrder: {
        id: orderData.id,
        orderNumber: orderData.orderNumber,
        orderType: orderData.orderType,
        tableId: orderData.tableId,
        tabName: orderData.tabName,
        guestCount: orderData.guestCount,
        items,
        subtotal: orderData.subtotal,
        discountTotal: 0,
        taxTotal: orderData.taxTotal,
        total: orderData.total,
        notes: orderData.notes,
        commissionTotal: 0,
      },
    })
  },

  addItem: (item) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    const newItem: OrderItem = {
      ...item,
      id: generateItemId(),
    }

    set({
      currentOrder: {
        ...currentOrder,
        items: [...currentOrder.items, newItem],
      },
    })
    get().calculateTotals()
  },

  updateItem: (itemId, updates) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    set({
      currentOrder: {
        ...currentOrder,
        items: currentOrder.items.map((item) =>
          item.id === itemId ? { ...item, ...updates } : item
        ),
      },
    })
    get().calculateTotals()
  },

  removeItem: (itemId) => {
    const { currentOrder } = get()
    if (!currentOrder) return

    set({
      currentOrder: {
        ...currentOrder,
        items: currentOrder.items.filter((item) => item.id !== itemId),
      },
    })
    get().calculateTotals()
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

    set({
      currentOrder: {
        ...currentOrder,
        discountTotal: amount,
      },
    })
    get().calculateTotals()
  },

  calculateTotals: () => {
    const { currentOrder } = get()
    if (!currentOrder) return

    let subtotal = 0
    let commissionTotal = 0

    currentOrder.items.forEach(item => {
      const itemPrice = item.price * item.quantity
      const modifiersPrice = item.modifiers.reduce((modSum, mod) => modSum + mod.price, 0) * item.quantity
      subtotal += itemPrice + modifiersPrice

      // Calculate commission for item
      const itemCommission = (item.commissionAmount || 0) * item.quantity
      const modifiersCommission = item.modifiers.reduce(
        (modSum, mod) => modSum + (mod.commissionAmount || 0),
        0
      ) * item.quantity
      commissionTotal += itemCommission + modifiersCommission
    })

    const afterDiscount = subtotal - currentOrder.discountTotal
    const taxTotal = Math.round(afterDiscount * TAX_RATE * 100) / 100
    const total = Math.round((afterDiscount + taxTotal) * 100) / 100

    set({
      currentOrder: {
        ...currentOrder,
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal,
        total,
        commissionTotal: Math.round(commissionTotal * 100) / 100,
      },
    })
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
}))
