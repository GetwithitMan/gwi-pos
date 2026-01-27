import { create } from 'zustand'

interface OrderItem {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers: {
    id: string
    name: string
    price: number
    preModifier?: string
  }[]
  specialNotes?: string
  seatNumber?: number
  courseNumber?: number
}

interface Order {
  id?: string
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
}

interface OrderState {
  currentOrder: Order | null
  orderHistory: Order[]

  // Actions
  startOrder: (orderType: Order['orderType'], options?: { tableId?: string; tableName?: string; tabName?: string; guestCount?: number }) => void
  addItem: (item: Omit<OrderItem, 'id'>) => void
  updateItem: (itemId: string, updates: Partial<OrderItem>) => void
  removeItem: (itemId: string) => void
  updateQuantity: (itemId: string, quantity: number) => void
  setGuestCount: (count: number) => void
  setNotes: (notes: string) => void
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

    const subtotal = currentOrder.items.reduce((sum, item) => {
      const itemPrice = item.price * item.quantity
      const modifiersPrice = item.modifiers.reduce((modSum, mod) => modSum + mod.price, 0) * item.quantity
      return sum + itemPrice + modifiersPrice
    }, 0)

    const afterDiscount = subtotal - currentOrder.discountTotal
    const taxTotal = Math.round(afterDiscount * TAX_RATE * 100) / 100
    const total = Math.round((afterDiscount + taxTotal) * 100) / 100

    set({
      currentOrder: {
        ...currentOrder,
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal,
        total,
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
