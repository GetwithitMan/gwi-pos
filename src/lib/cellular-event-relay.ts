/**
 * Cellular Event Relay — writes socket events to Neon for SSE delivery to cellular terminals.
 *
 * Design:
 * - Fire-and-forget: never blocks socket dispatch
 * - Batched: accumulates events for 100ms, then bulk inserts to reduce Neon round-trips
 * - Cleanup: deletes events older than 1h on a 5-minute interval
 * - Uses neonClient (PrismaPg to Neon) — same connection pool as upstream sync
 */

import { Prisma } from '@/generated/prisma/client'
import { neonClient, hasNeonConnection } from './neon-client'
import { createChildLogger } from './logger'

const log = createChildLogger('cellular-relay')

// ── Singleton via globalThis ──────────────────────────────────────────────
declare global {
  var __gwi_cellular_relay_buffer: Array<{ locationId: string; event: string; data: unknown }> | undefined
  var __gwi_cellular_relay_timer: ReturnType<typeof setTimeout> | undefined
  var __gwi_cellular_relay_cleanup: ReturnType<typeof setInterval> | undefined
}

const BATCH_INTERVAL_MS = 100
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
// Allow 4 hours for cellular terminals to reconnect and retrieve events
const MAX_EVENT_AGE_MINUTES = 240

// Events that are NOT relevant to cellular terminals (too frequent or device-specific)
const SKIP_EVENTS = new Set([
  'scale:weight',
  'scale:status',
  'cfd:show-order',
  'cfd:show-order-detail',
  'cfd:payment-started',
  'cfd:tip-prompt',
  'cfd:signature-request',
  'cfd:processing',
  'cfd:approved',
  'cfd:declined',
  'cfd:receipt-sent',
  'cfd:idle',
  'cfd:order-updated',
  'terminal:payment_request',
  'terminal:payment_complete',
])

/**
 * Queue a socket event for relay to cellular terminals via Neon.
 * Fire-and-forget — never throws, never blocks.
 */
export function relayCellularEvent(locationId: string, event: string, data: unknown): void {
  if (!hasNeonConnection()) return
  if (SKIP_EVENTS.has(event)) return

  if (!globalThis.__gwi_cellular_relay_buffer) {
    globalThis.__gwi_cellular_relay_buffer = []
  }

  globalThis.__gwi_cellular_relay_buffer.push({ locationId, event, data })

  // Schedule flush if not already scheduled
  if (!globalThis.__gwi_cellular_relay_timer) {
    globalThis.__gwi_cellular_relay_timer = setTimeout(() => {
      flushBuffer().catch(err => log.error({ err }, 'Cellular relay flush failed'))
    }, BATCH_INTERVAL_MS)
  }
}

async function flushBuffer(): Promise<void> {
  globalThis.__gwi_cellular_relay_timer = undefined
  const buffer = globalThis.__gwi_cellular_relay_buffer
  if (!buffer || buffer.length === 0) return
  globalThis.__gwi_cellular_relay_buffer = []

  if (!neonClient) return

  try {
    // Build a multi-row INSERT for efficiency
    // VALUES ($1, $2, $3::jsonb), ($4, $5, $6::jsonb), ...
    const values: string[] = []
    const params: unknown[] = []
    for (let i = 0; i < buffer.length; i++) {
      const offset = i * 3
      values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}::jsonb)`)
      params.push(buffer[i].locationId, buffer[i].event, JSON.stringify(buffer[i].data ?? {}))
    }

    // eslint-disable-next-line -- $executeRawUnsafe required: dynamic batch VALUES count with numbered params
    await neonClient.$executeRawUnsafe(
      `INSERT INTO "CellularEvent" ("locationId", "event", "data") VALUES ${values.join(', ')}`,
      ...params
    )
  } catch (err) {
    log.warn({ err, count: buffer.length }, 'Failed to write cellular events to Neon — events lost for cellular devices')
  }
}

/**
 * Start the periodic cleanup timer. Call from server.ts when sync is enabled.
 */
export function startCellularRelayCleanup(): void {
  if (globalThis.__gwi_cellular_relay_cleanup) return
  log.info('Starting cellular event relay cleanup (every 5m, max age 60m)')
  globalThis.__gwi_cellular_relay_cleanup = setInterval(() => {
    cleanupOldEvents().catch(err => log.error({ err }, 'Cellular event cleanup failed'))
  }, CLEANUP_INTERVAL_MS)
  // Don't keep the process alive
  if (globalThis.__gwi_cellular_relay_cleanup.unref) {
    globalThis.__gwi_cellular_relay_cleanup.unref()
  }
}

export function stopCellularRelayCleanup(): void {
  if (globalThis.__gwi_cellular_relay_cleanup) {
    clearInterval(globalThis.__gwi_cellular_relay_cleanup)
    globalThis.__gwi_cellular_relay_cleanup = undefined
  }
  // Flush remaining buffer
  if (globalThis.__gwi_cellular_relay_timer) {
    clearTimeout(globalThis.__gwi_cellular_relay_timer)
    globalThis.__gwi_cellular_relay_timer = undefined
  }
  if (globalThis.__gwi_cellular_relay_buffer?.length) {
    void flushBuffer().catch(() => {})
  }
}

async function cleanupOldEvents(): Promise<void> {
  if (!neonClient) return
  try {
    const result = await neonClient.$executeRaw(
      Prisma.sql`DELETE FROM "CellularEvent" WHERE "createdAt" < NOW() - INTERVAL '240 minutes'`
    )
    // $executeRawUnsafe returns the count on DELETE
    if (typeof result === 'number' && result > 0) {
      log.info({ deleted: result }, 'Cleaned up old cellular events')
    }
  } catch (err) {
    log.warn({ err }, 'Cellular event cleanup query failed')
  }
}
