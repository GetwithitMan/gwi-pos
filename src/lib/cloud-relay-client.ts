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

let relaySocket: Socket | null = null
let consecutiveFailures = 0
let isConnected = false
let lastPingAt: Date | null = null

/** Default downstream fallback interval (restored after relay recovers) */
const DEFAULT_FALLBACK_INTERVAL_MS = 5000
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
    console.log('[CloudRelay] CLOUD_RELAY_URL not set — relay disabled')
    return
  }

  const serverApiKey = process.env.SERVER_API_KEY
  const locationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
  if (!serverApiKey || !locationId) {
    console.warn('[CloudRelay] Missing SERVER_API_KEY or POS_LOCATION_ID — relay disabled')
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
    console.log('[CloudRelay] Connected to', url)
    isConnected = true
    consecutiveFailures = 0
    resetFallbackInterval()
  })

  relaySocket.on('disconnect', (reason) => {
    console.log('[CloudRelay] Disconnected:', reason)
    isConnected = false
    consecutiveFailures++

    if (consecutiveFailures >= FAST_FALLBACK_THRESHOLD) {
      setFallbackInterval(FAST_FALLBACK_INTERVAL_MS)
      console.warn(`[CloudRelay] ${consecutiveFailures} consecutive failures — polling fallback accelerated to ${FAST_FALLBACK_INTERVAL_MS}ms`)
    }
  })

  relaySocket.on('connect_error', (err) => {
    consecutiveFailures++
    // Only log every 5th failure to avoid log spam
    if (consecutiveFailures % 5 === 1) {
      console.warn(`[CloudRelay] Connection error (attempt ${consecutiveFailures}):`, err.message)
    }

    if (consecutiveFailures >= FAST_FALLBACK_THRESHOLD) {
      setFallbackInterval(FAST_FALLBACK_INTERVAL_MS)
    }
  })

  // ── Inbound Events from Cloud ──────────────────────────────────────────

  relaySocket.on('DATA_CHANGED', (models?: string[]) => {
    console.log('[CloudRelay] DATA_CHANGED received, models:', models || 'all')
    void triggerSync(models)
  })

  relaySocket.on('CONFIG_UPDATED', (models?: string[]) => {
    console.log('[CloudRelay] CONFIG_UPDATED received, models:', models || 'all')
    void triggerSync(models)
  })

  relaySocket.on('COMMAND', (commandType: string, payload: unknown) => {
    console.log('[CloudRelay] COMMAND received:', commandType)
    // Future: handle remote commands (FORCE_SYNC, etc.)
    if (commandType === 'FORCE_SYNC') {
      void triggerSync()
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

  console.log('[CloudRelay] Client initialized, connecting to', url)
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
    console.log('[CloudRelay] Client stopped')
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

async function triggerSync(models?: string[]): Promise<void> {
  try {
    const { triggerImmediateDownstreamSync } = await import('./sync/downstream-sync-worker')
    await triggerImmediateDownstreamSync(undefined, models)
  } catch (err) {
    console.error('[CloudRelay] Downstream sync trigger failed:', err instanceof Error ? err.message : err)
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
    console.log('[CloudRelay] Polling fallback restored to', DEFAULT_FALLBACK_INTERVAL_MS, 'ms')
  }
}

/**
 * Get current fallback polling interval.
 * Called by downstream-sync-worker to adjust its timer.
 */
export function getCloudRelayFallbackInterval(): number {
  return currentFallbackInterval
}
