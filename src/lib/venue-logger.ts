/**
 * Venue Logger
 *
 * Lightweight helper for writing diagnostic log entries to the VenueLog table.
 * Designed for fire-and-forget usage from API routes, workers, and services.
 *
 * Usage:
 *   import { logVenueEvent } from '@/lib/venue-logger'
 *
 *   void logVenueEvent({
 *     level: 'error',
 *     source: 'server',
 *     category: 'payment',
 *     message: 'Card declined during tab close',
 *     details: { orderId, amount },
 *   }).catch((err) => log.error({ err }, 'logVenueEvent failed'))
 */

import { db } from './db'
import { getLocationId } from './location-cache'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('venue-logger')

export type VenueLogLevel = 'info' | 'warn' | 'error' | 'critical'
export type VenueLogSource = 'server' | 'pos' | 'kds' | 'android' | 'sync' | 'pax'
export type VenueLogCategory = 'payment' | 'sync' | 'hardware' | 'auth' | 'order' | 'system'

export interface VenueLogEntry {
  level: VenueLogLevel
  source: VenueLogSource
  category: VenueLogCategory
  message: string
  details?: Record<string, unknown>
  employeeId?: string
  deviceId?: string
  stackTrace?: string
  /** Override locationId (default: auto-resolved from request context) */
  locationId?: string
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Write a single log entry to the VenueLog table.
 * Fire-and-forget safe — callers should use:
 *   void logVenueEvent({ ... }).catch((err) => log.error({ err }, 'logVenueEvent failed'))
 */
export async function logVenueEvent(entry: VenueLogEntry): Promise<void> {
  try {
    const locationId = entry.locationId || await getLocationId()
    if (!locationId) {
      log.warn('[venue-logger] No locationId available, skipping log entry')
      return
    }

    // Sanitize: strip any sensitive-looking keys from details
    const sanitizedDetails = entry.details ? sanitizeDetails(entry.details) : undefined

    await db.$executeRawUnsafe(
      `INSERT INTO "VenueLog" ("id", "locationId", "level", "source", "category", "message", "details", "employeeId", "deviceId", "stackTrace", "createdAt", "expiresAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW(), NOW() + INTERVAL '30 days')`,
      locationId,
      entry.level,
      entry.source,
      entry.category,
      entry.message.slice(0, 2000), // Cap message length
      sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
      entry.employeeId || null,
      entry.deviceId || null,
      entry.stackTrace?.slice(0, 10000) || null
    )

    // Notify diagnostics UI via socket (fire-and-forget, dynamic import to avoid circular deps)
    void import('./socket-dispatch').then(({ dispatchVenueLogNew }) =>
      dispatchVenueLogNew(locationId, {
        level: entry.level,
        source: entry.source,
        category: entry.category,
      })
    ).catch(err => log.warn({ err }, 'fire-and-forget failed in venue-logger'))
  } catch (err) {
    // Never throw from the logger — log to console as last resort
    log.error({ err: err }, '[venue-logger] Failed to write log entry:')
  }
}

/**
 * Write multiple log entries in a single transaction.
 * Used by the batch ingestion API endpoint.
 */
export async function logVenueEventsBatch(
  entries: VenueLogEntry[],
  defaultLocationId?: string
): Promise<{ written: number; errors: number }> {
  let written = 0
  let errors = 0

  const locationId = defaultLocationId || await getLocationId()
  if (!locationId) {
    log.warn('[venue-logger] No locationId for batch, skipping')
    return { written: 0, errors: entries.length }
  }

  // Build batch insert values — up to 100 entries per batch
  const batchSize = 100
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize)
    try {
      const values: unknown[] = []
      const placeholders: string[] = []
      let paramIdx = 1

      for (const entry of batch) {
        const sanitized = entry.details ? sanitizeDetails(entry.details) : null
        placeholders.push(
          `(gen_random_uuid()::text, $${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}::jsonb, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, NOW(), NOW() + INTERVAL '30 days')`
        )
        values.push(
          entry.locationId || locationId,
          entry.level || 'info',
          entry.source || 'server',
          entry.category || 'system',
          (entry.message || '').slice(0, 2000),
          sanitized ? JSON.stringify(sanitized) : null,
          entry.employeeId || null,
          entry.deviceId || null,
          entry.stackTrace?.slice(0, 10000) || null
        )
        paramIdx += 9
      }

      await db.$executeRawUnsafe(
        `INSERT INTO "VenueLog" ("id", "locationId", "level", "source", "category", "message", "details", "employeeId", "deviceId", "stackTrace", "createdAt", "expiresAt")
         VALUES ${placeholders.join(', ')}`,
        ...values
      )
      written += batch.length
    } catch (err) {
      log.error({ err: err }, '[venue-logger] Batch insert failed:')
      errors += batch.length
    }
  }

  return { written, errors }
}

/**
 * Delete expired log entries. Called on a schedule or opportunistically.
 * Returns the count of deleted rows.
 */
export async function cleanupExpiredLogs(): Promise<number> {
  try {
    const result = await db.$executeRawUnsafe(
      `DELETE FROM "VenueLog" WHERE "expiresAt" < NOW()`
    )
    return typeof result === 'number' ? result : 0
  } catch (err) {
    log.error({ err: err }, '[venue-logger] Cleanup failed:')
    return 0
  }
}

// ============================================
// PRIVATE HELPERS
// ============================================

const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'cardNumber', 'cvv', 'pan',
  'ssn', 'pin', 'authToken', 'accessToken', 'refreshToken',
  'apiKey', 'privateKey', 'encryptionKey', 'creditCard',
  'accountNumber', 'routingNumber',
])

function sanitizeDetails(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]'
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeDetails(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}
