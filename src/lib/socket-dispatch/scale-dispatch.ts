/**
 * Scale domain socket dispatchers
 *
 * Handles: weight readings, connection status.
 */

import type { WeightReading } from '@/lib/scale/scale-protocol'
import {
  log,
  emitToLocation,
  emitToRoom,
} from './emit-helpers'

/**
 * Dispatch scale weight reading to scale room subscribers
 *
 * Called by ScaleService on each parsed weight reading.
 * Emits to `scale:{scaleId}` room so only terminals watching this scale receive updates.
 */
export function dispatchScaleWeight(
  locationId: string,
  scaleId: string,
  reading: WeightReading
): void {
  void emitToRoom(`scale:${scaleId}`, 'scale:weight', {
    scaleId,
    weight: reading.weight,
    unit: reading.unit,
    stable: reading.stable,
    grossNet: reading.grossNet,
    overCapacity: reading.overCapacity,
    timestamp: reading.timestamp.toISOString(),
  }).catch((err) => log.error({ err }, 'Scale weight dispatch failed'))
}

/**
 * Dispatch scale connection status change to location room
 *
 * Called by ScaleService on connect/disconnect/error events.
 * All terminals in the location receive status updates.
 */
export function dispatchScaleStatus(
  locationId: string,
  scaleId: string,
  status: { connected: boolean; error?: string }
): void {
  void emitToLocation(locationId, 'scale:status', {
    scaleId,
    connected: status.connected,
    error: status.error ?? null,
    timestamp: new Date().toISOString(),
  }).catch((err) => log.error({ err }, 'Scale status dispatch failed'))
}
