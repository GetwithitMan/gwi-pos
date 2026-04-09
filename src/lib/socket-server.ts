/**
 * Socket.io Server Setup for GWI POS
 *
 * Room Architecture:
 * - location:{id} - Global venue alerts (sync status, hardware failures)
 * - tag:{locationId}:{tagName} - Prep stations, location-scoped (tag:loc_123:pizza)
 * - terminal:{id} - Direct messages to specific handheld
 *
 * This provides real-time updates to replace polling:
 * - KDS screens get instant order notifications
 * - Item status updates propagate immediately
 * - Entertainment timers stay perfectly synced
 *
 * Usage:
 * - For Next.js custom server: import and call initializeSocketServer(httpServer)
 * - For standalone: run this file directly with ts-node
 */

import { relayCellularEvent } from './cellular-event-relay'
import type { Server as HTTPServer } from 'http'
import type { Server as SocketServer, Socket } from 'socket.io'
import { MOBILE_EVENTS, PAT_EVENTS } from '@/types/multi-surface'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { verifySessionToken, POS_SESSION_COOKIE } from '@/lib/auth-session'
import { recordEvent, getEventsSince, getLatestEventId } from '@/lib/socket-event-buffer'
import {
  enqueueAck,
  acknowledgeEvent as ackQueueAcknowledge,
  getRetryableEvents,
  markRetryAttempt,
  removeSocketFromAcks,
} from './socket-ack-queue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS, type TerminalRevokedPayload } from '@/lib/socket-events'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('socket-server')

// Dynamic import for socket.io (optional dependency)
const io: typeof import('socket.io').Server | null = null

/**
 * Send emit request to standalone ws-server via HTTP IPC.
 * Used when Socket.io runs in a separate process (WS_STANDALONE=true).
 */
async function emitViaIPC(payload: { type: string; target: string | string[]; event: string; data: unknown }): Promise<boolean> {
  const wsUrl = process.env.WS_SERVER_URL
  if (!wsUrl) return false
  try {
    const res = await fetch(`${wsUrl}/internal/emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000), // 2s timeout for local IPC
    })
    return res.ok
  } catch {
    log.warn('IPC to ws-server failed')
    return false
  }
}

interface JoinStationPayload {
  locationId: string
  tags: string[]
  terminalId: string
  stationId?: string
}

// Track connected terminals for debugging
const connectedTerminals = new Map<string, {
  socketId: string
  locationId: string
  tags: string[]
  connectedAt: Date
  clientVersion?: string
}>()

// Reverse index: socketId -> terminalId for O(1) disconnect lookup
const socketToTerminal = new Map<string, string>()

// Reconnection storm protection: limit concurrent catch-up queries to prevent
// connection pool exhaustion when many terminals reconnect simultaneously
let activeCatchUpCount = 0
const MAX_CONCURRENT_CATCHUP = 10

// Periodic cleanup of stale terminal entries (every 5 minutes)
const staleTerminalTimer = setInterval(() => {
  for (const [terminalId, info] of connectedTerminals.entries()) {
    const socket = globalForSocket.socketServer?.sockets.sockets.get(info.socketId)
    if (!socket || !socket.connected) {
      connectedTerminals.delete(terminalId)
      socketToTerminal.delete(info.socketId)
    }
  }
}, 5 * 60 * 1000)
staleTerminalTimer.unref()

// ── Per-socket rate limiting ──────────────────────────────────────────────────
const socketRateLimits = new Map<string, { count: number; resetAt: number }>()
const MAX_EVENTS_PER_SECOND = 200

function checkSocketRateLimit(socketId: string): boolean {
  const now = Date.now()
  let state = socketRateLimits.get(socketId)
  if (!state || now > state.resetAt) {
    state = { count: 0, resetAt: now + 1000 }
    socketRateLimits.set(socketId, state)
  }
  state.count++
  return state.count <= MAX_EVENTS_PER_SECOND
}

/** Clean up stale rate limit entries periodically */
function cleanupRateLimits(): void {
  const now = Date.now()
  for (const [socketId, state] of socketRateLimits) {
    if (now > state.resetAt + 5000) {
      socketRateLimits.delete(socketId)
    }
  }
}

// ── Socket Metrics (Phase 6: Observability) ─────────────────────────────────
interface SocketMetrics {
  eventsEmitted60s: number[]  // Ring buffer of timestamps (last 60s)
  reconnections60s: number[]  // Ring buffer of reconnection timestamps
}

const socketMetrics: SocketMetrics = {
  eventsEmitted60s: [],
  reconnections60s: [],
}

/** Record an event emission for throughput tracking.
 * Defers pruning to getSocketHealthMetrics() (called once/min) instead of
 * pruning on every event — avoids O(n²) from repeated Array.shift(). */
function recordMetricEvent(): void {
  socketMetrics.eventsEmitted60s.push(Date.now())
  // Safety cap: prevent unbounded growth between metrics reads (~15k = 250/sec * 60s)
  if (socketMetrics.eventsEmitted60s.length > 15_000) {
    socketMetrics.eventsEmitted60s.splice(0, 5_000)
  }
}

/** Record a reconnection */
function recordReconnection(): void {
  socketMetrics.reconnections60s.push(Date.now())
  if (socketMetrics.reconnections60s.length > 1_000) {
    socketMetrics.reconnections60s.splice(0, 500)
  }
}

// Reverse mapping: cfdTerminalId → registerTerminalId (cached from auth middleware)
// Used by CFD-to-register relay to avoid DB lookups during payment flow
export const cfdToRegisterMap = new Map<string, string>()

// Dedup map for mobile tab close requests: orderId → timestamp
// Prevents duplicate close attempts within 30s (e.g., double-tap on mobile)
const pendingTabCloses = new Map<string, number>()
const CFD_MAP_MAX_SIZE = 100

/**
 * Add to cfdToRegisterMap with size bound.
 * If map exceeds max size, evict the oldest entry (first key in insertion order).
 */
export function setCfdMapping(cfdTerminalId: string, registerTerminalId: string): void {
  cfdToRegisterMap.set(cfdTerminalId, registerTerminalId)
  if (cfdToRegisterMap.size > CFD_MAP_MAX_SIZE) {
    // Map iterates in insertion order — first key is oldest
    const oldestKey = cfdToRegisterMap.keys().next().value
    if (oldestKey) cfdToRegisterMap.delete(oldestKey)
  }
  // Persist CFD pairing to Terminal.cfdTerminalId for restart recovery
  void db.$executeRaw(
    Prisma.sql`UPDATE "Terminal" SET "cfdTerminalId" = ${cfdTerminalId} WHERE id = ${registerTerminalId}`,
  ).catch((err) => log.warn({ err }, 'CFD pairing persist failed'))
}

async function markTerminalOffline(terminalId: string, locationId: string, reason: string, socketId: string): Promise<void> {
  try {
    // KDS screens use a 'kds-' prefixed terminalId — they live in KDSScreen, not Terminal
    if (terminalId.startsWith('kds-')) {
      const kdsId = terminalId.slice(4) // strip 'kds-' prefix
      // Persist isOnline=false so order-router can detect offline screens for fallback routing
      void db.kDSScreen.update({
        where: { id: kdsId },
        data: { isOnline: false },
      }).catch((err) => log.error({ err }, 'KDS screen offline persist failed'))
      void emitToLocation(locationId, 'terminal:status_changed', {
        terminalId,
        isOnline: false,
        lastSeenAt: null,
        source: 'socket_disconnect',
        reason,
      })
      return
    }
    // Grace period: only mark offline if lastSeenAt is > 2s old.
    // This prevents a race where a disconnect fires after a reconnect has already
    // marked the terminal online (disconnect-before-reconnect race condition).
    const twoSecondsAgo = new Date(Date.now() - 2000)
    const result = await db.terminal.updateMany({
      where: {
        id: terminalId,
        locationId,
        deletedAt: null,
        lastSeenAt: { lte: twoSecondsAgo },
      },
      data: { isOnline: false },
    })
    if (result.count === 0) {
      log.info({ terminalId, socketId, reason }, 'markTerminalOffline skipped — terminal was recently seen (race guard)')
      return
    }
    void emitToLocation(locationId, 'terminal:status_changed', {
      terminalId,
      isOnline: false,
      lastSeenAt: null,
      source: 'socket_disconnect',
      reason,
    })

    // ── CFD Cleanup (Ghost Order Prevention) ──
    // If this terminal has a paired CFD, tell it to return to idle
    void (async () => {
      try {
        const terminal = await db.terminal.findUnique({
          where: { id: terminalId },
          select: { cfdTerminalId: true },
        })
        if (terminal?.cfdTerminalId) {
          log.debug({ terminalId, cfdTerminalId: terminal.cfdTerminalId }, 'Clearing paired CFD for offline register')
          await emitToTerminal(terminal.cfdTerminalId, 'cfd:idle', {})
        }
      } catch (cfdErr) {
        log.warn({ err: cfdErr, terminalId }, 'Failed to clear paired CFD on disconnect')
      }
    })()

    void db.auditLog.create({
      data: {
        locationId,
        action: 'terminal_disconnected',
        entityType: 'terminal',
        entityId: terminalId,
        details: { reason, socketId },
      },
    }).catch((err) => log.error({ err }, 'audit log for terminal disconnect failed'))
  } catch (err) {
    log.error({ err }, 'markTerminalOffline failed')
  }
}

async function markTerminalOnline(terminalId: string, locationId: string): Promise<void> {
  try {
    // KDS screens use a 'kds-' prefixed terminalId — they live in KDSScreen, not Terminal
    if (terminalId.startsWith('kds-')) {
      const kdsId = terminalId.slice(4) // strip 'kds-' prefix
      // Persist isOnline=true so order-router can detect online screens (avoids fallback routing)
      void db.kDSScreen.update({
        where: { id: kdsId },
        data: { isOnline: true, lastSeenAt: new Date() },
      }).catch((err) => log.error({ err }, 'KDS screen online persist failed'))
      void emitToLocation(locationId, 'terminal:status_changed', {
        terminalId,
        isOnline: true,
        lastSeenAt: new Date().toISOString(),
        source: 'socket_reconnect',
      })
      return
    }
    // Use updateMany to atomically mark online only if not already online (prevents race with concurrent disconnect).
    // This replaces the prior findFirst + update pattern which had a TOCTOU gap.
    const result = await db.terminal.updateMany({
      where: { id: terminalId, locationId, deletedAt: null, isOnline: false },
      data: { isOnline: true, lastSeenAt: new Date() },
    })
    if (result.count === 0) return // already online or terminal not found, skip
    void emitToLocation(locationId, 'terminal:status_changed', {
      terminalId,
      isOnline: true,
      lastSeenAt: new Date().toISOString(),
      source: 'socket_reconnect',
    })
    void db.auditLog.create({
      data: {
        locationId,
        action: 'terminal_reconnected',
        entityType: 'terminal',
        entityId: terminalId,
        details: { source: 'join_station' },
      },
    }).catch((err) => log.error({ err }, 'audit log for terminal reconnect failed'))
  } catch (err) {
    log.error({ err }, 'markTerminalOnline failed')
  }
}

/**
 * Initialize Socket.io server
 */
export async function initializeSocketServer(httpServer: HTTPServer): Promise<SocketServer> {
  // Dynamic import socket.io
  const socketModule = await import('socket.io')
  const Server = socketModule.Server

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) ?? []

  const socketServer = new Server(httpServer, {
    path: process.env.SOCKET_PATH || '/api/socket',
    cors: {
      origin: process.env.NODE_ENV !== 'production'
        ? ['http://localhost:3000', 'http://localhost:3005', 'http://127.0.0.1:3005', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']
        : (origin, callback) => {
            // No origin (same-origin / server-to-server) — allow
            if (!origin) return callback(null, true)
            if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
              return callback(null, true)
            }
            // Allow Tauri webviews (NUC Dashboard) — tauri:// on macOS, http(s)://tauri.localhost on Linux/Windows
            if (origin.startsWith('tauri://') || origin.includes('tauri.localhost')) return callback(null, true)
            // ALLOWED_ORIGINS not set or origin not in list — reject
            callback(new Error('CORS rejected'), false)
          },
      methods: ['GET', 'POST'],
    },
    // Connection settings optimized for local network
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    // Limit inbound payload size — POS events are small JSON (<10KB typical).
    // Default 1MB is too generous; 100KB prevents memory exhaustion attacks.
    maxHttpBufferSize: 100 * 1024, // 100KB
  })

  // Rehydrate CFD-to-register map from Terminal.cfdTerminalId (survives restarts)
  void (async () => {
    try {
      // NUCs are single-tenant (one locationId per server), so no cross-tenant risk here.
      // All terminals on this NUC belong to the same location.
      const pairings = await db.$queryRaw<Array<{ id: string; cfdTerminalId: string }>>(
        Prisma.sql`SELECT id, "cfdTerminalId" FROM "Terminal" WHERE "cfdTerminalId" IS NOT NULL AND "deletedAt" IS NULL`
      )
      for (const t of pairings) {
        if (t.cfdTerminalId) {
          cfdToRegisterMap.set(t.cfdTerminalId, t.id)
        }
      }
      if (pairings.length > 0) {
        log.info(`Rehydrated ${pairings.length} CFD-to-register pairings from Terminal.cfdTerminalId`)
      }
    } catch (err) {
      log.warn({ err }, 'CFD pairing rehydration failed')
    }
  })().catch((err) => log.error({ err }, 'CFD pairing rehydration top-level error'))

  // ==================== Authentication Middleware ====================
  // Validate session cookie or deviceToken before allowing connection.
  // On NUC (POS_LOCATION_ID set), local connections are trusted.
  socketServer.use(async (socket, next) => {
    try {
      // Path 1: Native device token (register/PAX terminals OR KDS screens)
      const deviceToken = socket.handshake.auth?.deviceToken as string | undefined
      if (deviceToken && typeof deviceToken === 'string') {
        // 1a: Check Terminal table (register, PAX, handheld)
        const terminal = await db.terminal.findFirst({
          where: { deviceToken, deletedAt: null },
          select: { id: true, locationId: true, name: true, platform: true, cfdTerminalId: true },
        })
        if (terminal) {
          socket.data.terminalId = terminal.id
          socket.data.terminalName = terminal.name
          socket.data.platform = terminal.platform
          socket.data.locationId = terminal.locationId
          socket.data.authenticated = true
          socket.data.cfdTerminalId = terminal.cfdTerminalId ?? null
          return next()
        }

        // 1b: Check KDSScreen table (native KDS tablets)
        const kdsScreen = await db.kDSScreen.findFirst({
          where: { deviceToken, deletedAt: null, isActive: true },
          select: { id: true, locationId: true, name: true, screenType: true },
        })
        if (kdsScreen) {
          socket.data.terminalId = `kds-${kdsScreen.id}`
          socket.data.terminalName = kdsScreen.name
          // Check for cellular terminal connecting through KDS path:
          // Cellular devices send x-cellular-terminal header or cellularToken auth param.
          // They should be identified as ANDROID, not KDS.
          const isCellular =
            socket.handshake.headers?.['x-cellular-terminal'] === 'true' ||
            !!socket.handshake.auth?.cellularToken
          socket.data.platform = isCellular ? 'ANDROID' : 'kds'
          socket.data.locationId = kdsScreen.locationId
          socket.data.authenticated = true
          socket.data.kdsScreenId = kdsScreen.id
          socket.data.kdsScreenType = kdsScreen.screenType
          if (isCellular) {
            log.info({ terminalId: kdsScreen.id, locationId: kdsScreen.locationId }, 'Cellular terminal authenticated via KDS path — platform set to ANDROID')
          }
          return next()
        }

        return next(new Error('Invalid device token'))
      }

      // Path 2: POS session cookie (browser terminals)
      const cookieHeader = socket.handshake.headers?.cookie
      if (cookieHeader) {
        const cookies = cookieHeader.split(';').reduce<Record<string, string>>((acc, c) => {
          const [k, ...v] = c.trim().split('=')
          if (k) acc[k] = v.join('=')
          return acc
        }, {})
        const token = cookies[POS_SESSION_COOKIE]
        if (token) {
          const session = await verifySessionToken(token)
          if (session) {
            socket.data.employeeId = session.employeeId
            socket.data.locationId = session.locationId
            socket.data.authenticated = true
            return next()
          }
        }
      }

      // Path 3: NUC local network — trust LAN connections but track identity
      if (process.env.POS_LOCATION_ID || process.env.LOCATION_ID) {
        const lanLocationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID || ''
        socket.data.locationId = lanLocationId
        socket.data.authenticated = true
        // Track identity from handshake auth if provided
        const authTerminalId = socket.handshake.auth?.terminalId as string | undefined
        const authEmployeeId = socket.handshake.auth?.employeeId as string | undefined
        if (authTerminalId) {
          // Validate that the claimed terminalId exists for this location
          const terminal = await db.terminal.findFirst({
            where: { id: authTerminalId, locationId: lanLocationId, deletedAt: null },
            select: { id: true },
          })
          if (!terminal) {
            return next(new Error('Unknown terminal'))
          }
          socket.data.terminalId = authTerminalId
        }
        if (authEmployeeId) socket.data.employeeId = authEmployeeId
        if (!authTerminalId && !authEmployeeId) {
          log.warn(`Path 3 LAN connection without identity (no terminalId/employeeId) from ${socket.handshake.address} — allowing but untracked`)
        }
        return next()
      }

      // Path 4: Development mode — still require location context but allow without credentials
      // SECURITY: Auth is enforced in ALL environments. Dev mode only relaxes credential requirement
      // but still binds the socket to a valid location for room isolation.
      if (process.env.NODE_ENV !== 'production') {
        try {
          const loc = await db.location.findFirst({ select: { id: true } })
          if (loc) {
            socket.data.locationId = loc.id
            socket.data.authenticated = true
            socket.data.devMode = true
            return next()
          }
        } catch { /* DB not ready yet */ }
        // No location found — reject even in dev
        return next(new Error('No location configured — cannot authenticate socket'))
      }

      return next(new Error('Authentication required'))
    } catch (err) {
      log.error({ err }, 'Auth middleware error')
      return next(new Error('Authentication error'))
    }
  })

  socketServer.on('connection', (socket: Socket) => {
    const clientIp = socket.handshake.address
    if (process.env.DEBUG_SOCKETS) log.debug(`New connection from ${clientIp} (${socket.id}) authenticated=${socket.data.authenticated}`)

    // If device token auth happened in middleware, join location room
    if (socket.data.terminalId && socket.data.locationId) {
      socket.join(`location:${socket.data.locationId}`)
      // Cache CFD→register reverse mapping for relay without DB lookups
      if (socket.data.cfdTerminalId) {
        setCfdMapping(socket.data.cfdTerminalId, socket.data.terminalId)
      }
      if (process.env.DEBUG_SOCKETS) log.debug(`Native client authenticated: ${socket.data.terminalName} (${socket.data.platform})`)
    }

    // Auto-join location room from handshake query (used by SocketEventProvider)
    const queryLocationId = socket.handshake.query?.locationId as string | undefined
    const serverLocationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
    if (queryLocationId && typeof queryLocationId === 'string' && queryLocationId.length > 0) {
      if (serverLocationId && queryLocationId !== serverLocationId) {
        log.warn(`Rejected location join: client sent ${queryLocationId}, server expects ${serverLocationId}`)
        socket.disconnect(true)
        return
      }
      // Store authenticated locationId on socket for later validation
      if (!socket.data.locationId) socket.data.locationId = queryLocationId
      socket.join(`location:${queryLocationId}`)
      if (process.env.DEBUG_SOCKETS) log.debug(`Auto-joined location:${queryLocationId} from query`)
    }

    // Valid room prefixes for subscribe
    const ALLOWED_ROOM_PREFIXES = ['location:', 'tag:', 'terminal:', 'station:', 'scale:']

    // Per-socket room tracking for rate limiting (max 50 rooms)
    const MAX_ROOMS_PER_SOCKET = 50
    if (!socket.data.joinedRooms) socket.data.joinedRooms = new Set<string>()

    // Handle channel subscribe/unsubscribe from SocketEventProvider
    socket.on('subscribe', (channelName: string) => {
      try {
        if (!checkSocketRateLimit(socket.id)) {
          socket.emit('rate_limited', { message: 'Too many events per second', event: 'subscribe' })
          return
        }
        if (typeof channelName !== 'string' || !ALLOWED_ROOM_PREFIXES.some(p => channelName.startsWith(p))) {
          log.warn(`Rejected subscribe to invalid room: ${channelName}`)
          return
        }
        // Rate limit: max rooms per socket
        const joinedRooms = socket.data.joinedRooms as Set<string>
        if (!joinedRooms.has(channelName) && joinedRooms.size >= MAX_ROOMS_PER_SOCKET) {
          log.warn(`Rejected subscribe — socket ${socket.id} at max rooms (${MAX_ROOMS_PER_SOCKET}): ${channelName}`)
          socket.emit('subscribe-error', { room: channelName, error: 'Maximum room limit reached' })
          return
        }
        // Validate location rooms against authenticated context
        if (channelName.startsWith('location:')) {
          const roomLocationId = channelName.slice('location:'.length)
          if (!socket.data.locationId) {
            log.warn(`Rejected subscribe: socket has no locationId, cannot join room ${channelName}`)
            return  // Don't join, don't auto-adopt
          } else if (roomLocationId !== socket.data.locationId) {
            log.warn(`Rejected cross-location subscribe: socket bound to ${socket.data.locationId}, tried ${roomLocationId}`)
            return
          }
        }
        socket.join(channelName)
        joinedRooms.add(channelName)
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'subscribe handler error')
      }
    })
    socket.on('unsubscribe', (channelName: string) => {
      try {
        socket.leave(channelName)
        ;(socket.data.joinedRooms as Set<string>)?.delete(channelName)
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'unsubscribe handler error')
      }
    })

    // QoS 1: client sends ack with ackId after receiving critical events
    // Per-socket tracking: pass socket.id so each client acks independently
    socket.on('ack', (ackPayload: { ackId: string }) => {
      try {
        if (ackPayload?.ackId) {
          ackQueueAcknowledge(ackPayload.ackId, socket.id)
        }
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'ack handler error')
      }
    })

    // ==================== Room Management ====================

    /**
     * Join station rooms based on terminal identity
     * Called when a KDS/terminal starts up
     */
    socket.on('join_station', async ({ locationId, tags, terminalId, stationId }: JoinStationPayload, ackCallback?: (data: unknown) => void) => {
      try {
        // Helper: respond via ack callback (if client sent one) AND emit event (for older clients)
        const ack = (data: Record<string, unknown>) => {
          if (typeof ackCallback === 'function') ackCallback(data)
          socket.emit('joined', data)
        }

        // Validate locationId against authenticated context
        if (socket.data.locationId && locationId !== socket.data.locationId) {
          log.warn(`Rejected join_station: socket bound to ${socket.data.locationId}, payload says ${locationId}`)
          ack({ success: false, error: 'Location mismatch' })
          return
        }

        // Validate that the terminal/KDS screen belongs to this location
        const effectiveLocationId = socket.data.locationId || locationId
        if (terminalId.startsWith('kds-')) {
          // KDS screens live in the KDSScreen table — strip the 'kds-' prefix for lookup
          const kdsId = terminalId.slice(4)
          const validKds = await db.kDSScreen.findFirst({
            where: { id: kdsId, locationId: effectiveLocationId, deletedAt: null, isActive: true },
            select: { id: true },
          })
          if (!validKds) {
            log.warn(`Rejected join_station: KDS screen ${kdsId} not found in location ${effectiveLocationId}`)
            ack({ success: false, error: 'KDS screen not found in this location' })
            return
          }
        } else {
          const validTerminal = await db.terminal.findFirst({
            where: { id: terminalId, locationId: effectiveLocationId, deletedAt: null },
            select: { id: true },
          })
          if (!validTerminal) {
            log.warn(`Rejected join_station: terminal ${terminalId} not found in location ${effectiveLocationId}`)
            ack({ success: false, error: 'Terminal not found in this location' })
            return
          }
        }

        // Join location room (global alerts)
        socket.join(`location:${locationId}`)

        // Join terminal-specific room (direct messages)
        socket.join(`terminal:${terminalId}`)

        // Subscribe to specific prep tags (pizza, bar, kitchen, expo)
        // Location-scoped: tag:{locationId}:{tagName} for multi-venue isolation
        // Cap at 20 tags to prevent a client from exhausting the room limit
        const safeTags = Array.isArray(tags) ? tags.slice(0, 20) : []
        safeTags.forEach((tag: string) => {
          if (typeof tag === 'string' && tag.length > 0 && tag.length <= 50) {
            socket.join(`tag:${locationId}:${tag}`)
          }
        })

        // If station-specific, join that room too
        if (stationId) {
          socket.join(`station:${stationId}`)
        }

        // Clean up any previous entry for this socket (reconnection with new terminalId)
        // O(1) via reverse index
        const previousTerminalId = socketToTerminal.get(socket.id)
        if (previousTerminalId) {
          connectedTerminals.delete(previousTerminalId)
          socketToTerminal.delete(socket.id)
        }

        // Clean up any existing entry with the same terminalId from a different socket
        // (stale socket that disconnected without cleanup, or duplicate connection)
        const existing = connectedTerminals.get(terminalId)
        if (existing && existing.socketId !== socket.id) {
          socketToTerminal.delete(existing.socketId)
          connectedTerminals.delete(terminalId)
        }

        // Store locationId on socket data for event handlers
        socket.data.locationId = locationId

        // Track connection (both maps)
        connectedTerminals.set(terminalId, {
          socketId: socket.id,
          locationId,
          tags,
          connectedAt: new Date(),
        })
        socketToTerminal.set(socket.id, terminalId)

        if (process.env.DEBUG_SOCKETS) log.debug({ terminalId, location: `location:${locationId}`, tags: tags.map(t => `tag:${locationId}:${t}`), station: stationId ? `station:${stationId}` : null }, 'Terminal joined rooms')

        // Acknowledge successful join — include latestEventId for catch-up baseline
        ack({ success: true, rooms: socket.rooms.size, latestEventId: await getLatestEventId(locationId) })

        // Mark terminal online on (re)connection — fire-and-forget
        recordReconnection()
        void markTerminalOnline(terminalId, locationId)
      } catch (err) {
        log.error({ err, socketId: socket.id, terminalId }, 'join_station handler error')
      }
    })

    /**
     * Leave station rooms (cleanup)
     */
    socket.on('leave_station', ({ terminalId }: { terminalId: string }) => {
      try {
        const info = connectedTerminals.get(terminalId)
        if (info) socketToTerminal.delete(info.socketId)
        connectedTerminals.delete(terminalId)
        // Socket.io automatically cleans up room memberships on disconnect
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'leave_station handler error')
      }
    })

    // ==================== Version Handshake ====================

    /**
     * Client reports its app version after connect/reconnect.
     * Enables the server to track stale clients needing refresh.
     */
    socket.on('client:version', (data: { clientVersion?: string }) => {
      try {
        if (data?.clientVersion && typeof data.clientVersion === 'string') {
          // O(1) via reverse index
          const tid = socketToTerminal.get(socket.id)
          if (tid) {
            const info = connectedTerminals.get(tid)
            if (info) info.clientVersion = data.clientVersion
          }
        }
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'client:version handler error')
      }
    })

    // ==================== Reconnection Catch-Up ====================

    /**
     * Client sends catch-up request after reconnecting with last known eventId.
     * Server replays all buffered events since that eventId that match the
     * client's subscribed rooms.
     */
    socket.on('catch-up', async ({ lastEventId, locationId: catchUpLocationId }: { lastEventId: number; locationId: string }) => {
      try {
        if (!checkSocketRateLimit(socket.id)) {
          socket.emit('rate_limited', { message: 'Too many events per second', event: 'catch-up' })
          return
        }
        if (typeof lastEventId !== 'number' || lastEventId < 0) return
        if (typeof catchUpLocationId !== 'string' || !catchUpLocationId) return

        // Validate locationId matches socket's authenticated context
        if (socket.data.locationId && catchUpLocationId !== socket.data.locationId) {
          log.warn(`catch-up rejected: socket bound to ${socket.data.locationId}, requested ${catchUpLocationId}`)
          return
        }

        // Reconnection storm protection: limit concurrent catch-up queries
        // to prevent connection pool exhaustion when many terminals reconnect at once
        if (activeCatchUpCount >= MAX_CONCURRENT_CATCHUP) {
          socket.emit('catch-up-delayed', { retryAfterMs: 2000 })
          return
        }
        activeCatchUpCount++

        try {
          // Get the rooms this socket is currently subscribed to
          const subscribedRooms = Array.from(socket.rooms).filter(
            r => r !== socket.id // Exclude the socket's own room
          )

          const missedEvents = await getEventsSince(catchUpLocationId, lastEventId, subscribedRooms)

          if (missedEvents.length > 0) {
            // Deduplicate: for list-changed events, only send the latest of each type.
            // For item-specific events (payment, order-specific, kds orders), send ALL.
            // IMPORTANT: kds:order-received MUST NOT be deduplicated — each order is unique
            // and must reach the kitchen. Deduping would silently drop orders during reconnect.
            const DEDUP_EVENT_TYPES = new Set([
              'orders:list-changed', 'tab:updated', 'floor-plan:updated',
              'terminal:status_changed',
            ])
            const latestByType = new Map<string, typeof missedEvents[0]>()
            const directEvents: typeof missedEvents = []

            for (const evt of missedEvents) {
              if (DEDUP_EVENT_TYPES.has(evt.event)) {
                latestByType.set(evt.event, evt)
              } else {
                directEvents.push(evt)
              }
            }

            const dedupedCount = missedEvents.length - directEvents.length - latestByType.size
            if (process.env.DEBUG_SOCKETS) log.debug(`Catch-up: replaying ${directEvents.length + latestByType.size} events to ${socket.id} (since eid=${lastEventId}, deduped ${dedupedCount})`)

            // Send non-deduplicatable events first (order-specific, payment, etc.)
            for (const evt of directEvents) {
              socket.emit(evt.event, evt.data)
            }
            // Send deduplicated events (only latest of each type)
            for (const evt of latestByType.values()) {
              socket.emit(evt.event, evt.data)
            }
          }
        } finally {
          activeCatchUpCount--
        }
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'catch-up handler error')
      }
    })

    // ==================== Order Editing Awareness ====================

    /**
     * Relay order editing events to the location room.
     * When a terminal opens an order, it emits `order:editing` — we broadcast
     * to the location room so other terminals can show a conflict banner.
     */
    socket.on('order:editing', (data: { orderId: string; terminalId: string; terminalName: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) {
          log.warn(`order:editing rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        if (typeof data.orderId === 'string') {
          socketServer.to(`location:${locationId}`).except(socket.id).emit('order:editing', {
            orderId: data.orderId,
            terminalId: data.terminalId,
            terminalName: data.terminalName,
          })
        }
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'order:editing handler error')
      }
    })

    socket.on('order:editing-released', (data: { orderId: string; terminalId: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) {
          log.warn(`order:editing-released rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        if (typeof data.orderId === 'string') {
          socketServer.to(`location:${locationId}`).except(socket.id).emit('order:editing-released', {
            orderId: data.orderId,
            terminalId: data.terminalId,
          })
        }
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'order:editing-released handler error')
      }
    })

    // ==================== Mobile Tab Relay ====================

    // Phone → server processes tab close, emits result back to sender + location room
    // Validates employee owns the tab or has permission, calls close-tab API logic,
    // broadcasts tab:closed + orders:list-changed to location room (for POS terminals + mobile clients)
    socket.on(MOBILE_EVENTS.TAB_CLOSE_REQUEST, (data: { orderId: string; employeeId: string; tipMode: string }) => {
      const locationId = socket.data.locationId
      if (!locationId) return
      const { orderId, employeeId, tipMode } = data
      if (!orderId || !employeeId) {
        const response = { orderId, success: false, amount: 0, error: 'Missing orderId or employeeId' }
        socket.emit(MOBILE_EVENTS.TAB_CLOSED, response)
        void emitToLocation(locationId, MOBILE_EVENTS.TAB_CLOSED, response).catch(err => log.error({ err }, 'Failed to broadcast TAB_CLOSED'))
        return
      }

      // Dedup: skip if there's already a pending close for this orderId within 30s
      const pendingTs = pendingTabCloses.get(orderId)
      if (pendingTs && Date.now() - pendingTs < 30_000) {
        log.info({ orderId, socketId: socket.id }, 'Duplicate tab close request ignored — already in progress')
        return
      }
      pendingTabCloses.set(orderId, Date.now())

      // NOTE: Uses HTTP loopback to reuse close-tab API logic including Datacap interaction.
      // The 30s timeout is appropriate for hardware payment processing.
      // Future optimization: extract close-tab business logic into a shared function.
      const port = parseInt(process.env.PORT || '3005', 10)
      void fetch(`http://127.0.0.1:${port}/api/orders/${orderId}/close-tab`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-venue-slug': process.env.POS_VENUE_SLUG || 'default',
        },
        body: JSON.stringify({ employeeId, tipMode }),
        signal: AbortSignal.timeout(30_000), // Datacap can take time
      }).then(async (res) => {
        pendingTabCloses.delete(orderId)
        const json = await res.json().catch(() => ({}))
        if (res.ok && json.data?.success) {
          // Broadcast to location room (all POS terminals + mobile clients)
          const payload = {
            orderId,
            success: true,
            amount: json.data.captured?.totalAmount ?? 0,
            tipAmount: json.data.captured?.tipAmount ?? 0,
          }
          socket.emit(MOBILE_EVENTS.TAB_CLOSED, payload)
          void emitToLocation(locationId, MOBILE_EVENTS.TAB_CLOSED, payload).catch(err => log.error({ err }, 'Failed to broadcast TAB_CLOSED'))

          // Notify all terminals to refresh order list
          void emitToLocation(locationId, 'orders:list-changed', {
            trigger: 'paid',
            orderId,
          }).catch(err => log.error({ err }, 'Failed to broadcast orders:list-changed'))
        } else {
          const payload = {
            orderId,
            success: false,
            amount: 0,
            error: json.data?.error?.message || json.error || 'Close tab failed',
          }
          socket.emit(MOBILE_EVENTS.TAB_CLOSED, payload)
          void emitToLocation(locationId, MOBILE_EVENTS.TAB_CLOSED, payload).catch(err => log.error({ err }, 'Failed to broadcast TAB_CLOSED'))
        }
      }).catch((err: unknown) => {
        pendingTabCloses.delete(orderId)
        log.error({ err }, 'tab:close-request internal call failed')
        const payload = { orderId, success: false, amount: 0, error: 'Failed to close tab' }
        socket.emit(MOBILE_EVENTS.TAB_CLOSED, payload)
        void emitToLocation(locationId, MOBILE_EVENTS.TAB_CLOSED, payload).catch(e => log.error({ err: e }, 'Failed to broadcast TAB_CLOSED'))
      })
    })

    // Phone → server processes tab transfer
    // Validates target employee exists at location, updates order assignment, emits tab:updated + orders:list-changed
    // DB update + event emission must both succeed before confirming to client.
    // emitOrderEvent is awaited (not fire-and-forget) to satisfy the event-sourced
    // order invariant: NEVER write to db.order without emitting events.
    socket.on(MOBILE_EVENTS.TAB_TRANSFER_REQUEST, async (data: { orderId: string; employeeId: string }) => {
      const locationId = socket.data.locationId
      if (!locationId) return
      const { orderId, employeeId } = data
      if (!orderId || !employeeId) return

      try {
        // Validate target employee exists at this location
        const targetEmployee = await db.employee.findFirst({
          where: {
            id: employeeId,
            locationId,
            deletedAt: null,
          },
          select: { id: true, firstName: true, lastName: true },
        })
        if (!targetEmployee) {
          log.warn({ orderId, employeeId, locationId }, 'tab:transfer-request rejected — target employee not found at location')
          const payload = { orderId, message: 'Target employee not found at this location' }
          socket.emit('tab:error', payload)
          void emitToLocation(locationId, 'tab:error', payload).catch(err => log.error({ err }, 'Failed to broadcast tab:error'))
          return
        }

        // Update order assignment
        await db.order.update({
          where: { id: orderId },
          data: { employeeId },
        })

        // Emit order event BEFORE confirming success (must succeed for event consistency)
        await emitOrderEvent(locationId, orderId, 'ORDER_METADATA_UPDATED', { employeeId })

        // Notify sender of completion
        socket.emit('tab:transfer-complete', { orderId })

        // Notify all terminals in location room (POS terminals + other mobile clients)
        void emitToLocation(locationId, 'tab:transfer-complete', { orderId }).catch(err => log.error({ err }, 'Failed to broadcast tab:transfer-complete'))

        // Notify all terminals to refresh order list
        void emitToLocation(locationId, 'orders:list-changed', {
          trigger: 'transferred',
          orderId,
        }).catch(err => log.error({ err }, 'Failed to broadcast orders:list-changed after transfer'))

        // Also emit tab:updated for consistency
        void emitToLocation(locationId, 'tab:updated', { orderId }).catch(err => log.error({ err }, 'Failed to broadcast tab:updated after transfer'))
      } catch (err) {
        log.error({ err }, 'tab:transfer-request failed')
        const payload = { orderId, message: 'Failed to transfer tab' }
        socket.emit('tab:error', payload)
        void emitToLocation(locationId, 'tab:error', payload).catch(e => log.error({ err: e }, 'Failed to broadcast tab:error'))
      }
    })

    // Phone → relay manager alert to all terminals in location (fire-and-forget)
    // Broadcasts to both POS terminals and other mobile clients
    socket.on(MOBILE_EVENTS.TAB_ALERT_MANAGER, (data: { orderId: string; employeeId: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) return

        // Broadcast manager alert to location room (POS terminals can display toast/modal)
        void emitToLocation(locationId, 'tab:manager-alert', { ...data, locationId }).catch(err => log.error({ err }, 'Failed to broadcast tab:manager-alert'))
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'TAB_ALERT_MANAGER handler error')
      }
    })

    // ==================== Pay-at-Table Relay ====================

    /**
     * iPad → POS: Relay pay-at-table payment request to all terminals in the location.
     * Any POS terminal with the order open can pick it up.
     */
    socket.on(PAT_EVENTS.PAY_REQUEST, (data: { orderId: string; readerId: string; tipMode: string; employeeId: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) {
          log.warn(`pat:pay-request rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        if (typeof data.orderId !== 'string' || !data.orderId) return
        if (process.env.DEBUG_SOCKETS) log.debug(`pat:pay-request relay: order ${data.orderId} → location:${locationId}`)
        socketServer.to(`location:${locationId}`).except(socket.id).emit(PAT_EVENTS.PAY_REQUEST, data)
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'pat:pay-request handler error')
      }
    })

    /**
     * POS → iPad: Relay payment result back to all clients in the location.
     * The iPad filters by orderId on the client side.
     */
    socket.on(PAT_EVENTS.PAY_RESULT, (data: { orderId: string; success: boolean; amount: number; tipAmount?: number; cardLast4?: string; error?: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) {
          log.warn(`pat:pay-result rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        if (typeof data.orderId !== 'string' || !data.orderId) return
        if (process.env.DEBUG_SOCKETS) log.debug(`pat:pay-result relay: order ${data.orderId} success=${data.success} → location:${locationId}`)
        socketServer.to(`location:${locationId}`).except(socket.id).emit(PAT_EVENTS.PAY_RESULT, data)
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'pat:pay-result handler error')
      }
    })

    // ==================== Direct Terminal Messages ====================

    /**
     * Send message to specific terminal.
     * Validates: sender has an authenticated location, target terminal belongs to the
     * same location, and the relayed event name is on the allow-list.
     */
    const TERMINAL_MESSAGE_ALLOWED_EVENTS = new Set([
      'sync:completed',
      'order:editing',
      'order:editing-released',
      'kds:bump',
      'kds:recall',
      'terminal:payment_request',
      'terminal:payment_complete',
    ])

    socket.on('terminal_message', ({ terminalId, event, data }: {
      terminalId: string
      event: string
      data: unknown
    }) => {
      try {
        // Rate limit check
        if (!checkSocketRateLimit(socket.id)) {
          socket.emit('rate_limited', { message: 'Too many events per second', event: 'terminal_message' })
          return
        }

        // Require authenticated locationId on sender
        const senderLocationId = socket.data.locationId
        if (!senderLocationId) {
          log.warn(`terminal_message rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }

        // Validate event name against allow-list
        if (!TERMINAL_MESSAGE_ALLOWED_EVENTS.has(event)) {
          log.warn(`terminal_message rejected — event "${event}" not in allow-list (socket ${socket.id})`)
          return
        }

        // Validate target terminal belongs to the same location
        const targetInfo = connectedTerminals.get(terminalId)
        if (targetInfo && targetInfo.locationId !== senderLocationId) {
          log.warn(`terminal_message rejected — cross-location: sender ${senderLocationId}, target ${targetInfo.locationId}`)
          return
        }

        // If target terminal not in connectedTerminals map (e.g., browser-only terminal),
        // still emit but only if it's in the sender's location room
        if (!targetInfo) {
          // Emit to intersection of terminal room and location room for safety
          socketServer.to(`terminal:${terminalId}`).except(socket.id).emit(event, data)
        } else {
          socketServer.to(`terminal:${terminalId}`).emit(event, data)
        }
      } catch (err) {
        log.error({ err, socketId: socket.id, targetTerminal: terminalId }, 'terminal_message handler error')
      }
    })

    // ==================== Sync Events ====================

    /**
     * Sync completed notification
     */
    socket.on('sync_completed', ({ terminalId, stats }: {
      terminalId: string
      stats: { pushed: number; pulled: number; conflicts: number }
    }) => {
      try {
        socketServer.to(`terminal:${terminalId}`).emit('sync:completed', stats)
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'sync_completed handler error')
      }
    })

    // ==================== CFD Relay ====================

    // Register → CFD: relay payment flow events to the paired CFD display.
    // These events come FROM the register (Android app) and must reach the A3700 terminal.
    const CFD_REGISTER_TO_CFD_EVENTS = [
      'cfd:payment-started',
      'cfd:tip-prompt',
      'cfd:processing',
      'cfd:approved',
      'cfd:declined',
      'cfd:idle',
      'cfd:charge-card',
      'cfd:cancel-charge',
    ]
    for (const cfdEvent of CFD_REGISTER_TO_CFD_EVENTS) {
      socket.on(cfdEvent, (data: unknown) => {
        try {
          const cfdTerminalId = socket.data.cfdTerminalId as string | null | undefined
          if (!cfdTerminalId) return
          void emitToTerminal(cfdTerminalId, cfdEvent, data)
        } catch (err) {
          log.error({ err, socketId: socket.id, event: cfdEvent }, 'CFD register-to-cfd relay error')
        }
      })
    }

    // CFD → Register: relay customer responses back to the paired register.
    // These events come FROM the A3700 CFD and must reach the register terminal.
    // Uses cached cfdToRegisterMap first; falls back to DB lookup if cache misses.
    const CFD_TO_REGISTER_EVENTS = [
      'cfd:tip-selected',
      'cfd:signature-done',
      'cfd:receipt-choice',
      'cfd:charge-result',
      'cfd:reader-status',
    ]
    for (const cfdEvent of CFD_TO_REGISTER_EVENTS) {
      socket.on(cfdEvent, (data: unknown) => {
        try {
          const myTerminalId = socket.data.terminalId as string | undefined
          if (!myTerminalId) return

          // Try cached mapping first (no DB query needed)
          const cachedRegisterId = cfdToRegisterMap.get(myTerminalId)
          if (cachedRegisterId) {
            // Check if the target register is online (has sockets in its terminal room)
            const room = `terminal:${cachedRegisterId}`
            const roomSockets = globalForSocket.socketServer?.sockets.adapter.rooms.get(room)
            if (!roomSockets || roomSockets.size === 0) {
              socket.emit('cfd:error', { event: cfdEvent, error: 'Paired register is offline' })
              return
            }
            void emitToTerminal(cachedRegisterId, cfdEvent, data)
            return
          }

          // Cache miss — fall back to DB lookup with 5s timeout
          void Promise.race([
            db.terminal.findFirst({
              where: { cfdTerminalId: myTerminalId, deletedAt: null },
              select: { id: true },
            }),
            new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error('CFD-to-register DB lookup timed out (5s)')), 5000)
            ),
          ]).then(register => {
            if (!register) {
              socket.emit('cfd:error', { event: cfdEvent, error: 'No paired register found' })
              return
            }
            // Populate cache for future relays
            setCfdMapping(myTerminalId, register.id)
            // Check if the target register is online
            const room = `terminal:${register.id}`
            const roomSockets = globalForSocket.socketServer?.sockets.adapter.rooms.get(room)
            if (!roomSockets || roomSockets.size === 0) {
              socket.emit('cfd:error', { event: cfdEvent, error: 'Paired register is offline' })
              return
            }
            void emitToTerminal(register.id, cfdEvent, data)
          }).catch((err: unknown) => {
            log.error({ err, event: cfdEvent }, 'CFD-to-register lookup failed')
            socket.emit('cfd:error', { event: cfdEvent, error: 'Register lookup failed' })
          })
        } catch (err) {
          log.error({ err, socketId: socket.id, event: cfdEvent }, 'CFD cfd-to-register relay error')
        }
      })
    }

    // ==================== Handheld Payment Relay ====================

    // Handheld → Kiosk: route a payment request to a specific target terminal
    socket.on('terminal:payment_request', (data: {
      orderId: string
      targetTerminalId: string
      fromTerminalId: string
      totalCents: number
      tipSuggestions: number[]
      items: unknown[]
    }) => {
      try {
        const senderLocationId = socket.data.locationId
        if (!senderLocationId) {
          log.warn(`terminal:payment_request rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        void emitToTerminal(data.targetTerminalId, 'terminal:payment_request', data)
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'terminal:payment_request handler error')
      }
    })

    // Kiosk → Handheld: route payment completion back to the originating terminal
    socket.on('terminal:payment_complete', (data: {
      orderId: string
      fromTerminalId: string
      toTerminalId: string
      approvedAmountCents: number
      tipCents: number
      success: boolean
      declineReason?: string
    }) => {
      try {
        const senderLocationId = socket.data.locationId
        if (!senderLocationId) {
          log.warn(`terminal:payment_complete rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        void emitToTerminal(data.toTerminalId, 'terminal:payment_complete', data)
      } catch (err) {
        log.error({ err, socketId: socket.id }, 'terminal:payment_complete handler error')
      }
    })

    // ==================== Connection Lifecycle ====================

    socket.on('disconnect', (reason: string) => {
      const sid = socket.id
      // Path A: browser/KDS terminals registered via join_station — O(1) via reverse index
      let handled = false
      try {
        const terminalId = socketToTerminal.get(sid)
        if (terminalId) {
          const info = connectedTerminals.get(terminalId)
          connectedTerminals.delete(terminalId)
          socketToTerminal.delete(sid)
          log.info({ terminalId, reason, socketId: sid }, 'terminal disconnected (station)')
          if (info) {
            void markTerminalOffline(terminalId, info.locationId, reason, sid).catch((err) =>
              log.warn({ err, terminalId, socketId: sid }, 'markTerminalOffline failed (station path)'))
          }
          handled = true
        }
      } catch (err) {
        log.error({ err, socketId: sid }, 'disconnect cleanup failed (station path)')
      }

      // Path B: Android native — auth middleware sets socket.data.terminalId
      try {
        if (!handled && socket.data.terminalId && socket.data.locationId) {
          log.info({ terminalId: socket.data.terminalId, reason, socketId: sid }, 'terminal disconnected (android)')
          void markTerminalOffline(socket.data.terminalId, socket.data.locationId, reason, sid).catch((err) =>
            log.warn({ err, terminalId: socket.data.terminalId, socketId: sid }, 'markTerminalOffline failed (android path)'))
        }
      } catch (err) {
        log.error({ err, socketId: sid }, 'disconnect cleanup failed (android path)')
      }

      // Clean up CFD→register cache when register disconnects
      try {
        if (socket.data.cfdTerminalId) {
          const cfdId = socket.data.cfdTerminalId
          // Emit idle to paired CFD so it doesn't show stale order
          void emitToTerminal(cfdId, 'cfd:idle', {}).catch((err) =>
            log.warn({ err, cfdId }, 'Failed to send cfd:idle on register disconnect'))
          cfdToRegisterMap.delete(cfdId)
          log.info({ cfdId, registerId: socket.data.terminalId }, 'Sent cfd:idle on register disconnect')
        }
      } catch (err) {
        log.error({ err, socketId: sid }, 'disconnect cleanup failed (CFD cache)')
      }

      // Remove from QoS 1 per-client ack tracking — this socket can't ack after
      // disconnecting. It will receive missed events via catch-up on reconnect.
      try {
        removeSocketFromAcks(sid)
      } catch (err) {
        log.error({ err, socketId: sid }, 'disconnect cleanup failed (ack tracking)')
      }
    })

    socket.on('error', (error: Error) => {
      log.error({ err: error, socketId: socket.id }, 'socket error')
    })
  })

  // Periodic status logging
  const statusLogTimer = setInterval(() => {
    const stats = {
      connections: socketServer.engine.clientsCount,
      terminals: connectedTerminals.size,
      rooms: socketServer.sockets.adapter.rooms.size,
    }
    if (stats.connections > 0) {
      if (process.env.DEBUG_SOCKETS) log.debug(stats, 'Socket status')
    }
  }, 60000) // Every minute
  statusLogTimer.unref()

  // Periodic cleanup of stale terminal entries (every 60 seconds)
  const staleCleanupTimer = setInterval(() => {
    let cleaned = 0
    for (const [terminalId, info] of connectedTerminals.entries()) {
      // Check if the socket is still connected
      const socket = socketServer.sockets.sockets.get(info.socketId)
      if (!socket || !socket.connected) {
        connectedTerminals.delete(terminalId)
        socketToTerminal.delete(info.socketId)
        cleaned++
      }
    }
    if (cleaned > 0) {
      if (process.env.DEBUG_SOCKETS) log.debug(`Cleaned ${cleaned} stale terminal entries`)
    }
  }, 60_000) // Every 60 seconds
  staleCleanupTimer.unref()

  // Periodic cleanup of stale rate limit entries (every 30 seconds)
  const rateLimitCleanupTimer = setInterval(cleanupRateLimits, 30_000)
  rateLimitCleanupTimer.unref()

  // NOTE: Redundant 60s stale-terminal sweep removed (2026-03-09).
  // Socket disconnect events (line ~653) already mark terminals offline immediately
  // via markTerminalOffline(). The DB-polling sweep was a slower, redundant fallback
  // that added unnecessary DB queries every 60s and delayed offline detection vs
  // the authoritative socket disconnect handler.

  // Retry unacknowledged critical events every 2 seconds (QoS 1)
  // Per-client tracking: retries target only sockets that haven't acked,
  // not the entire room. This prevents fast Terminal A from masking
  // missed delivery to Terminal B.
  setInterval(() => {
    const retryable = getRetryableEvents()
    for (const pending of retryable) {
      try {
        const payload = {
          ...(typeof pending.data === 'object' && pending.data !== null ? pending.data : {}),
          _ackId: pending.ackId,
          _retry: pending.attempts,
        }

        if (pending.retrySocketIds.length > 0) {
          // Per-socket retry: only send to sockets that haven't acked
          for (const socketId of pending.retrySocketIds) {
            socketServer.to(socketId).emit(pending.event, payload)
          }
        } else {
          // Legacy fallback: retry to whole room
          socketServer.to(pending.room).emit(pending.event, payload)
        }

        markRetryAttempt(pending.ackId)
      } catch (err) {
        log.error({ err }, 'socket-ack retry emit failed')
      }
    }
  }, 2000)

  // Store in global so API routes can emit events (survives HMR)
  setSocketServer(socketServer)
  if (process.env.DEBUG_SOCKETS) log.debug('Server initialized and stored in globalThis')

  // Flush any unflushed socket events from a prior crash
  try {
    const { flushAllPendingOutbox } = await import('@/lib/socket-outbox')
    await flushAllPendingOutbox()
  } catch (err) {
    log.warn({ err }, 'Failed to flush pending outbox on startup')
  }

  return socketServer
}

/**
 * Get socket server instance (for API routes to emit events)
 * Uses globalThis to survive Next.js HMR in development (same pattern as Prisma client)
 */
export const globalForSocket = globalThis as unknown as {
  socketServer: SocketServer | undefined
}

export function setSocketServer(server: SocketServer): void {
  globalForSocket.socketServer = server
}

export function getSocketServer(): SocketServer | null {
  return globalForSocket.socketServer ?? null
}

/**
 * Emit event from API route (helper function)
 */
export async function emitToRoom(room: string, event: string, data: unknown): Promise<boolean> {
  recordMetricEvent()
  // Only buffer location: and tag: rooms (terminal/scale/station are device-specific, not replayable)
  const shouldBuffer = room.startsWith('location:') || room.startsWith('tag:')

  if (globalForSocket.socketServer) {
    if (shouldBuffer) {
      // Extract locationId from room name for buffer scoping
      let locationId: string | null = null
      if (room.startsWith('location:')) {
        locationId = room.slice('location:'.length)
      } else if (room.startsWith('tag:')) {
        // tag:{locationId}:{tagName}
        const parts = room.split(':')
        if (parts.length >= 2) locationId = parts[1]
      }
      if (locationId) {
        const eid = recordEvent(locationId, event, data, room)
        const enriched = data && typeof data === 'object' && !Array.isArray(data) ? { ...data as Record<string, unknown>, _eid: eid } : data
        globalForSocket.socketServer.to(room).emit(event, enriched)
        return true
      }
    }
    globalForSocket.socketServer.to(room).emit(event, data)
    return true
  }
  return emitViaIPC({ type: 'room', target: room, event, data })
}

/**
 * Emit to multiple tag rooms (for order routing)
 * Tags are location-scoped: tag:{locationId}:{tagName}
 */
export async function emitToTags(tags: string[], event: string, data: unknown, locationId?: string): Promise<boolean> {
  recordMetricEvent()
  // Build location-scoped room names: tag:{locationId}:{tagName}
  const rooms = tags.map(tag => locationId ? `tag:${locationId}:${tag}` : `tag:${tag}`)

  if (globalForSocket.socketServer) {
    rooms.forEach((room) => {
      // Extract locationId from room for buffer scoping
      const bufferLocationId = locationId || (room.startsWith('tag:') ? room.split(':')[1] : null)
      if (bufferLocationId) {
        const eid = recordEvent(bufferLocationId, event, data, room)
        const enriched = data && typeof data === 'object' && !Array.isArray(data) ? { ...data as Record<string, unknown>, _eid: eid } : data
        globalForSocket.socketServer!.to(room).emit(event, enriched)
      } else {
        globalForSocket.socketServer!.to(room).emit(event, data)
      }
    })
    // Relay to Neon for cellular terminals (fire-and-forget, sync — errors must not propagate)
    if (locationId) {
      try {
        const enriched = data && typeof data === 'object' && !Array.isArray(data) ? { ...data as Record<string, unknown> } : data
        relayCellularEvent(locationId, event, enriched)
      } catch (err) {
        log.error({ err, event, locationId }, 'Cellular event relay failed for tags')
      }
    }
    return true
  }
  // IPC path: send pre-scoped room names so the remote ws-server uses correct rooms
  return emitViaIPC({ type: 'tags', target: rooms, event, data })
}

/**
 * Emit to location room (global alerts)
 * @param locationId - The location identifier
 * @param event - The event name
 * @param data - The event payload
 * @param excludeSocketId - Optional socket ID to exclude from broadcast (prevents echo to sender)
 */
export async function emitToLocation(locationId: string, event: string, data: unknown, excludeSocketId?: string): Promise<boolean> {
  recordMetricEvent()
  if (globalForSocket.socketServer) {
    const room = `location:${locationId}`
    const roomSockets = globalForSocket.socketServer.sockets.adapter.rooms.get(room)
    if (process.env.DEBUG_SOCKETS) log.debug(`emitToLocation: ${event} → ${room} (${roomSockets?.size ?? 0} clients)`)
    // Record in buffer and inject _eid for client catch-up tracking
    const eid = recordEvent(locationId, event, data, room)
    const enriched = data && typeof data === 'object' && !Array.isArray(data) ? { ...data as Record<string, unknown>, _eid: eid } : data
    // Broadcast to room, optionally excluding the sender
    if (excludeSocketId) {
      globalForSocket.socketServer.to(room).except(excludeSocketId).emit(event, enriched)
    } else {
      globalForSocket.socketServer.to(room).emit(event, enriched)
    }
    // Relay to Neon for cellular terminals (fire-and-forget, sync — errors must not propagate)
    // TODO: Callers should handle retry on failure; consider adding to outbox/queue for reliability
    try {
      relayCellularEvent(locationId, event, enriched)
    } catch (err) {
      log.error({ err, event, locationId }, 'Cellular event relay failed')
    }
    return true
  }
  return emitViaIPC({ type: 'location', target: locationId, event, data })
}

/**
 * Emit a critical event that requires client acknowledgment (QoS 1).
 * The event includes an `_ackId` field. Client must emit `ack` with this ID.
 * If no ack within timeout, retries up to 3 times with exponential backoff.
 *
 * Used for financial events: payment:processed, order:closed.
 * Backward-compatible: old clients ignore `_ackId`, server stops retrying after timeout.
 */
export async function emitCriticalToLocation(
  locationId: string,
  event: string,
  data: unknown,
): Promise<void> {
  recordMetricEvent()
  const room = `location:${locationId}`

  // Get socket IDs in the room for per-client ack tracking.
  // Each socket must independently ack; retries target only un-acked sockets.
  let targetSocketIds: Set<string> | undefined
  if (globalForSocket.socketServer) {
    const roomSockets = globalForSocket.socketServer.sockets.adapter.rooms.get(room)
    if (roomSockets && roomSockets.size > 0) {
      targetSocketIds = new Set(roomSockets)
    }
  }

  const ackId = enqueueAck(locationId, room, event, data, targetSocketIds)
  const payload = {
    ...(typeof data === 'object' && data !== null ? data : {}),
    _ackId: ackId,
  }
  if (globalForSocket.socketServer) {
    if (process.env.DEBUG_SOCKETS) log.debug(`emitCriticalToLocation: ${event} -> ${room} (${targetSocketIds?.size ?? 0} clients) ackId=${ackId}`)
    // Also record in event buffer for catch-up
    const eid = recordEvent(locationId, event, payload, room)
    const enriched = { ...payload, _eid: eid }
    try {
      globalForSocket.socketServer.to(room).emit(event, enriched)
    } catch (err) {
      log.error({ err, event, room }, 'Critical emit failed — leaving in ack queue for retry')
      return  // Don't mark as sent — ack queue will retry
    }
    // Relay to Neon for cellular terminals (fire-and-forget, separate from critical emit)
    try {
      relayCellularEvent(locationId, event, enriched)
    } catch (err) {
      log.error({ err, event, locationId }, 'Cellular event relay failed')
    }
  } else {
    void emitViaIPC({ type: 'location', target: locationId, event, data: payload })
  }
}

/**
 * Emit to a specific terminal's room (for CFD events, pay-at-table, etc.)
 * Room name: terminal:{terminalId}
 */
export async function emitToTerminal(terminalId: string, event: string, data: unknown): Promise<boolean> {
  recordMetricEvent()
  const room = `terminal:${terminalId}`

  // Get locationId from terminal mapping if available, for event buffering and cellular relay
  const terminalInfo = connectedTerminals.get(terminalId)
  const locationId = terminalInfo?.locationId

  if (globalForSocket.socketServer) {
    if (process.env.DEBUG_SOCKETS) log.debug(`emitToTerminal: ${event} → ${room}`)

    // Buffer the event for catch-up if locationId is available
    let enriched = data
    if (locationId && typeof data === 'object' && data !== null) {
      const eid = recordEvent(locationId, event, data, room)
      enriched = { ...data, _eid: eid }
    }

    globalForSocket.socketServer.to(room).emit(event, enriched)

    // Relay to Neon for cellular terminals (fire-and-forget, separate from emit)
    if (locationId && enriched !== data) {
      try {
        relayCellularEvent(locationId, event, enriched)
      } catch (err) {
        log.error({ err, event, terminalId, locationId }, 'Cellular event relay failed for terminal')
      }
    }

    return true
  }
  return emitViaIPC({ type: 'room', target: room, event, data })
}

/**
 * Forcibly disconnect a terminal across the cluster.
 *
 * Used when a terminal is unpaired or revoked.
 *   1. Emits 'terminal:revoked' to the terminal's room (all nodes)
 *   2. Forcibly disconnects any local sockets for this terminal
 *   3. Triggers unpair cleanup on the client via the event
 *
 * @param terminalId  The ID of the terminal to revoke
 * @param reason      Optional reason for revocation (default 'Unpaired by admin')
 */
export async function revokeTerminal(terminalId: string, reason: string = 'Unpaired by admin'): Promise<void> {
  const room = `terminal:${terminalId}`
  const event = SOCKET_EVENTS.TERMINAL_REVOKED
  const payload: TerminalRevokedPayload = {
    terminalId,
    reason,
    revokedAt: new Date().toISOString(),
  }

  log.info({ terminalId, reason }, 'Revoking terminal across cluster')

  // ── 1. Emit revocation event (cluster-wide via IPC/Redis) ──
  // We use emitToTerminal which handles the local emit + IPC relay
  await emitToTerminal(terminalId, event, payload)

  // ── 2. Disconnect local sockets for this terminal ──
  if (globalForSocket.socketServer) {
    const sockets = await globalForSocket.socketServer.in(room).fetchSockets()
    for (const s of sockets) {
      log.debug({ socketId: s.id, terminalId }, 'Forcibly disconnecting revoked terminal socket')
      s.disconnect(true) // true = close underlying connection
    }
  }

  // ── 3. Cleanup local maps ──
  connectedTerminals.delete(terminalId)
}

/**
 * Get connected terminal count
 */
export function getConnectedTerminalCount(): number {
  return connectedTerminals.size
}

/**
 * Get terminals connected to specific tags
 */
export function getTerminalsForTags(tags: string[]): string[] {
  const terminals: string[] = []
  for (const [terminalId, info] of connectedTerminals.entries()) {
    if (tags.some(tag => info.tags.includes(tag))) {
      terminals.push(terminalId)
    }
  }
  return terminals
}

/**
 * Get socket health metrics for the monitoring endpoint.
 * Read-only, no DB queries — only cached in-memory data.
 */
/**
 * Get connected clients whose reported version differs from the current server version.
 * Used by update pipeline to identify terminals that need a refresh.
 */
export function getStaleClients(currentServerVersion: string): Array<{
  terminalId: string
  clientVersion: string
  locationId: string
}> {
  const stale: Array<{ terminalId: string; clientVersion: string; locationId: string }> = []
  for (const [terminalId, info] of connectedTerminals) {
    if (info.clientVersion && info.clientVersion !== currentServerVersion) {
      stale.push({ terminalId, clientVersion: info.clientVersion, locationId: info.locationId })
    }
  }
  return stale
}

export function getSocketHealthMetrics(): {
  connectedClients: { total: number; byCategory: Record<string, number> }
  eventThroughput: { last60s: number; perSecond: number }
  reconnections: { last60s: number }
  cfdPairings: number
  staleClients: number
} {
  // Prune stale entries — single splice instead of repeated shift() for O(n) vs O(n²)
  const now = Date.now()
  const cutoff = now - 60_000

  let pruneIdx = 0
  while (pruneIdx < socketMetrics.eventsEmitted60s.length && socketMetrics.eventsEmitted60s[pruneIdx] < cutoff) {
    pruneIdx++
  }
  if (pruneIdx > 0) socketMetrics.eventsEmitted60s.splice(0, pruneIdx)

  pruneIdx = 0
  while (pruneIdx < socketMetrics.reconnections60s.length && socketMetrics.reconnections60s[pruneIdx] < cutoff) {
    pruneIdx++
  }
  if (pruneIdx > 0) socketMetrics.reconnections60s.splice(0, pruneIdx)

  // Categorize connected terminals
  const byCategory: Record<string, number> = {}
  for (const [, info] of connectedTerminals) {
    const tags = info.tags || []
    for (const tag of tags) {
      byCategory[tag] = (byCategory[tag] || 0) + 1
    }
    if (tags.length === 0) {
      byCategory['uncategorized'] = (byCategory['uncategorized'] || 0) + 1
    }
  }

  const events60s = socketMetrics.eventsEmitted60s.length

  // Count clients with a version that differs from server's package.json version
  let staleCount = 0
  const serverVersion = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'
  for (const [, info] of connectedTerminals) {
    if (info.clientVersion && info.clientVersion !== serverVersion) {
      staleCount++
    }
  }

  return {
    connectedClients: {
      total: connectedTerminals.size,
      byCategory,
    },
    eventThroughput: {
      last60s: events60s,
      perSecond: Math.round((events60s / 60) * 10) / 10,
    },
    reconnections: {
      last60s: socketMetrics.reconnections60s.length,
    },
    cfdPairings: cfdToRegisterMap.size,
    staleClients: staleCount,
  }
}
