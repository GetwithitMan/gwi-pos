/**
 * Notification Device v1 State Machine
 *
 * Enforces valid state transitions for pager/notification device lifecycle.
 * Source of truth: NOTIFICATION-PLATFORM-BLUEPRINT.md Section 3.4
 *
 * Valid transitions:
 *   available → assigned
 *   assigned → released
 *   released → returned_pending
 *   returned_pending → available (physical confirmation only)
 *   assigned → missing
 *   missing → available (manual "found" action only)
 *   any → disabled
 *   any → retired
 *
 * Invalid transitions:
 *   missing → assigned
 *   retired → anything
 *   available → released
 *   released → assigned (must go through available)
 */

export type DeviceStatus =
  | 'available'
  | 'assigned'
  | 'released'
  | 'returned_pending'
  | 'missing'
  | 'disabled'
  | 'retired'

/**
 * Map of (currentStatus) → Set of valid next statuses.
 * `disabled` and `retired` are reachable from any non-retired state (added dynamically).
 */
const TRANSITIONS: Record<DeviceStatus, Set<DeviceStatus>> = {
  available: new Set(['assigned', 'disabled', 'retired']),
  assigned: new Set(['released', 'missing', 'disabled', 'retired']),
  released: new Set(['returned_pending', 'disabled', 'retired']),
  returned_pending: new Set(['available', 'disabled', 'retired']),
  missing: new Set(['available', 'disabled', 'retired']),
  disabled: new Set(['available', 'retired']),
  retired: new Set([]), // terminal state — no transitions out
}

export interface TransitionResult {
  valid: boolean
  error?: string
}

/**
 * Validate whether a device status transition is allowed.
 */
export function validateDeviceTransition(
  current: DeviceStatus,
  next: DeviceStatus
): TransitionResult {
  if (current === next) {
    return { valid: true } // no-op transitions are idempotent
  }

  const allowed = TRANSITIONS[current]
  if (!allowed) {
    return { valid: false, error: `Unknown device status: ${current}` }
  }

  if (!allowed.has(next)) {
    return {
      valid: false,
      error: `Invalid device transition: ${current} → ${next}. Allowed: [${[...allowed].join(', ')}]`,
    }
  }

  return { valid: true }
}

/**
 * Map a device status change to the appropriate event type for NotificationDeviceEvent.
 */
export function statusChangeToEventType(
  from: DeviceStatus,
  to: DeviceStatus
): string {
  if (to === 'assigned') return 'assigned'
  if (to === 'released') return 'released'
  if (to === 'returned_pending') return 'returned'
  if (to === 'available' && from === 'missing') return 'found'
  if (to === 'available' && from === 'returned_pending') return 'returned'
  if (to === 'available' && from === 'disabled') return 'maintenance_end'
  if (to === 'missing') return 'marked_lost'
  if (to === 'disabled') return 'maintenance_start'
  if (to === 'retired') return 'retired'
  return 'force_override'
}

/**
 * Target type family grouping for primary assignment rules.
 * At most one active primary per family per subject.
 */
export const TARGET_TYPE_FAMILY: Record<string, string> = {
  guest_pager: 'pager',
  staff_pager: 'pager',
  phone_sms: 'phone',
  phone_voice: 'phone',
  order_screen: 'display',
  table_locator: 'location',
}

export function getTargetFamily(targetType: string): string {
  return TARGET_TYPE_FAMILY[targetType] || targetType
}
