/**
 * Check domain socket dispatchers
 *
 * Handles: check lifecycle broadcasts (opened, committed, abandoned,
 * lease changes, list refresh).
 */

import { log, emitToLocation } from './emit-helpers'

export async function dispatchCheckOpened(
  locationId: string,
  checkId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await emitToLocation(locationId, 'check:opened', { checkId, ...data })
  } catch (err) {
    log.warn({ err, checkId }, 'dispatchCheckOpened failed')
  }
}

export async function dispatchCheckCommitted(
  locationId: string,
  checkId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await emitToLocation(locationId, 'check:committed', { checkId, ...data })
  } catch (err) {
    log.warn({ err, checkId }, 'dispatchCheckCommitted failed')
  }
}

export async function dispatchCheckAbandoned(
  locationId: string,
  checkId: string
): Promise<void> {
  try {
    await emitToLocation(locationId, 'check:abandoned', { checkId })
  } catch (err) {
    log.warn({ err, checkId }, 'dispatchCheckAbandoned failed')
  }
}

export async function dispatchCheckLeaseChanged(
  locationId: string,
  checkId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await emitToLocation(locationId, 'check:lease-changed', { checkId, ...data })
  } catch (err) {
    log.warn({ err, checkId }, 'dispatchCheckLeaseChanged failed')
  }
}

export async function dispatchChecksListChanged(
  locationId: string
): Promise<void> {
  try {
    await emitToLocation(locationId, 'checks:list-changed', {})
  } catch (err) {
    log.warn({ err }, 'dispatchChecksListChanged failed')
  }
}
