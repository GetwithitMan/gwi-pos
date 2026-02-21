/**
 * Online Availability Utilities
 *
 * Pure utility functions for computing whether a menu item is orderable online.
 * No React, no DB — takes MenuItem data as input.
 */

interface OnlineAvailabilityInput {
  showOnline: boolean
  isAvailable: boolean
  availableFrom?: string | null  // "HH:mm"
  availableTo?: string | null    // "HH:mm"
  availableDays?: string | null  // "0,1,2,3,4,5,6" comma-separated, 0=Sunday
  currentStock?: number | null
  trackInventory?: boolean
  lowStockAlert?: number | null
}

/**
 * Compute whether a menu item is orderable online given its current state.
 *
 * @param item - The menu item availability fields
 * @param now  - Optional date override (defaults to new Date()). Useful for testing.
 * @returns true if the item can be ordered online right now, false otherwise
 */
export function computeIsOrderableOnline(item: OnlineAvailabilityInput, now?: Date): boolean {
  // 1. Must be visible online
  if (!item.showOnline) return false

  // 2. Must be marked available
  if (!item.isAvailable) return false

  // 3. If tracking inventory and stock is depleted → not orderable
  if (item.trackInventory && item.currentStock !== null && item.currentStock !== undefined && item.currentStock <= 0) {
    return false
  }

  const current = now ?? new Date()

  // 4. Check day-of-week restriction
  if (item.availableDays !== null && item.availableDays !== undefined && item.availableDays !== '') {
    const allowedDays = item.availableDays
      .split(',')
      .map(d => d.trim())
      .filter(d => d !== '')
      .map(Number)
    const currentDay = current.getDay() // 0 = Sunday
    if (!allowedDays.includes(currentDay)) return false
  }

  // 5. Check time-of-day window
  if (
    item.availableFrom !== null && item.availableFrom !== undefined && item.availableFrom !== '' &&
    item.availableTo !== null && item.availableTo !== undefined && item.availableTo !== ''
  ) {
    // Parse "HH:mm" strings into minutes-since-midnight
    const parseTime = (t: string): number => {
      const [h, m] = t.split(':').map(Number)
      return h * 60 + m
    }

    const fromMinutes = parseTime(item.availableFrom)
    const toMinutes = parseTime(item.availableTo)
    const nowMinutes = current.getHours() * 60 + current.getMinutes()

    if (fromMinutes <= toMinutes) {
      // Normal window, e.g. 09:00–22:00
      if (nowMinutes < fromMinutes || nowMinutes >= toMinutes) return false
    } else {
      // Overnight window, e.g. 22:00–04:00 → current time must be >= 22:00 OR < 04:00
      if (nowMinutes < fromMinutes && nowMinutes >= toMinutes) return false
    }
  }

  return true
}

/**
 * Compute a stock status label for a menu item.
 *
 * @returns 'out_of_stock' | 'low_stock' | 'in_stock'
 */
export function getStockStatus(item: {
  trackInventory: boolean
  currentStock: number | null
  lowStockAlert: number | null
  isAvailable: boolean
}): 'in_stock' | 'low_stock' | 'out_of_stock' {
  // Out of stock: unavailable OR inventory tracking says zero/negative
  if (
    !item.isAvailable ||
    (item.trackInventory && item.currentStock !== null && item.currentStock <= 0)
  ) {
    return 'out_of_stock'
  }

  // Low stock: tracking enabled, stock at or below alert threshold but above zero
  if (
    item.trackInventory &&
    item.currentStock !== null &&
    item.lowStockAlert !== null &&
    item.currentStock <= item.lowStockAlert &&
    item.currentStock > 0
  ) {
    return 'low_stock'
  }

  return 'in_stock'
}
