/**
 * Entertainment Domain — Pure Validation Functions
 *
 * All functions here are pure (no DB, no side effects).
 * They return error messages (string) or null if valid.
 */

// ─── Block Time Request Validation ───────────────────────────────────────────

/**
 * Validate that a block time start request has all required fields.
 * Returns an error string if invalid, null if valid.
 */
export function validateStartRequest(input: {
  orderItemId?: string | null
  locationId?: string | null
  minutes?: number | null
}): string | null {
  if (!input.orderItemId) return 'Order item ID is required'
  if (!input.locationId) return 'Location ID is required'
  if (!input.minutes || input.minutes < 1) return 'Minutes must be a positive number'
  return null
}

/**
 * Validate that the order item is eligible to start a session.
 */
export function validateSessionStart(input: {
  itemType: string | null
  orderStatus: string
  orderLocationId: string
  requestLocationId: string
}): string | null {
  if (input.orderLocationId !== input.requestLocationId) return 'Location ID mismatch'
  if (input.itemType !== 'timed_rental') return 'This item is not an entertainment rental'
  if (input.orderStatus === 'paid' || input.orderStatus === 'closed') return 'Cannot modify a paid or closed order'
  return null
}

// ─── Extension Validation ────────────────────────────────────────────────────

/**
 * Validate that an extension request has all required fields.
 */
export function validateExtendRequest(input: {
  orderItemId?: string | null
  locationId?: string | null
  additionalMinutes?: number | null
}): string | null {
  if (!input.orderItemId) return 'Order item ID is required'
  if (!input.locationId) return 'Location ID is required'
  if (!input.additionalMinutes || input.additionalMinutes < 1) return 'Additional minutes must be a positive number'
  return null
}

/**
 * Validate that the order item is eligible for extension.
 */
export function validateExtension(input: {
  orderLocationId: string
  requestLocationId: string
  orderStatus: string
  hasActiveBlockTime: boolean
}): string | null {
  if (input.orderLocationId !== input.requestLocationId) return 'Location ID mismatch'
  if (input.orderStatus === 'paid' || input.orderStatus === 'closed') return 'Cannot modify a paid or closed order'
  if (!input.hasActiveBlockTime) return 'This item does not have active block time'
  return null
}

// ─── Time Override Validation ────────────────────────────────────────────────

/**
 * Validate a manager time override request.
 */
export function validateTimeOverrideRequest(input: {
  orderItemId?: string | null
  locationId?: string | null
  newExpiresAt?: string | null
}): string | null {
  if (!input.orderItemId) return 'Order item ID is required'
  if (!input.locationId) return 'Location ID is required'
  if (!input.newExpiresAt) return 'New expiration time is required'
  return null
}

/**
 * Validate that the order item is eligible for a time override.
 */
export function validateTimeOverride(input: {
  orderLocationId: string
  requestLocationId: string
  orderStatus: string
  hasStartedAt: boolean
  parsedExpiresAt: Date
}): string | null {
  if (input.orderLocationId !== input.requestLocationId) return 'Location ID mismatch'
  if (input.orderStatus === 'paid' || input.orderStatus === 'closed') return 'Cannot modify a paid or closed order'
  if (!input.hasStartedAt) return 'This item does not have active block time'
  if (isNaN(input.parsedExpiresAt.getTime())) return 'Invalid expiration time format'
  return null
}

// ─── Stop Session Validation ─────────────────────────────────────────────────

/**
 * Validate a stop session request.
 */
export function validateStopRequest(input: {
  orderItemId?: string | null
  locationId?: string | null
}): string | null {
  if (!input.orderItemId) return 'Order item ID is required'
  if (!input.locationId) return 'Location ID is required'
  return null
}

/**
 * Validate that the order item's location matches.
 */
export function validateStopSession(input: {
  orderLocationId: string
  requestLocationId: string
}): string | null {
  if (input.orderLocationId !== input.requestLocationId) return 'Location ID mismatch'
  return null
}

// ─── Waitlist ────────────────────────────────────────────────────────────────

/**
 * Format a wait time duration in minutes into a human-readable string.
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
 * Calculate wait time in minutes from a requestedAt timestamp.
 */
export function calculateWaitMinutes(requestedAt: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - requestedAt.getTime()) / 1000 / 60)
}

// ─── Session Time Helpers ────────────────────────────────────────────────────

/**
 * Check whether a session has expired.
 */
export function isSessionExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false
  return now >= expiresAt
}

/**
 * Calculate minutes remaining in a session.
 */
export function calculateMinutesRemaining(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60))
}

/**
 * Calculate minutes elapsed since session started.
 */
export function calculateMinutesElapsed(startedAt: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - startedAt.getTime()) / 1000 / 60)
}

/**
 * Check whether a session is expiring soon (within 10 minutes).
 */
export function isExpiringSoon(expiresAt: Date, now: Date = new Date(), thresholdMinutes: number = 10): boolean {
  const remaining = calculateMinutesRemaining(expiresAt, now)
  return remaining > 0 && remaining <= thresholdMinutes
}

// ─── Status Validation ───────────────────────────────────────────────────────

const VALID_ENTERTAINMENT_STATUSES = ['available', 'in_use', 'reserved', 'maintenance'] as const
export type EntertainmentStatus = (typeof VALID_ENTERTAINMENT_STATUSES)[number]

/**
 * Validate an entertainment status string.
 */
export function validateEntertainmentStatus(status: string): status is EntertainmentStatus {
  return (VALID_ENTERTAINMENT_STATUSES as readonly string[]).includes(status)
}

const VALID_WAITLIST_STATUSES = ['waiting', 'notified', 'seated', 'cancelled', 'expired'] as const

/**
 * Validate a waitlist status string.
 */
export function validateWaitlistStatus(status: string): boolean {
  return (VALID_WAITLIST_STATUSES as readonly string[]).includes(status)
}
