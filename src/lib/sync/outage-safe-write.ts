/**
 * Fire-and-forget outage queue helper.
 * Call AFTER a successful local DB write to ensure the mutation
 * reaches Neon even during network outages.
 *
 * Usage:
 *   await db.seat.create({ data })
 *   void queueIfOutage('Seat', locationId, seat.id, 'INSERT', data)
 */
import { isInOutageMode, queueOutageWrite } from './upstream-sync-worker'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('outage-safe-write')

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
