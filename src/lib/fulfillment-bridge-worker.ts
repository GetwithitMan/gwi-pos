/**
 * Fulfillment Bridge Worker — Durable Hardware Dispatch
 *
 * Polls FulfillmentEvent rows and dispatches them to hardware (printers, KDS,
 * drawers) via Socket.IO. Implements claim-based concurrency control so that
 * HA primary/backup nodes don't double-fire the same event.
 *
 * Design:
 * - Polls every 2s for pending FulfillmentEvent rows
 * - Claims an event (optimistic locking via updateMany WHERE status='pending')
 * - Dispatches to the appropriate Socket.IO room
 * - Marks completed, or retries up to MAX_RETRIES before dead-lettering
 * - Reclaims stale claimed events (processing took > CLAIM_TIMEOUT)
 *
 * Only runs when SYNC_ENABLED=true (NUC mode).
 */

import { Prisma } from '@/generated/prisma/client'
import { masterClient } from './db'
import { emitToLocation, emitToTags } from './socket-server'
import { shouldClaimBridge, isLeaseActive } from '@/lib/bridge-checkpoint'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('fulfillment-bridge')

// ── Config ────────────────────────────────────────────────────────────────────

const NODE_ID = process.env.NUC_NODE_ID || 'primary'
const LOCATION_ID = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
const POLL_INTERVAL = 2_000 // 2s
const MAX_RETRIES = 3
const CLAIM_TIMEOUT = 300_000 // 5 min — reclaim if processing takes too long (large print jobs need time)

// ── State ─────────────────────────────────────────────────────────────────────

let bridgeTimer: ReturnType<typeof setInterval> | null = null

interface BridgeMetrics {
  running: boolean
  eventsProcessed: number
  eventsFailed: number
  eventsDeadLettered: number
}

const metrics: BridgeMetrics = {
  running: false,
  eventsProcessed: 0,
  eventsFailed: 0,
  eventsDeadLettered: 0,
}

// ── Core Logic ────────────────────────────────────────────────────────────────

async function pollAndProcess(): Promise<void> {
  if (!LOCATION_ID) return

  // Only process if this node holds the bridge lease
  const hasLease = await isLeaseActive()
  if (!hasLease) {
    // Try to claim if no other node has an active lease
    const canClaim = await shouldClaimBridge()
    if (!canClaim) return  // Another node is active, skip this cycle
    // If we can claim, proceed — the checkpoint heartbeat will establish our lease
  }

  try {
    // Reclaim stale claimed events (processing took too long)
    await masterClient.$executeRaw(
      Prisma.sql`UPDATE "FulfillmentEvent"
       SET status = 'pending', "claimedBy" = NULL, "claimedAt" = NULL
       WHERE status = 'claimed'
         AND "claimedAt" < ${new Date(Date.now() - CLAIM_TIMEOUT)}::timestamptz
         AND "locationId" = ${LOCATION_ID}`,
    )

    // Atomic claim: SELECT FOR UPDATE SKIP LOCKED + UPDATE in one round-trip
    const events = await masterClient.$queryRaw<Array<{
      id: string
      type: string
      payload: unknown
      locationId: string
      retryCount: number
      orderId: string | null
      stationId: string | null
    }>>(
      Prisma.sql`UPDATE "FulfillmentEvent"
       SET "claimedBy" = ${NODE_ID}, "claimedAt" = NOW(), status = 'claimed'
       WHERE id IN (
         SELECT id FROM "FulfillmentEvent"
         WHERE "locationId" = ${LOCATION_ID} AND status = 'pending' AND "retryCount" < ${MAX_RETRIES}
         ORDER BY "createdAt" ASC
         LIMIT 10
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, type, payload, "locationId", "retryCount", "orderId", "stationId"`,
    )

    if (events.length === 0) return

    for (const event of events) {
      try {
        await executeHardwareAction(event)

        await masterClient.$executeRaw(
          Prisma.sql`UPDATE "FulfillmentEvent"
           SET status = 'completed', "completedAt" = NOW()
           WHERE id = ${event.id}`,
        )
        metrics.eventsProcessed++
      } catch (err) {
        const newRetryCount = event.retryCount + 1
        const newStatus = newRetryCount >= MAX_RETRIES ? 'dead_letter' : 'pending'

        if (newStatus === 'dead_letter') {
          metrics.eventsDeadLettered++
        } else {
          metrics.eventsFailed++
        }

        log.error({ err, eventId: event.id, retryCount: newRetryCount, maxRetries: MAX_RETRIES }, 'Failed to process fulfillment event')

        await masterClient.$executeRaw(
          Prisma.sql`UPDATE "FulfillmentEvent"
           SET status = ${newStatus},
               "retryCount" = ${newRetryCount},
               "failedAt" = NOW(),
               "claimedBy" = NULL,
               "claimedAt" = NULL
           WHERE id = ${event.id}`,
        )
      }
    }
  } catch (err) {
    log.error({ err }, 'Poll cycle error')
  }
}

/**
 * Execute the hardware action for a fulfillment event.
 * Dispatches to the appropriate Socket.IO room using the existing
 * emitToLocation/emitToTags infrastructure.
 */
async function executeHardwareAction(event: {
  id: string
  type: string
  payload: unknown
  locationId: string
  stationId: string | null
}): Promise<void> {
  const payload = typeof event.payload === 'string'
    ? JSON.parse(event.payload)
    : event.payload

  switch (event.type) {
    case 'print_kitchen':
    case 'print_bar':
    case 'print_prep': {
      // Emit to station-specific tag room if stationId available,
      // otherwise broadcast to location
      if (event.stationId) {
        const tags = payload?.matchedTags as string[] | undefined
        if (tags && tags.length > 0) {
          await emitToTags(tags, 'kds:order-received', payload, event.locationId)
        }
      }
      // Also emit print-ticket for physical printers listening on location room
      await emitToLocation(event.locationId, 'print-ticket', {
        ...payload,
        eventType: event.type,
        stationId: event.stationId,
      })
      break
    }

    case 'kds_update': {
      await emitToLocation(event.locationId, 'kds:order-received', payload)
      break
    }

    case 'drawer_kick': {
      await emitToLocation(event.locationId, 'drawer-kick', payload)
      break
    }

    default:
      log.warn(`Unknown event type: ${event.type}`)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startFulfillmentBridge(): void {
  if (bridgeTimer) return
  if (!LOCATION_ID) {
    log.info('No POS_LOCATION_ID — worker disabled')
    return
  }

  bridgeTimer = setInterval(() => {
    void pollAndProcess().catch((err) => log.error({ err }, 'pollAndProcess cycle error'))
  }, POLL_INTERVAL)
  bridgeTimer.unref()

  metrics.running = true
  log.info({ nodeId: NODE_ID, intervalMs: POLL_INTERVAL }, 'Worker started')
}

export function stopFulfillmentBridge(): void {
  if (bridgeTimer) {
    clearInterval(bridgeTimer)
    bridgeTimer = null
    metrics.running = false
    log.info('Worker stopped')
  }
}

export function getFulfillmentBridgeMetrics(): BridgeMetrics {
  return { ...metrics }
}
