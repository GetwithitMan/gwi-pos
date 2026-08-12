/**
 * Check Lease Cleanup — Socket Disconnect Handler
 *
 * Release all leases held by a disconnected terminal.
 * Called from the socket disconnect handler when a terminal goes offline.
 */

import { db } from '@/lib/db'
import { emitCheckEvent } from './emitter'
import { dispatchCheckLeaseChanged } from '@/lib/socket-dispatch/check-dispatch'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('check-lease-cleanup')

/**
 * Release all leases held by a disconnected terminal.
 *
 * @param terminalId - The terminal that disconnected
 * @returns Number of leases released
 */
export async function releaseTerminalLeases(terminalId: string): Promise<number> {
  const checks = await db.check.findMany({
    where: {
      terminalId,
      status: { in: ['draft', 'committed'] },
    },
  })

  for (const check of checks) {
    try {
      await db.check.update({
        where: { id: check.id },
        data: {
          terminalId: null,
          leaseAcquiredAt: null,
          leaseLastHeartbeatAt: null,
        },
      })

      void emitCheckEvent(check.locationId, check.id, 'CHECK_LEASE_RELEASED', {
        terminalId,
        reason: 'disconnect',
      }).catch(e => log.warn({ err: e }, 'emit CHECK_LEASE_RELEASED failed'))

      void dispatchCheckLeaseChanged(check.locationId, check.id, {
        terminalId: null,
        reason: 'disconnect',
      }).catch(e => log.warn({ err: e }, 'dispatchCheckLeaseChanged failed'))
    } catch (e) {
      log.error({ err: e, checkId: check.id }, 'Failed to release lease on disconnect')
    }
  }

  return checks.length
}
