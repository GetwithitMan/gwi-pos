/**
 * Fire-and-forget outage queue helper.
 * Call AFTER a successful local DB write to ensure the mutation
 * reaches Neon even during network outages.
 *
 * Usage:
 *   await db.seat.create({ data })
 *   void queueIfOutage('Seat', locationId, seat.id, 'INSERT', data)
 *
 * For critical mutations where data loss is unacceptable:
 *   try {
 *     await queueIfOutageOrFail('Order', locationId, order.id, 'INSERT', data)
 *   } catch (err) {
 *     if (err instanceof OutageQueueFullError) return NextResponse.json(..., { status: 507 })
 *   }
 */
import { isInOutageMode, queueOutageWrite, triggerImmediateUpstreamSync } from './upstream-sync-worker'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('outage-safe-write')

/**
 * Fire-and-forget: trigger immediate upstream sync after a local mutation.
 * Debounced at 100ms in the upstream worker — safe to call on every mutation.
 * No-op during outage (sync worker handles retry on recovery).
 */
export function pushUpstream(): void {
  if (isInOutageMode()) return
  triggerImmediateUpstreamSync()
}

export function queueIfOutage(
  tableName: string,
  locationId: string,
  recordId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload?: Record<string, unknown>
): void {
  if (!isInOutageMode()) return
  void queueOutageWrite(tableName, recordId, operation, payload ?? {}, locationId).catch((err) => {
    log.error({ err, tableName, recordId, operation }, 'Failed to queue outage write')
  })
}

/**
 * Like queueIfOutage but throws if the write cannot be queued during outage.
 * Use for critical mutations (orders, payments, tips) where silent loss is unacceptable.
 * Routes should catch this and return 507 Insufficient Storage.
 */
export async function queueIfOutageOrFail(
  tableName: string,
  locationId: string,
  recordId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload?: Record<string, unknown>
): Promise<void> {
  if (!isInOutageMode()) return
  const result = await queueOutageWrite(tableName, recordId, operation, payload ?? {}, locationId)
  if (!result.queued) {
    throw new OutageQueueFullError(tableName, recordId, result.reason)
  }
}

export class OutageQueueFullError extends Error {
  tableName: string
  recordId: string
  constructor(tableName: string, recordId: string, reason?: string) {
    super(`Outage queue full — cannot queue ${tableName}:${recordId}: ${reason}`)
    this.name = 'OutageQueueFullError'
    this.tableName = tableName
    this.recordId = recordId
  }
}
