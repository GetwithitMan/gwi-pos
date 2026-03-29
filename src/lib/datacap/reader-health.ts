// Datacap Direct API — Per-Reader Health Tracking
// In-memory state machine tracking reader health per process,
// backed by database persistence for survival across restarts.
// Readers are marked degraded when EMVPadReset fails after a transaction,
// which indicates the reader may be stuck and needs operator attention.

import { db } from '@/lib/db'

export type ReaderHealthStatus = 'healthy' | 'degraded'

export interface ReaderHealth {
  status: ReaderHealthStatus
  updatedAt: Date
  reason?: string
}

const healthMap = new Map<string, ReaderHealth>()

/**
 * Restore reader health from the database on first access.
 * If PaymentReader has a recent lastError + lastErrorAt, treat as degraded.
 */
async function restoreFromDb(readerId: string): Promise<ReaderHealth | null> {
  try {
    const reader = await db.paymentReader.findUnique({
      where: { id: readerId },
      select: { lastError: true, lastErrorAt: true },
    })
    if (reader?.lastError && reader.lastErrorAt) {
      return {
        status: 'degraded',
        updatedAt: reader.lastErrorAt,
        reason: reader.lastError,
      }
    }
  } catch {
    // DB unavailable — fall back to healthy
  }
  return null
}

export async function getReaderHealth(readerId: string): Promise<ReaderHealth> {
  const cached = healthMap.get(readerId)
  if (cached) return cached

  // First access — try restoring from DB
  const restored = await restoreFromDb(readerId)
  if (restored) {
    healthMap.set(readerId, restored)
    return restored
  }

  return { status: 'healthy', updatedAt: new Date() }
}

export async function markReaderHealthy(readerId: string): Promise<void> {
  healthMap.set(readerId, { status: 'healthy', updatedAt: new Date() })

  // Clear error state in database
  try {
    await db.paymentReader.update({
      where: { id: readerId },
      data: { lastError: null, lastErrorAt: null },
    })
  } catch {
    // DB write failure is non-fatal — in-memory cache is authoritative during runtime
  }
}

export async function markReaderDegraded(readerId: string, reason: string): Promise<void> {
  const now = new Date()
  healthMap.set(readerId, { status: 'degraded', updatedAt: now, reason })

  // Persist to database so state survives restart
  try {
    await db.paymentReader.update({
      where: { id: readerId },
      data: { lastError: reason, lastErrorAt: now },
    })
  } catch {
    // DB write failure is non-fatal — in-memory cache is authoritative during runtime
  }
}

export function clearReaderHealth(readerId: string): void {
  healthMap.delete(readerId)
}

/**
 * Asserts the reader is healthy before allowing a transaction.
 * Throws a descriptive error if the reader is degraded.
 */
export async function assertReaderHealthy(readerId: string): Promise<void> {
  const health = await getReaderHealth(readerId)
  if (health.status === 'degraded') {
    throw new Error(
      `Reader ${readerId} is degraded and not accepting transactions: ` +
      `${health.reason ?? 'unknown reason'}. ` +
      `Restart the device or use POST /api/datacap/pad-reset to clear the reader state.`
    )
  }
}
