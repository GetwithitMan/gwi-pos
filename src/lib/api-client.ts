/**
 * Centralized API Client for GWI POS
 *
 * This module provides typed methods for all API endpoints to eliminate
 * duplicate fetch patterns across the codebase.
 *
 * Usage:
 *   import { api } from '@/lib/api-client'
 *
 *   // Instead of:
 *   const response = await fetch('/api/customers?locationId=xxx')
 *   if (!response.ok) throw new Error('Failed')
 *   const data = await response.json()
 *
 *   // Use:
 *   const data = await api.customers.list({ locationId: 'xxx' })
 */

// ============================================
// Types
// ============================================

export interface ApiResponse<T> {
  data?: T
  error?: string
}

export interface ApiError extends Error {
  status: number
  statusText: string
}

// ============================================
// Base Fetch Wrapper
// ============================================

async function fetchApi<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })

  if (!response.ok) {
    const error = new Error(`API Error: ${response.statusText}`) as ApiError
    error.status = response.status
    error.statusText = response.statusText

    // Try to get error message from response
    try {
      const errorData = await response.json()
      if (errorData.error) {
        error.message = errorData.error
      }
    } catch {
      // Ignore JSON parse errors
    }

    throw error
  }

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return {} as T
  }

  const data = await response.json()
  return data.data !== undefined ? data.data : data
}

function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const filtered = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  return filtered.length > 0 ? `?${filtered.join('&')}` : ''
}

// ============================================
// API Client
// ============================================

export const api = {
  // ==========================================
  // Auth
  // ==========================================
  auth: {
    login: (pin: string, locationId?: string) =>
      fetchApi<{ employee: unknown }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ pin, locationId }),
      }),
  },

  // ==========================================
  // Settings
  // ==========================================
  settings: {
    get: () => fetchApi<unknown>('/api/settings'),

    update: (settings: unknown) =>
      fetchApi<unknown>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
  },

  // ==========================================
  // Employees
  // ==========================================
  employees: {
    list: (params: { locationId: string; includeInactive?: boolean }) =>
      fetchApi<unknown[]>(`/api/employees${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/employees/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/employees', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/employees/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchApi<void>(`/api/employees/${id}`, { method: 'DELETE' }),

    // Layout settings
    getLayout: (id: string) =>
      fetchApi<unknown>(`/api/employees/${id}/layout`),

    updateLayout: (id: string, layout: unknown) =>
      fetchApi<unknown>(`/api/employees/${id}/layout`, {
        method: 'PUT',
        body: JSON.stringify(layout),
      }),

    // Tips
    getTips: (id: string) =>
      fetchApi<unknown>(`/api/employees/${id}/tips`),

    collectTips: (id: string) =>
      fetchApi<unknown>(`/api/employees/${id}/tips`, {
        method: 'POST',
      }),

    // Open tabs
    getOpenTabs: (id: string) =>
      fetchApi<unknown>(`/api/employees/${id}/open-tabs`, {
        method: 'POST',
      }),
  },

  // ==========================================
  // Roles
  // ==========================================
  roles: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/roles${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/roles/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/roles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/roles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchApi<void>(`/api/roles/${id}`, { method: 'DELETE' }),
  },

  // ==========================================
  // Customers
  // ==========================================
  customers: {
    list: (params: { locationId: string; search?: string; page?: number; limit?: number }) =>
      fetchApi<unknown[]>(`/api/customers${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/customers/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/customers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/customers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchApi<void>(`/api/customers/${id}`, { method: 'DELETE' }),
  },

  // ==========================================
  // Orders
  // ==========================================
  orders: {
    get: (id: string) => fetchApi<unknown>(`/api/orders/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/orders', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/orders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    listOpen: (params: { locationId: string; employeeId?: string }) =>
      fetchApi<unknown[]>(`/api/orders/open${buildQueryString(params)}`),

    listClosed: (params: { locationId: string; startDate?: string; endDate?: string }) =>
      fetchApi<unknown[]>(`/api/orders/closed${buildQueryString(params)}`),

    // Payment
    pay: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/orders/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // Receipt
    getReceipt: (id: string, locationId: string) =>
      fetchApi<unknown>(`/api/orders/${id}/receipt?locationId=${locationId}`),

    // Split
    getSplitInfo: (id: string) =>
      fetchApi<unknown>(`/api/orders/${id}/split`),

    split: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/orders/${id}/split`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    unsplit: (id: string) =>
      fetchApi<unknown>(`/api/orders/${id}/split`, {
        method: 'DELETE',
      }),

    // Discount
    applyDiscount: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/orders/${id}/discount`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    removeDiscount: (id: string, discountId: string) =>
      fetchApi<unknown>(`/api/orders/${id}/discount`, {
        method: 'DELETE',
        body: JSON.stringify({ discountId }),
      }),

    // Comp/Void
    compVoid: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/orders/${id}/comp-void`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // Courses
    getCourses: (id: string) =>
      fetchApi<unknown>(`/api/orders/${id}/courses`),

    updateCourses: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/orders/${id}/courses`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // Transfer items
    getTransferInfo: (id: string, params: { targetOrderId?: string }) =>
      fetchApi<unknown>(`/api/orders/${id}/transfer-items${buildQueryString(params)}`),

    transferItems: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/orders/${id}/transfer-items`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    // Items
    updateItem: (orderId: string, itemId: string, data: unknown) =>
      fetchApi<unknown>(`/api/orders/${orderId}/items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  // ==========================================
  // Tabs
  // ==========================================
  tabs: {
    list: (params: { locationId: string; status?: string; employeeId?: string }) =>
      fetchApi<unknown[]>(`/api/tabs${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/tabs/${id}`),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/tabs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    close: (id: string) =>
      fetchApi<unknown>(`/api/tabs/${id}`, {
        method: 'DELETE',
      }),

    transfer: (id: string, data: { toEmployeeId: string }) =>
      fetchApi<unknown>(`/api/tabs/${id}/transfer`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // ==========================================
  // Menu
  // ==========================================
  menu: {
    get: (params?: { locationId?: string; _t?: number }) =>
      fetchApi<unknown>(`/api/menu${buildQueryString(params || {})}`),

    // Categories
    categories: {
      create: (data: unknown) =>
        fetchApi<unknown>('/api/menu/categories', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: unknown) =>
        fetchApi<unknown>(`/api/menu/categories/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        fetchApi<void>(`/api/menu/categories/${id}`, { method: 'DELETE' }),
    },

    // Items
    items: {
      get: (id: string) => fetchApi<unknown>(`/api/menu/items/${id}`),

      create: (data: unknown) =>
        fetchApi<unknown>('/api/menu/items', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: unknown) =>
        fetchApi<unknown>(`/api/menu/items/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        fetchApi<void>(`/api/menu/items/${id}`, { method: 'DELETE' }),

      // Modifiers for an item
      getModifiers: (id: string) =>
        fetchApi<unknown>(`/api/menu/items/${id}/modifiers`),

      updateModifiers: (id: string, data: unknown) =>
        fetchApi<unknown>(`/api/menu/items/${id}/modifiers`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),

      // Recipe for cocktails
      updateRecipe: (id: string, data: unknown) =>
        fetchApi<unknown>(`/api/menu/items/${id}/recipe`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
    },

    // Modifier Groups
    modifiers: {
      list: () => fetchApi<unknown[]>('/api/menu/modifiers'),

      get: (id: string) => fetchApi<unknown>(`/api/menu/modifiers/${id}`),

      create: (data: unknown) =>
        fetchApi<unknown>('/api/menu/modifiers', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: unknown) =>
        fetchApi<unknown>(`/api/menu/modifiers/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        fetchApi<void>(`/api/menu/modifiers/${id}`, { method: 'DELETE' }),
    },
  },

  // ==========================================
  // Combos
  // ==========================================
  combos: {
    get: (id: string) => fetchApi<unknown>(`/api/combos/${id}`),
  },

  // ==========================================
  // Tables
  // ==========================================
  tables: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/tables${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/tables/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/tables', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/tables/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchApi<void>(`/api/tables/${id}`, { method: 'DELETE' }),

    // Seats
    seats: {
      list: (tableId: string) =>
        fetchApi<unknown[]>(`/api/tables/${tableId}/seats`),

      update: (tableId: string, seatId: string, data: unknown) =>
        fetchApi<unknown>(`/api/tables/${tableId}/seats/${seatId}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),

      delete: (tableId: string, seatId: string) =>
        fetchApi<void>(`/api/tables/${tableId}/seats/${seatId}`, {
          method: 'DELETE',
        }),

      autoGenerate: (tableId: string, data: unknown) =>
        fetchApi<unknown>(`/api/tables/${tableId}/seats/auto-generate`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
    },
  },

  // ==========================================
  // Sections
  // ==========================================
  sections: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/sections${buildQueryString(params)}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/sections', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/sections/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchApi<void>(`/api/sections/${id}`, { method: 'DELETE' }),
  },

  // ==========================================
  // Shifts
  // ==========================================
  shifts: {
    get: (id: string) => fetchApi<unknown>(`/api/shifts/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/shifts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/shifts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  // ==========================================
  // Time Clock
  // ==========================================
  timeClock: {
    get: (params: { employeeId: string; locationId?: string }) =>
      fetchApi<unknown>(`/api/time-clock${buildQueryString(params)}`),

    clockIn: (data: unknown) =>
      fetchApi<unknown>('/api/time-clock', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    clockOut: (data: unknown) =>
      fetchApi<unknown>('/api/time-clock', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    startBreak: (data: Record<string, unknown>) =>
      fetchApi<unknown>('/api/time-clock', {
        method: 'PATCH',
        body: JSON.stringify({ ...data, action: 'startBreak' }),
      }),

    endBreak: (data: Record<string, unknown>) =>
      fetchApi<unknown>('/api/time-clock', {
        method: 'PATCH',
        body: JSON.stringify({ ...data, action: 'endBreak' }),
      }),
  },

  // ==========================================
  // KDS (Kitchen Display System)
  // ==========================================
  kds: {
    list: (params: { locationId: string; stationId?: string }) =>
      fetchApi<unknown[]>(`/api/kds${buildQueryString(params)}`),

    bump: (data: { orderItemId: string; stationId?: string }) =>
      fetchApi<unknown>('/api/kds', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    recall: (data: { orderItemId: string }) =>
      fetchApi<unknown>('/api/kds', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    prioritize: (data: { orderItemId: string; priority: number }) =>
      fetchApi<unknown>('/api/kds', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },

  // ==========================================
  // Prep Stations
  // ==========================================
  prepStations: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/prep-stations${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/prep-stations/${id}`),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/prep-stations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  // ==========================================
  // Entertainment
  // ==========================================
  entertainment: {
    // Block time
    getBlockTime: (orderItemId: string) =>
      fetchApi<unknown>(`/api/entertainment/block-time?orderItemId=${orderItemId}`),

    startBlockTime: (data: unknown) =>
      fetchApi<unknown>('/api/entertainment/block-time', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    stopBlockTime: (orderItemId: string) =>
      fetchApi<unknown>(`/api/entertainment/block-time?orderItemId=${orderItemId}`, {
        method: 'DELETE',
      }),

    extendBlockTime: (data: unknown) =>
      fetchApi<unknown>('/api/entertainment/block-time', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // Status
    updateStatus: (data: unknown) =>
      fetchApi<unknown>('/api/entertainment/status', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    // Waitlist
    addToWaitlist: (data: unknown) =>
      fetchApi<unknown>('/api/entertainment/waitlist', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateWaitlistEntry: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/entertainment/waitlist/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    removeFromWaitlist: (id: string) =>
      fetchApi<void>(`/api/entertainment/waitlist/${id}`, {
        method: 'DELETE',
      }),
  },

  // ==========================================
  // Timed Sessions
  // ==========================================
  timedSessions: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/timed-sessions${buildQueryString(params)}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/timed-sessions', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    end: (id: string, data?: unknown) =>
      fetchApi<unknown>(`/api/timed-sessions/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data || {}),
      }),
  },

  // ==========================================
  // Tips
  // ==========================================
  tips: {
    // Tip-out rules
    rules: {
      list: (params: { locationId: string }) =>
        fetchApi<unknown[]>(`/api/tip-out-rules${buildQueryString(params)}`),

      create: (data: unknown) =>
        fetchApi<unknown>('/api/tip-out-rules', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: unknown) =>
        fetchApi<unknown>(`/api/tip-out-rules/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        fetchApi<void>(`/api/tip-out-rules/${id}`, { method: 'DELETE' }),
    },
  },

  // ==========================================
  // Gift Cards
  // ==========================================
  giftCards: {
    list: (params: { locationId: string; status?: string }) =>
      fetchApi<unknown[]>(`/api/gift-cards${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/gift-cards/${id}`),

    getByNumber: (cardNumber: string) =>
      fetchApi<unknown>(`/api/gift-cards/${cardNumber}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/gift-cards', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/gift-cards/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    reload: (id: string, data: { amount: number }) =>
      fetchApi<unknown>(`/api/gift-cards/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },

  // ==========================================
  // House Accounts
  // ==========================================
  houseAccounts: {
    list: (params: { locationId: string; status?: string; search?: string }) =>
      fetchApi<unknown[]>(`/api/house-accounts${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/house-accounts/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/house-accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/house-accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    recordPayment: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/house-accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },

  // ==========================================
  // Coupons
  // ==========================================
  coupons: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/coupons${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/coupons/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/coupons', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/coupons/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchApi<void>(`/api/coupons/${id}`, { method: 'DELETE' }),
  },

  // ==========================================
  // Discounts
  // ==========================================
  discounts: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/discounts${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/discounts/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/discounts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/discounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchApi<void>(`/api/discounts/${id}`, { method: 'DELETE' }),
  },

  // ==========================================
  // Tax Rules
  // ==========================================
  taxRules: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/tax-rules${buildQueryString(params)}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/tax-rules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/tax-rules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchApi<void>(`/api/tax-rules/${id}`, { method: 'DELETE' }),
  },

  // ==========================================
  // Inventory
  // ==========================================
  inventory: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/inventory${buildQueryString(params)}`),

    update: (data: unknown) =>
      fetchApi<unknown>('/api/inventory', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // ==========================================
  // Stock Alerts
  // ==========================================
  stockAlerts: {
    list: (params: { locationId: string }) =>
      fetchApi<unknown[]>(`/api/stock-alerts${buildQueryString(params)}`),

    acknowledge: (data: { alertIds: string[] }) =>
      fetchApi<unknown>('/api/stock-alerts', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  // ==========================================
  // Reservations
  // ==========================================
  reservations: {
    list: (params: { locationId: string; date?: string; status?: string }) =>
      fetchApi<unknown[]>(`/api/reservations${buildQueryString(params)}`),

    get: (id: string) => fetchApi<unknown>(`/api/reservations/${id}`),

    create: (data: unknown) =>
      fetchApi<unknown>('/api/reservations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: unknown) =>
      fetchApi<unknown>(`/api/reservations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchApi<void>(`/api/reservations/${id}`, { method: 'DELETE' }),
  },

  // ==========================================
  // Liquor Builder
  // ==========================================
  liquor: {
    categories: {
      list: () => fetchApi<unknown[]>('/api/liquor/categories'),

      create: (data: unknown) =>
        fetchApi<unknown>('/api/liquor/categories', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: unknown) =>
        fetchApi<unknown>(`/api/liquor/categories/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        fetchApi<void>(`/api/liquor/categories/${id}`, { method: 'DELETE' }),
    },

    bottles: {
      list: () => fetchApi<unknown[]>('/api/liquor/bottles'),

      create: (data: unknown) =>
        fetchApi<unknown>('/api/liquor/bottles', {
          method: 'POST',
          body: JSON.stringify(data),
        }),

      update: (id: string, data: unknown) =>
        fetchApi<unknown>(`/api/liquor/bottles/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),

      delete: (id: string) =>
        fetchApi<void>(`/api/liquor/bottles/${id}`, { method: 'DELETE' }),
    },

    recipes: {
      list: () => fetchApi<unknown[]>('/api/liquor/recipes'),
    },
  },

  // ==========================================
  // Reports
  // ==========================================
  reports: {
    sales: (params: { locationId: string; startDate: string; endDate: string }) =>
      fetchApi<unknown>(`/api/reports/sales${buildQueryString(params)}`),

    tips: (params: { locationId: string; startDate: string; endDate: string; employeeId?: string }) =>
      fetchApi<unknown>(`/api/reports/tips${buildQueryString(params)}`),

    commission: (params: { locationId: string; startDate: string; endDate: string }) =>
      fetchApi<unknown>(`/api/reports/commission${buildQueryString(params)}`),

    voids: (params: { locationId: string; startDate: string; endDate: string; employeeId?: string }) =>
      fetchApi<unknown>(`/api/reports/voids${buildQueryString(params)}`),

    orderHistory: (params: { locationId: string; startDate: string; endDate: string; page?: number }) =>
      fetchApi<unknown>(`/api/reports/order-history${buildQueryString(params)}`),

    liquor: (params: { locationId: string; startDate: string; endDate: string }) =>
      fetchApi<unknown>(`/api/reports/liquor${buildQueryString(params)}`),

    reservations: (params: { locationId: string; startDate: string; endDate: string }) =>
      fetchApi<unknown>(`/api/reports/reservations${buildQueryString(params)}`),
  },
}

// Export type for the API client
export type ApiClient = typeof api
