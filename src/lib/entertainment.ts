// Entertainment utility functions for timer calculations and status helpers

/**
 * Pad a number with leading zero
 */
export function pad(num: number): string {
  return num.toString().padStart(2, '0')
}

/**
 * Calculate time remaining until expiration (for block time)
 */
export function calculateTimeRemaining(expiresAt: Date | string): {
  formatted: string
  totalSeconds: number
  isExpired: boolean
  isExpiringSoon: boolean
  urgencyLevel: 'normal' | 'warning' | 'critical' | 'expired'
} {
  const expires = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  const now = new Date()
  const diff = expires.getTime() - now.getTime()

  if (diff <= 0) {
    return {
      formatted: 'EXPIRED',
      totalSeconds: 0,
      isExpired: true,
      isExpiringSoon: false,
      urgencyLevel: 'expired',
    }
  }

  const totalSeconds = Math.floor(diff / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  let formatted: string
  if (hours > 0) {
    formatted = `${hours}:${pad(minutes)}:${pad(seconds)}`
  } else {
    formatted = `${minutes}:${pad(seconds)}`
  }

  // Determine urgency level
  const minutesRemaining = totalSeconds / 60
  let urgencyLevel: 'normal' | 'warning' | 'critical' | 'expired' = 'normal'
  if (minutesRemaining <= 5) {
    urgencyLevel = 'critical'
  } else if (minutesRemaining <= 10) {
    urgencyLevel = 'warning'
  }

  return {
    formatted,
    totalSeconds,
    isExpired: false,
    isExpiringSoon: minutesRemaining <= 10,
    urgencyLevel,
  }
}

/**
 * Calculate elapsed time since start (for per-minute billing)
 */
export function calculateElapsedTime(startedAt: Date | string): {
  formatted: string
  totalMinutes: number
  totalSeconds: number
} {
  const started = typeof startedAt === 'string' ? new Date(startedAt) : startedAt
  const now = new Date()
  const diff = now.getTime() - started.getTime()

  const totalSeconds = Math.floor(diff / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  let formatted: string
  if (hours > 0) {
    formatted = `${hours}:${pad(minutes)}:${pad(seconds)}`
  } else {
    formatted = `${minutes}:${pad(seconds)}`
  }

  return {
    formatted,
    totalMinutes,
    totalSeconds,
  }
}

/**
 * Format wait time for display
 */
export function formatWaitTime(minutes: number): string {
  if (minutes < 1) return 'Just now'
  if (minutes === 1) return '1 min'
  if (minutes < 60) return `${minutes} mins`

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  if (hours === 1 && mins === 0) return '1 hour'
  if (hours === 1) return `1 hr ${mins} min`
  if (mins === 0) return `${hours} hours`
  return `${hours} hrs ${mins} min`
}

/**
 * Get status color classes
 */
export function getStatusColors(status: string): {
  border: string
  background: string
  text: string
  dot: string
} {
  switch (status) {
    case 'available':
      return {
        border: 'border-green-500',
        background: 'bg-green-50',
        text: 'text-green-700',
        dot: 'bg-green-500',
      }
    case 'in_use':
      return {
        border: 'border-red-500',
        background: 'bg-red-50',
        text: 'text-red-700',
        dot: 'bg-red-500',
      }
    case 'maintenance':
      return {
        border: 'border-gray-400',
        background: 'bg-gray-100',
        text: 'text-gray-600',
        dot: 'bg-gray-400',
      }
    default:
      return {
        border: 'border-gray-300',
        background: 'bg-white',
        text: 'text-gray-700',
        dot: 'bg-gray-400',
      }
  }
}

/**
 * Get urgency color classes for timers
 */
export function getUrgencyColors(level: 'normal' | 'warning' | 'critical' | 'expired'): {
  text: string
  background: string
  border: string
  animation?: string
} {
  switch (level) {
    case 'expired':
      return {
        text: 'text-red-600',
        background: 'bg-red-100',
        border: 'border-red-500',
        animation: 'animate-pulse',
      }
    case 'critical':
      return {
        text: 'text-orange-600',
        background: 'bg-orange-100',
        border: 'border-orange-500',
        animation: 'animate-pulse',
      }
    case 'warning':
      return {
        text: 'text-yellow-600',
        background: 'bg-yellow-50',
        border: 'border-yellow-500',
      }
    default:
      return {
        text: 'text-gray-900',
        background: 'bg-white',
        border: 'border-gray-300',
      }
  }
}

/**
 * Entertainment item interface
 */
export interface EntertainmentItem {
  id: string
  name: string
  displayName: string
  description: string | null
  category: { id: string; name: string }
  status: 'available' | 'in_use' | 'maintenance'
  currentOrder: {
    orderId: string
    orderItemId: string | null
    tabName: string
    orderNumber: number
    displayNumber: string | null
  } | null
  // Also track this at the item level for easier access
  currentOrderItemId?: string | null
  timeInfo: {
    type: 'block' | 'per_minute'
    blockMinutes?: number
    startedAt?: string
    expiresAt?: string
    minutesRemaining?: number
    minutesElapsed?: number
    isExpired?: boolean
    isExpiringSoon?: boolean
  } | null
  waitlistCount: number
  waitlist: WaitlistEntry[]
  price: number
  timedPricing: {
    per15Min?: number
    per30Min?: number
    perHour?: number
    minimum?: number
  } | null
  blockTimeMinutes: number | null
  minimumMinutes: number | null
  maxConcurrentUses: number
  currentUseCount: number
}

export interface WaitlistEntry {
  id: string
  customerName: string
  phoneNumber: string | null
  partySize: number
  position: number
  createdAt: string
  waitMinutes: number
  notes?: string | null
  status?: string
  menuItem?: {
    id: string
    name: string
    status?: string
  }
  menuItemId?: string
  // Tab linking
  tabId?: string | null
  tabName?: string | null
  // Deposit info
  depositAmount?: number | null
  depositMethod?: string | null
  depositCardLast4?: string | null
  depositRefunded?: boolean
}
