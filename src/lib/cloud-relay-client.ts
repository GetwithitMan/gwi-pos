/**
 * Cloud Relay Client — Outbound WebSocket from NUC to Cloud
 *
 * NUC initiates connection to cloud relay (works through NAT/firewalls).
 * Receives push events for immediate downstream sync wake-up.
 *
 * Key invariant: The relay is an ACCELERATION layer, not a durability layer.
 * All durable guarantees remain DB-backed (FulfillmentEvent, BridgeCheckpoint,
 * OutageQueueEntry, idempotency keys). The relay just wakes up the sync worker.
 */

import { io, Socket } from 'socket.io-client'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cloud-relay')

let relaySocket: Socket | null = null
let consecutiveFailures = 0
let isConnected = false
let lastPingAt: Date | null = null

/** Default downstream fallback interval (restored after relay recovers) */
const DEFAULT_FALLBACK_INTERVAL_MS = 2000
/** Faster fallback when relay is consistently failing */
const FAST_FALLBACK_INTERVAL_MS = 2000
/** Consecutive failures before triggering fast fallback */
const FAST_FALLBACK_THRESHOLD = 5

/** Current fallback interval (adjusted by relay health) */
let currentFallbackInterval = DEFAULT_FALLBACK_INTERVAL_MS

/** Health stats for monitoring endpoint */
interface RelayHealthStats {
  connected: boolean
  consecutiveFailures: number
  lastPingAt: Date | null
  currentFallbackInterval: number
}

/**
 * Start the cloud relay client.
 * Call from server.ts after startup when SYNC_ENABLED=true.
 */
export function startCloudRelayClient(): void {
  const url = process.env.CLOUD_RELAY_URL
  if (!url) {
    log.info('CLOUD_RELAY_URL not set — relay disabled')
    return
  }

  const serverApiKey = process.env.SERVER_API_KEY
  const locationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
  if (!serverApiKey || !locationId) {
    log.warn('Missing SERVER_API_KEY or POS_LOCATION_ID — relay disabled')
    return
  }

  relaySocket = io(url, {
    auth: {
      serverApiKey,
      locationId,
    },
    transports: ['websocket'], // Skip long-polling upgrade (hangs on restrictive Wi-Fi)
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
  })

  relaySocket.on('connect', () => {
    log.info({ url }, 'Connected')
    isConnected = true
    consecutiveFailures = 0
    resetFallbackInterval()
  })

  relaySocket.on('disconnect', (reason) => {
    log.info({ reason }, 'Disconnected')
    isConnected = false
    consecutiveFailures++

    if (consecutiveFailures >= FAST_FALLBACK_THRESHOLD) {
      setFallbackInterval(FAST_FALLBACK_INTERVAL_MS)
      log.warn({ consecutiveFailures, fallbackMs: FAST_FALLBACK_INTERVAL_MS }, 'Polling fallback accelerated')
    }
  })

  relaySocket.on('connect_error', (err) => {
    consecutiveFailures++
    // Only log every 5th failure to avoid log spam
    if (consecutiveFailures % 5 === 1) {
      log.warn({ consecutiveFailures, errMsg: err.message }, 'Connection error')
    }

    if (consecutiveFailures >= FAST_FALLBACK_THRESHOLD) {
      setFallbackInterval(FAST_FALLBACK_INTERVAL_MS)
    }
  })

  // ── Inbound Events from Cloud ──────────────────────────────────────────

  relaySocket.on('DATA_CHANGED', (data?: { models?: string[]; domain?: string } | string[]) => {
    // Accept both { models, domain } object and legacy string[] format
    const models = Array.isArray(data) ? data : data?.models
    const domain = Array.isArray(data) ? undefined : data?.domain
    log.info({ models: models || 'all', domain }, 'DATA_CHANGED received')
    void triggerSync(models, domain)
  })

  relaySocket.on('CONFIG_UPDATED', (data?: { models?: string[]; domain?: string } | string[]) => {
    const models = Array.isArray(data) ? data : data?.models
    const domain = Array.isArray(data) ? undefined : data?.domain
    log.info({ models: models || 'all', domain }, 'CONFIG_UPDATED received')
    void triggerSync(models, domain)
  })

  relaySocket.on('COMMAND', (commandType: string, payload: unknown) => {
    log.info({ commandType }, 'COMMAND received')
    if (commandType === 'FORCE_SYNC') {
      void triggerSync()
    } else if (commandType === 'PROMOTE') {
      void handlePromoteCommand(payload)
    }
  })

  relaySocket.on('pong', () => {
    lastPingAt = new Date()
  })

  // ── Heartbeat ──────────────────────────────────────────────────────────

  const heartbeatTimer = setInterval(() => {
    if (relaySocket?.connected) {
      relaySocket.emit('HEALTH', getHealthPayload())
    }
  }, 60_000) // Every 60s
  heartbeatTimer.unref()

  log.info({ url }, 'Client initialized, connecting')
}

/**
 * Stop the cloud relay client.
 * Called during graceful shutdown.
 */
export function stopCloudRelayClient(): void {
  if (relaySocket) {
    relaySocket.removeAllListeners()
    relaySocket.disconnect()
    relaySocket = null
    isConnected = false
    log.info('Client stopped')
  }
}

/**
 * Emit an event to the cloud relay (NUC → Cloud).
 * Used by upstream sync worker and business event emitters.
 */
export function emitToRelay(event: string, data: unknown): void {
  if (relaySocket?.connected) {
    relaySocket.emit(event, data)
  }
}

/**
 * Get relay health stats for monitoring endpoint.
 */
export function getRelayHealth(): RelayHealthStats {
  return {
    connected: isConnected,
    consecutiveFailures,
    lastPingAt,
    currentFallbackInterval,
  }
}

// ── Internal Helpers ───────────────────────────────────────────────────────

async function handlePromoteCommand(payload: unknown): Promise<void> {
  try {
    const cmd = payload as Record<string, unknown>
    log.info({ venueSlug: cmd?.venueSlug, oldPrimaryIp: cmd?.oldPrimaryIp }, 'PROMOTE command — dispatching to ha-promote handler')
    const { handlePromotion } = await import('./ha-promote')
    const command = {
      command: 'PROMOTE' as const,
      oldPrimaryNodeId: (cmd?.oldPrimaryNodeId as string) || 'unknown',
      oldPrimaryIp: (cmd?.oldPrimaryIp as string) || '',
      venueSlug: (cmd?.venueSlug as string) || '',
      fenceCommandId: (cmd?.fenceCommandId as string) || '',
      issuedAt: (cmd?.issuedAt as string) || undefined,
      expiresAt: (cmd?.expiresAt as string) || undefined,
    }
    if (!command.oldPrimaryIp || !command.fenceCommandId) {
      log.error({ command }, 'PROMOTE command missing required fields (oldPrimaryIp, fenceCommandId)')
      return
    }
    const result = await handlePromotion(command)
    if (result.success) {
      log.info({ durationMs: result.durationMs }, 'PROMOTE completed successfully')
    } else {
      log.error({ error: result.error, steps: result.steps }, 'PROMOTE failed')
    }
  } catch (err) {
    log.error({ err }, 'PROMOTE command handler failed')
  }
}

async function triggerSync(models?: string[], domain?: string): Promise<void> {
  try {
    // Route through data-changed-handler for domain-specific targeted sync
    // (e.g., 'hardware' domain only syncs Terminal, Printer, KDS, etc.)
    // Falls back to full sync if no domain or handler found.
    const { handleDataChanged } = await import('./data-changed-handler')
    await handleDataChanged({ domain, tables: models })
  } catch (err) {
    log.error({ err }, 'Downstream sync trigger failed')
  }
}

function getHealthPayload(): Record<string, unknown> {
  const locationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID || ''
  return {
    locationId,
    timestamp: new Date().toISOString(),
  }
}

function setFallbackInterval(ms: number): void {
  if (currentFallbackInterval === ms) return
  currentFallbackInterval = ms
}

function resetFallbackInterval(): void {
  if (currentFallbackInterval !== DEFAULT_FALLBACK_INTERVAL_MS) {
    currentFallbackInterval = DEFAULT_FALLBACK_INTERVAL_MS
    log.info({ fallbackMs: DEFAULT_FALLBACK_INTERVAL_MS }, 'Polling fallback restored')
  }
}

/**
 * Get current fallback polling interval.
 * Called by downstream-sync-worker to adjust its timer.
 */
export function getCloudRelayFallbackInterval(): number {
  return currentFallbackInterval
}
