/**
 * Advisory Lock Utilities for Reservation Slot Booking
 *
 * Uses PostgreSQL advisory locks (pg_advisory_xact_lock) to prevent
 * double-booking race conditions. Locks are tied to the transaction
 * and auto-release on commit/rollback.
 *
 * Key design: lock per 15-minute bucket, sorted ascending to prevent deadlocks.
 */

import type { PrismaClient } from '@prisma/client'

/**
 * Hash a string to a BigInt suitable for pg_advisory_xact_lock.
 * Uses largest prime < 2^63 to stay within PostgreSQL's bigint range.
 */
export function hashToLockKey(s: string): bigint {
  const MOD = BigInt('9223372036854775783')
  let hash = BigInt(0)
  const THIRTY_ONE = BigInt(31)
  for (const char of s) {
    hash = (hash * THIRTY_ONE + BigInt(char.charCodeAt(0))) % MOD
  }
  return hash
}

/**
 * Get all 15-minute bucket labels that overlap with a time slot.
 *
 * @param slotMinutes - Start time in minutes from midnight
 * @param durationMinutes - Duration in minutes
 * @param intervalMinutes - Bucket size (default 15)
 * @returns Array of "HH:MM" bucket labels
 *
 * Example: slot=420 (7:00), duration=90 → ["07:00", "07:15", "07:30", "07:45", "08:00", "08:15"]
 */
export function getOverlappingBuckets(
  slotMinutes: number,
  durationMinutes: number,
  intervalMinutes: number = 15
): string[] {
  const safeDuration = Math.min(durationMinutes, 1440) // Cap at 24 hours
  const buckets: string[] = []
  const startBucket = Math.floor(slotMinutes / intervalMinutes) * intervalMinutes
  const endMinutes = slotMinutes + safeDuration
  for (let b = startBucket; b < endMinutes; b += intervalMinutes) {
    const h = Math.floor(b / 60).toString().padStart(2, '0')
    const m = (b % 60).toString().padStart(2, '0')
    buckets.push(`${h}:${m}`)
  }
  return buckets
}

/**
 * Acquire advisory locks for all 15-minute buckets that a reservation
 * slot overlaps. MUST be called inside a Prisma interactive transaction.
 *
 * Locks are sorted ascending before acquisition to prevent deadlocks
 * when concurrent transactions lock overlapping ranges.
 *
 * @param tx - Prisma transaction client
 * @param locationId - Venue location ID
 * @param serviceDate - YYYY-MM-DD service date
 * @param slotMinutes - Slot start in minutes from midnight
 * @param durationMinutes - Slot duration in minutes
 */
export async function acquireReservationLocks(
  tx: PrismaClient,
  locationId: string,
  serviceDate: string,
  slotMinutes: number,
  durationMinutes: number
): Promise<void> {
  const startTime = Date.now()

  // CRITICAL: sort ascending to prevent deadlocks
  const buckets = getOverlappingBuckets(slotMinutes, durationMinutes, 15).sort()

  for (const bucket of buckets) {
    const lockKey = hashToLockKey(`${locationId}:${serviceDate}:${bucket}`)
    // Pass lock key as string and cast in SQL — Prisma's parameterized queries
    // may not handle BigInt natively across all adapters
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock($1::bigint)`,
      lockKey.toString()
    )
  }

  const elapsed = Date.now() - startTime
  if (elapsed > 300) {
    console.warn(JSON.stringify({
      event: 'advisory_lock_wait',
      duration_ms: elapsed,
      location_id: locationId,
      service_date: serviceDate,
      bucket: buckets.join(','),
      wait_threshold_exceeded: true,
    }))
  }
}
