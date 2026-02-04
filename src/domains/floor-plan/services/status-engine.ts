/**
 * Status Engine - L7 Status State Machine
 *
 * Manages the 15-status state machine for tables.
 * Handles automatic transitions based on events.
 */

import type { TableStatus, StatusTransition, StatusTrigger } from '../types'
import { TABLE_STATUSES } from '../index'

/**
 * Valid status transitions
 */
const STATUS_TRANSITIONS: StatusTransition[] = [
  // Available -> Seating (guest arrival)
  { from: 'available', to: 'seating', trigger: 'guest_seated', automatic: false },
  { from: 'available', to: 'reserved', trigger: 'manual', automatic: false },

  // Seating -> Occupied (seated)
  { from: 'seating', to: 'occupied', trigger: 'guest_seated', automatic: true, timeoutMinutes: 2 },

  // Occupied -> Ordering
  { from: 'occupied', to: 'ordering', trigger: 'order_created', automatic: true },

  // Ordering -> Food Pending (order sent)
  { from: 'ordering', to: 'food_pending', trigger: 'order_sent', automatic: true },

  // Food Pending -> Food Served
  { from: 'food_pending', to: 'food_served', trigger: 'food_delivered', automatic: true },

  // Food Served -> Dessert (optional)
  { from: 'food_served', to: 'dessert', trigger: 'manual', automatic: false },

  // Any dining state -> Check Requested
  { from: 'occupied', to: 'check_requested', trigger: 'check_requested', automatic: false },
  { from: 'ordering', to: 'check_requested', trigger: 'check_requested', automatic: false },
  { from: 'food_pending', to: 'check_requested', trigger: 'check_requested', automatic: false },
  { from: 'food_served', to: 'check_requested', trigger: 'check_requested', automatic: false },
  { from: 'dessert', to: 'check_requested', trigger: 'check_requested', automatic: false },

  // Check Requested -> Check Dropped
  { from: 'check_requested', to: 'check_dropped', trigger: 'check_printed', automatic: true },

  // Check Dropped -> Paid
  { from: 'check_dropped', to: 'paid', trigger: 'payment_complete', automatic: true },

  // Paid -> Dirty
  { from: 'paid', to: 'dirty', trigger: 'manual', automatic: false, timeoutMinutes: 5 },

  // Dirty -> Bussing
  { from: 'dirty', to: 'bussing', trigger: 'manual', automatic: false },

  // Bussing -> Available
  { from: 'bussing', to: 'available', trigger: 'table_cleared', automatic: true },
  { from: 'dirty', to: 'available', trigger: 'table_cleared', automatic: true },

  // Reserved -> Seating (party arrives)
  { from: 'reserved', to: 'seating', trigger: 'guest_seated', automatic: false },

  // Blocked can go to available
  { from: 'blocked', to: 'available', trigger: 'manual', automatic: false },
]

/**
 * Check if a status transition is valid
 */
export function isValidTransition(from: TableStatus, to: TableStatus): boolean {
  return STATUS_TRANSITIONS.some(t => t.from === from && t.to === to)
}

/**
 * Get all valid next statuses from current status
 */
export function getValidNextStatuses(current: TableStatus): TableStatus[] {
  const transitions = STATUS_TRANSITIONS.filter(t => t.from === current)
  return [...new Set(transitions.map(t => t.to))]
}

/**
 * Get the expected next status for a trigger
 */
export function getNextStatusForTrigger(
  current: TableStatus,
  trigger: StatusTrigger
): TableStatus | null {
  const transition = STATUS_TRANSITIONS.find(
    t => t.from === current && t.trigger === trigger
  )
  return transition?.to || null
}

/**
 * Check if a transition should happen automatically
 */
export function isAutomaticTransition(from: TableStatus, to: TableStatus): boolean {
  const transition = STATUS_TRANSITIONS.find(t => t.from === from && t.to === to)
  return transition?.automatic || false
}

/**
 * Get timeout for automatic transition (if any)
 */
export function getTransitionTimeout(from: TableStatus, to: TableStatus): number | null {
  const transition = STATUS_TRANSITIONS.find(t => t.from === from && t.to === to)
  return transition?.timeoutMinutes || null
}

/**
 * Get status display info (color, label)
 */
export function getStatusDisplay(status: TableStatus): {
  label: string
  color: string
  bgColor: string
  textColor: string
} {
  const statusDisplays: Record<TableStatus, {
    label: string
    color: string
    bgColor: string
    textColor: string
  }> = {
    available: {
      label: 'Available',
      color: '#22c55e',
      bgColor: 'bg-green-500',
      textColor: 'text-white',
    },
    seating: {
      label: 'Seating',
      color: '#eab308',
      bgColor: 'bg-yellow-500',
      textColor: 'text-black',
    },
    occupied: {
      label: 'Occupied',
      color: '#3b82f6',
      bgColor: 'bg-blue-500',
      textColor: 'text-white',
    },
    ordering: {
      label: 'Ordering',
      color: '#8b5cf6',
      bgColor: 'bg-violet-500',
      textColor: 'text-white',
    },
    food_pending: {
      label: 'Food Pending',
      color: '#f97316',
      bgColor: 'bg-orange-500',
      textColor: 'text-white',
    },
    food_served: {
      label: 'Food Served',
      color: '#06b6d4',
      bgColor: 'bg-cyan-500',
      textColor: 'text-white',
    },
    dessert: {
      label: 'Dessert',
      color: '#ec4899',
      bgColor: 'bg-pink-500',
      textColor: 'text-white',
    },
    check_requested: {
      label: 'Check Requested',
      color: '#f59e0b',
      bgColor: 'bg-amber-500',
      textColor: 'text-black',
    },
    check_dropped: {
      label: 'Check Dropped',
      color: '#84cc16',
      bgColor: 'bg-lime-500',
      textColor: 'text-black',
    },
    paid: {
      label: 'Paid',
      color: '#10b981',
      bgColor: 'bg-emerald-500',
      textColor: 'text-white',
    },
    dirty: {
      label: 'Dirty',
      color: '#ef4444',
      bgColor: 'bg-red-500',
      textColor: 'text-white',
    },
    bussing: {
      label: 'Bussing',
      color: '#f97316',
      bgColor: 'bg-orange-500',
      textColor: 'text-white',
    },
    reserved: {
      label: 'Reserved',
      color: '#a855f7',
      bgColor: 'bg-purple-500',
      textColor: 'text-white',
    },
    blocked: {
      label: 'Blocked',
      color: '#6b7280',
      bgColor: 'bg-gray-500',
      textColor: 'text-white',
    },
    combined: {
      label: 'Combined',
      color: '#14b8a6',
      bgColor: 'bg-teal-500',
      textColor: 'text-white',
    },
  }

  return statusDisplays[status] || statusDisplays.available
}

/**
 * Check if a table is in a "dining" state (occupied with guests)
 */
export function isDiningState(status: TableStatus): boolean {
  const diningStates: TableStatus[] = [
    'occupied',
    'ordering',
    'food_pending',
    'food_served',
    'dessert',
    'check_requested',
    'check_dropped',
  ]
  return diningStates.includes(status)
}

/**
 * Check if a table can accept new guests
 */
export function canSeatGuests(status: TableStatus): boolean {
  return status === 'available' || status === 'reserved'
}

/**
 * Check if a table needs attention (for alerts)
 */
export function needsAttention(status: TableStatus): boolean {
  return status === 'check_requested' || status === 'dirty'
}
