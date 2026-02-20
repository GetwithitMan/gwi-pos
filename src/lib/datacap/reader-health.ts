// Datacap Direct API — Per-Reader Health Tracking
// In-memory state machine tracking reader health per process.
// Readers are marked degraded when EMVPadReset fails after a transaction,
// which indicates the reader may be stuck and needs operator attention.

export type ReaderHealthStatus = 'healthy' | 'degraded'

export interface ReaderHealth {
  status: ReaderHealthStatus
  updatedAt: Date
  reason?: string
}

const healthMap = new Map<string, ReaderHealth>()

export function getReaderHealth(readerId: string): ReaderHealth {
  return healthMap.get(readerId) ?? { status: 'healthy', updatedAt: new Date() }
}

export function markReaderHealthy(readerId: string): void {
  healthMap.set(readerId, { status: 'healthy', updatedAt: new Date() })
}

export function markReaderDegraded(readerId: string, reason: string): void {
  healthMap.set(readerId, { status: 'degraded', updatedAt: new Date(), reason })
}

export function clearReaderHealth(readerId: string): void {
  healthMap.delete(readerId)
}

/**
 * Asserts the reader is healthy before allowing a transaction.
 * Throws a descriptive error if the reader is degraded.
 */
export function assertReaderHealthy(readerId: string): void {
  const health = getReaderHealth(readerId)
  if (health.status === 'degraded') {
    throw new Error(
      `Reader ${readerId} is degraded and not accepting transactions: ` +
      `${health.reason ?? 'unknown reason'}. ` +
      `Restart the device or use POST /api/datacap/pad-reset to clear the reader state.`
    )
  }
}
