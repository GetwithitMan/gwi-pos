/**
 * Sync / HA failover socket dispatchers
 *
 * Handles: outage status, failover active/resolved.
 */

import {
  log,
  emitToLocation,
  type DispatchOptions,
} from './emit-helpers'

// ==================== Outage Status Events ====================

/**
 * Dispatch sync:outage-status event to all connected clients.
 *
 * Emitted by the upstream sync worker when outage state transitions:
 * - false -> true: Internet lost (3 consecutive Neon failures)
 * - true -> false: Internet restored
 *
 * Client listener: OutageBanner listens for this to show/hide the offline banner.
 */
export async function dispatchOutageStatus(
  locationId: string,
  isInOutage: boolean,
): Promise<void> {
  try {
    await emitToLocation(locationId, 'sync:outage-status', { isInOutage })
  } catch (error) {
    log.error({ err: error }, 'Failed to dispatch sync:outage-status')
  }
}

// ==================== HA Failover Events ====================

/**
 * Dispatch server:failover-active event to all connected clients.
 *
 * Emitted when the health API detects this NUC is running as a promoted backup
 * (pgRole === 'primary' but STATION_ROLE === 'backup'). All web POS terminals
 * show a yellow "Backup Server Active" banner.
 */
export async function dispatchFailoverActive(
  locationId: string,
  payload: {
    message: string
    since: string  // ISO timestamp of when failover was detected
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'server:failover-active', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch server:failover-active')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async failover-active failed'))
    return true
  }

  return doEmit()
}

/**
 * Dispatch server:failover-resolved event to all connected clients.
 *
 * Emitted when the original primary comes back and this node returns to backup role.
 * Clears the "Backup Server Active" banner on all web POS terminals.
 */
export async function dispatchFailoverResolved(
  locationId: string,
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'server:failover-resolved', {
        resolvedAt: new Date().toISOString(),
      })
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch server:failover-resolved')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async failover-resolved failed'))
    return true
  }

  return doEmit()
}
