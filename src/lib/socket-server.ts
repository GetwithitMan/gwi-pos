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

import type { Server as HTTPServer } from 'http'
import type { Server as SocketServer, Socket } from 'socket.io'
import { MOBILE_EVENTS, PAT_EVENTS } from '@/types/multi-surface'
import { db } from '@/lib/db'
import { verifySessionToken, POS_SESSION_COOKIE } from '@/lib/auth-session'
import { recordEvent, getEventsSince, getLatestEventId } from '@/lib/socket-event-buffer'
import {
  enqueueAck,
  acknowledgeEvent as ackQueueAcknowledge,
  getRetryableEvents,
  markRetryAttempt,
} from './socket-ack-queue'

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
    console.warn('[Socket] IPC to ws-server failed')
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
}>()

// Reverse mapping: cfdTerminalId → registerTerminalId (cached from auth middleware)
// Used by CFD-to-register relay to avoid DB lookups during payment flow
const cfdToRegisterMap = new Map<string, string>()

async function markTerminalOffline(terminalId: string, locationId: string, reason: string, socketId: string): Promise<void> {
  try {
    await db.terminal.update({
      where: { id: terminalId },
      data: { isOnline: false },
    })
    void emitToLocation(locationId, 'terminal:status_changed', {
      terminalId,
      isOnline: false,
      lastSeenAt: null,
      source: 'socket_disconnect',
      reason,
    })
    void db.auditLog.create({
      data: {
        locationId,
        action: 'terminal_disconnected',
        entityType: 'terminal',
        entityId: terminalId,
        details: { reason, socketId },
      },
    }).catch(console.error)
  } catch (err) {
    console.error('[Socket] markTerminalOffline failed:', err)
  }
}

async function markTerminalOnline(terminalId: string, locationId: string): Promise<void> {
  try {
    const terminal = await db.terminal.findFirst({
      where: { id: terminalId, deletedAt: null },
      select: { isOnline: true },
    })
    if (!terminal || terminal.isOnline) return // already online, skip
    await db.terminal.update({
      where: { id: terminalId },
      data: { isOnline: true, lastSeenAt: new Date() },
    })
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
    }).catch(console.error)
  } catch (err) {
    console.error('[Socket] markTerminalOnline failed:', err)
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
      origin: process.env.NODE_ENV === 'development'
        ? '*'
        : (origin, callback) => {
            // No origin (same-origin / server-to-server) — allow
            if (!origin) return callback(null, true)
            if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
              return callback(null, true)
            }
            // ALLOWED_ORIGINS not set or origin not in list — reject
            callback(new Error('CORS rejected'), false)
          },
      methods: ['GET', 'POST'],
    },
    // Connection settings optimized for local network
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
  })

  // ==================== Authentication Middleware ====================
  // Validate session cookie or deviceToken before allowing connection.
  // On NUC (POS_LOCATION_ID set), local connections are trusted.
  socketServer.use(async (socket, next) => {
    try {
      // Path 1: Native device token (phones/iPads)
      const deviceToken = socket.handshake.auth?.deviceToken as string | undefined
      if (deviceToken && typeof deviceToken === 'string') {
        const terminal = await db.terminal.findFirst({
          where: { deviceToken, deletedAt: null },
          select: { id: true, locationId: true, name: true, platform: true, cfdTerminalId: true },
        })
        if (!terminal) {
          return next(new Error('Invalid device token'))
        }
        socket.data.terminalId = terminal.id
        socket.data.terminalName = terminal.name
        socket.data.platform = terminal.platform
        socket.data.locationId = terminal.locationId
        socket.data.authenticated = true
        socket.data.cfdTerminalId = terminal.cfdTerminalId ?? null
        return next()
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

      // Path 3: NUC local network — trust all connections from the local server
      if (process.env.POS_LOCATION_ID) {
        socket.data.locationId = process.env.POS_LOCATION_ID
        socket.data.authenticated = true
        return next()
      }

      // Path 4: Development mode — allow unauthenticated
      if (process.env.NODE_ENV === 'development') {
        socket.data.authenticated = false
        return next()
      }

      return next(new Error('Authentication required'))
    } catch (err) {
      console.error('[Socket] Auth middleware error:', err)
      return next(new Error('Authentication error'))
    }
  })

  socketServer.on('connection', (socket: Socket) => {
    const clientIp = socket.handshake.address
    if (process.env.DEBUG_SOCKETS) console.log(`[Socket] New connection from ${clientIp} (${socket.id}) authenticated=${socket.data.authenticated}`)

    // If device token auth happened in middleware, join location room
    if (socket.data.terminalId && socket.data.locationId) {
      socket.join(`location:${socket.data.locationId}`)
      // Cache CFD→register reverse mapping for relay without DB lookups
      if (socket.data.cfdTerminalId) {
        cfdToRegisterMap.set(socket.data.cfdTerminalId, socket.data.terminalId)
      }
      if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Native client authenticated: ${socket.data.terminalName} (${socket.data.platform})`)
    }

    // Auto-join location room from handshake query (used by SocketEventProvider)
    const queryLocationId = socket.handshake.query?.locationId as string | undefined
    const serverLocationId = process.env.POS_LOCATION_ID
    if (queryLocationId && typeof queryLocationId === 'string' && queryLocationId.length > 0) {
      if (serverLocationId && queryLocationId !== serverLocationId) {
        console.warn(`[Socket] Rejected location join: client sent ${queryLocationId}, server expects ${serverLocationId}`)
        socket.disconnect(true)
        return
      }
      // Store authenticated locationId on socket for later validation
      if (!socket.data.locationId) socket.data.locationId = queryLocationId
      socket.join(`location:${queryLocationId}`)
      if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Auto-joined location:${queryLocationId} from query`)
    }

    // Valid room prefixes for subscribe
    const ALLOWED_ROOM_PREFIXES = ['location:', 'tag:', 'terminal:', 'station:', 'scale:']

    // Handle channel subscribe/unsubscribe from SocketEventProvider
    socket.on('subscribe', (channelName: string) => {
      try {
        if (typeof channelName !== 'string' || !ALLOWED_ROOM_PREFIXES.some(p => channelName.startsWith(p))) {
          console.warn(`[Socket] Rejected subscribe to invalid room: ${channelName}`)
          return
        }
        // Validate location rooms against authenticated context
        if (channelName.startsWith('location:')) {
          const roomLocationId = channelName.slice('location:'.length)
          if (!socket.data.locationId) {
            // First location subscription establishes the binding
            socket.data.locationId = roomLocationId
          } else if (roomLocationId !== socket.data.locationId) {
            console.warn(`[Socket] Rejected cross-location subscribe: socket bound to ${socket.data.locationId}, tried ${roomLocationId}`)
            return
          }
        }
        socket.join(channelName)
      } catch (err) {
        console.error(JSON.stringify({ event: 'subscribe', socketId: socket.id, error: String(err) }))
      }
    })
    socket.on('unsubscribe', (channelName: string) => {
      try {
        socket.leave(channelName)
      } catch (err) {
        console.error(JSON.stringify({ event: 'unsubscribe', socketId: socket.id, error: String(err) }))
      }
    })

    // QoS 1: client sends ack with ackId after receiving critical events
    socket.on('ack', (ackPayload: { ackId: string }) => {
      if (ackPayload?.ackId) {
        ackQueueAcknowledge(ackPayload.ackId)
      }
    })

    // ==================== Room Management ====================

    /**
     * Join station rooms based on terminal identity
     * Called when a KDS/terminal starts up
     */
    socket.on('join_station', ({ locationId, tags, terminalId, stationId }: JoinStationPayload) => {
      try {
        // Validate locationId against authenticated context
        if (socket.data.locationId && locationId !== socket.data.locationId) {
          console.warn(`[Socket] Rejected join_station: socket bound to ${socket.data.locationId}, payload says ${locationId}`)
          socket.emit('joined', { success: false, error: 'Location mismatch' })
          return
        }

        // Join location room (global alerts)
        socket.join(`location:${locationId}`)

        // Join terminal-specific room (direct messages)
        socket.join(`terminal:${terminalId}`)

        // Subscribe to specific prep tags (pizza, bar, kitchen, expo)
        // Location-scoped: tag:{locationId}:{tagName} for multi-venue isolation
        tags.forEach((tag: string) => {
          socket.join(`tag:${locationId}:${tag}`)
        })

        // If station-specific, join that room too
        if (stationId) {
          socket.join(`station:${stationId}`)
        }

        // Clean up any previous entry for this socket (reconnection with new terminalId)
        for (const [existingId, info] of connectedTerminals.entries()) {
          if (info.socketId === socket.id) {
            connectedTerminals.delete(existingId)
            break
          }
        }

        // Store locationId on socket data for event handlers
        socket.data.locationId = locationId

        // Track connection
        connectedTerminals.set(terminalId, {
          socketId: socket.id,
          locationId,
          tags,
          connectedAt: new Date(),
        })

        if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Terminal ${terminalId} joined rooms:`, {
          location: `location:${locationId}`,
          tags: tags.map(t => `tag:${locationId}:${t}`),
          station: stationId ? `station:${stationId}` : null,
        })

        // Acknowledge successful join — include latestEventId for catch-up baseline
        socket.emit('joined', { success: true, rooms: socket.rooms.size, latestEventId: getLatestEventId(locationId) })

        // Mark terminal online on (re)connection — fire-and-forget
        void markTerminalOnline(terminalId, locationId)
      } catch (err) {
        console.error(JSON.stringify({ event: 'join_station', socketId: socket.id, terminalId, error: String(err) }))
      }
    })

    /**
     * Leave station rooms (cleanup)
     */
    socket.on('leave_station', ({ terminalId }: { terminalId: string }) => {
      try {
        connectedTerminals.delete(terminalId)
        // Socket.io automatically cleans up room memberships on disconnect
      } catch (err) {
        console.error(JSON.stringify({ event: 'leave_station', socketId: socket.id, error: String(err) }))
      }
    })

    // ==================== Reconnection Catch-Up ====================

    /**
     * Client sends catch-up request after reconnecting with last known eventId.
     * Server replays all buffered events since that eventId that match the
     * client's subscribed rooms.
     */
    socket.on('catch-up', ({ lastEventId, locationId: catchUpLocationId }: { lastEventId: number; locationId: string }) => {
      try {
        if (typeof lastEventId !== 'number' || lastEventId < 0) return
        if (typeof catchUpLocationId !== 'string' || !catchUpLocationId) return

        // Validate locationId matches socket's authenticated context
        if (socket.data.locationId && catchUpLocationId !== socket.data.locationId) {
          console.warn(`[Socket] catch-up rejected: socket bound to ${socket.data.locationId}, requested ${catchUpLocationId}`)
          return
        }

        // Get the rooms this socket is currently subscribed to
        const subscribedRooms = Array.from(socket.rooms).filter(
          r => r !== socket.id // Exclude the socket's own room
        )

        const missedEvents = getEventsSince(catchUpLocationId, lastEventId, subscribedRooms)

        if (missedEvents.length > 0) {
          if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Catch-up: replaying ${missedEvents.length} events to ${socket.id} (since eid=${lastEventId})`)
          for (const evt of missedEvents) {
            socket.emit(evt.event, evt.data)
          }
        }
      } catch (err) {
        console.error(JSON.stringify({ event: 'catch-up', socketId: socket.id, error: String(err) }))
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
          console.warn(`[Socket] order:editing rejected — no authenticated locationId on socket ${socket.id}`)
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
        console.error(JSON.stringify({ event: 'order:editing', socketId: socket.id, error: String(err) }))
      }
    })

    socket.on('order:editing-released', (data: { orderId: string; terminalId: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) {
          console.warn(`[Socket] order:editing-released rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        if (typeof data.orderId === 'string') {
          socketServer.to(`location:${locationId}`).except(socket.id).emit('order:editing-released', {
            orderId: data.orderId,
            terminalId: data.terminalId,
          })
        }
      } catch (err) {
        console.error(JSON.stringify({ event: 'order:editing-released', socketId: socket.id, error: String(err) }))
      }
    })

    // ==================== Mobile Tab Relay ====================

    // Phone → server processes tab close, emits result back to sender
    socket.on(MOBILE_EVENTS.TAB_CLOSE_REQUEST, (data: { orderId: string; employeeId: string; tipMode: string }) => {
      const locationId = socket.data.locationId
      if (!locationId) return
      const { orderId, employeeId, tipMode } = data
      if (!orderId || !employeeId) {
        socket.emit(MOBILE_EVENTS.TAB_CLOSED, { orderId, success: false, amount: 0, error: 'Missing orderId or employeeId' })
        return
      }
      // Call the close-tab API route internally (payment logic is complex — Datacap hardware)
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
        const json = await res.json().catch(() => ({}))
        if (res.ok && json.data?.success) {
          socket.emit(MOBILE_EVENTS.TAB_CLOSED, {
            orderId,
            success: true,
            amount: json.data.captured?.totalAmount ?? 0,
            tipAmount: json.data.captured?.tipAmount ?? 0,
          })
        } else {
          socket.emit(MOBILE_EVENTS.TAB_CLOSED, {
            orderId,
            success: false,
            amount: 0,
            error: json.data?.error?.message || json.error || 'Close tab failed',
          })
        }
      }).catch((err: unknown) => {
        console.error('[Socket] tab:close-request internal call failed:', err)
        socket.emit(MOBILE_EVENTS.TAB_CLOSED, { orderId, success: false, amount: 0, error: 'Failed to close tab' })
      })
    })

    // Phone → server processes tab transfer via direct DB update
    socket.on(MOBILE_EVENTS.TAB_TRANSFER_REQUEST, (data: { orderId: string; employeeId: string }) => {
      const locationId = socket.data.locationId
      if (!locationId) return
      const { orderId, employeeId } = data
      if (!orderId || !employeeId) return
      void db.order.update({
        where: { id: orderId },
        data: { employeeId },
      }).then(() => {
        socket.emit('tab:transfer-complete', { orderId })
        // Notify all terminals to refresh order list
        void emitToLocation(locationId, 'orders:list-changed', {
          trigger: 'transferred',
          orderId,
        })
      }).catch((err: unknown) => {
        console.error('[Socket] tab:transfer-request DB update failed:', err)
        socket.emit('tab:error', { orderId, message: 'Failed to transfer tab' })
      })
    })

    // Phone → relay manager alert to all terminals in location (fire-and-forget)
    // NOTE: POS order page should add a toast listener for 'tab:manager-alert' to display these
    socket.on(MOBILE_EVENTS.TAB_ALERT_MANAGER, (data: { orderId: string; employeeId: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) return
        socketServer.to(`location:${locationId}`).emit('tab:manager-alert', { ...data, locationId })
      } catch (err) {
        console.error(JSON.stringify({ event: 'TAB_ALERT_MANAGER', socketId: socket.id, error: String(err) }))
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
          console.warn(`[Socket] pat:pay-request rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        if (typeof data.orderId !== 'string' || !data.orderId) return
        if (process.env.DEBUG_SOCKETS) console.log(`[Socket] pat:pay-request relay: order ${data.orderId} → location:${locationId}`)
        socketServer.to(`location:${locationId}`).except(socket.id).emit(PAT_EVENTS.PAY_REQUEST, data)
      } catch (err) {
        console.error(JSON.stringify({ event: 'pat:pay-request', socketId: socket.id, error: String(err) }))
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
          console.warn(`[Socket] pat:pay-result rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        if (typeof data.orderId !== 'string' || !data.orderId) return
        if (process.env.DEBUG_SOCKETS) console.log(`[Socket] pat:pay-result relay: order ${data.orderId} success=${data.success} → location:${locationId}`)
        socketServer.to(`location:${locationId}`).except(socket.id).emit(PAT_EVENTS.PAY_RESULT, data)
      } catch (err) {
        console.error(JSON.stringify({ event: 'pat:pay-result', socketId: socket.id, error: String(err) }))
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
      'print:job',
      'print:status',
      'kds:bump',
      'kds:recall',
      'terminal:ping',
      'terminal:config-update',
      'terminal:payment_request',
      'terminal:payment_complete',
    ])

    socket.on('terminal_message', ({ terminalId, event, data }: {
      terminalId: string
      event: string
      data: unknown
    }) => {
      try {
        // Require authenticated locationId on sender
        const senderLocationId = socket.data.locationId
        if (!senderLocationId) {
          console.warn(`[Socket] terminal_message rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }

        // Validate event name against allow-list
        if (!TERMINAL_MESSAGE_ALLOWED_EVENTS.has(event)) {
          console.warn(`[Socket] terminal_message rejected — event "${event}" not in allow-list (socket ${socket.id})`)
          return
        }

        // Validate target terminal belongs to the same location
        const targetInfo = connectedTerminals.get(terminalId)
        if (targetInfo && targetInfo.locationId !== senderLocationId) {
          console.warn(`[Socket] terminal_message rejected — cross-location: sender ${senderLocationId}, target ${targetInfo.locationId}`)
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
        console.error(JSON.stringify({ event: 'terminal_message', socketId: socket.id, targetTerminal: terminalId, error: String(err) }))
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
        console.error(JSON.stringify({ event: 'sync_completed', socketId: socket.id, error: String(err) }))
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
    ]
    for (const cfdEvent of CFD_REGISTER_TO_CFD_EVENTS) {
      socket.on(cfdEvent, (data: unknown) => {
        try {
          const cfdTerminalId = socket.data.cfdTerminalId as string | null | undefined
          if (!cfdTerminalId) return
          void emitToTerminal(cfdTerminalId, cfdEvent, data)
        } catch (err) {
          console.error(JSON.stringify({ event: cfdEvent, socketId: socket.id, error: String(err) }))
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
    ]
    for (const cfdEvent of CFD_TO_REGISTER_EVENTS) {
      socket.on(cfdEvent, (data: unknown) => {
        try {
          const myTerminalId = socket.data.terminalId as string | undefined
          if (!myTerminalId) return

          // Try cached mapping first (no DB query needed)
          const cachedRegisterId = cfdToRegisterMap.get(myTerminalId)
          if (cachedRegisterId) {
            void emitToTerminal(cachedRegisterId, cfdEvent, data)
            return
          }

          // Cache miss — fall back to DB lookup
          void db.terminal.findFirst({
            where: { cfdTerminalId: myTerminalId, deletedAt: null },
            select: { id: true },
          }).then(register => {
            if (!register) return
            // Populate cache for future relays
            cfdToRegisterMap.set(myTerminalId, register.id)
            void emitToTerminal(register.id, cfdEvent, data)
          }).catch((err: unknown) => {
            console.error(JSON.stringify({ event: cfdEvent, lookupFailed: true, error: String(err) }))
          })
        } catch (err) {
          console.error(JSON.stringify({ event: cfdEvent, socketId: socket.id, error: String(err) }))
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
          console.warn(`[Socket] terminal:payment_request rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        void emitToTerminal(data.targetTerminalId, 'terminal:payment_request', data)
      } catch (err) {
        console.error(JSON.stringify({ event: 'terminal:payment_request', socketId: socket.id, error: String(err) }))
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
          console.warn(`[Socket] terminal:payment_complete rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }
        void emitToTerminal(data.toTerminalId, 'terminal:payment_complete', data)
      } catch (err) {
        console.error(JSON.stringify({ event: 'terminal:payment_complete', socketId: socket.id, error: String(err) }))
      }
    })

    // ==================== Connection Lifecycle ====================

    socket.on('disconnect', (reason: string) => {
      try {
        // Path A: browser/KDS terminals registered via join_station
        let handled = false
        for (const [terminalId, info] of connectedTerminals.entries()) {
          if (info.socketId === socket.id) {
            connectedTerminals.delete(terminalId)
            if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Terminal ${terminalId} disconnected: ${reason}`)
            void markTerminalOffline(terminalId, info.locationId, reason, socket.id)
            handled = true
            break
          }
        }
        // Path B: Android native — auth middleware sets socket.data.terminalId
        if (!handled && socket.data.terminalId && socket.data.locationId) {
          void markTerminalOffline(socket.data.terminalId, socket.data.locationId, reason, socket.id)
        }
        // Clean up CFD→register cache when register disconnects
        if (socket.data.cfdTerminalId) {
          cfdToRegisterMap.delete(socket.data.cfdTerminalId)
        }
      } catch (err) {
        console.error(JSON.stringify({ event: 'disconnect', socketId: socket.id, error: String(err) }))
      }
    })

    socket.on('error', (error: Error) => {
      console.error(`[Socket] Error on ${socket.id}:`, error)
    })
  })

  // Periodic status logging
  setInterval(() => {
    const stats = {
      connections: socketServer.engine.clientsCount,
      terminals: connectedTerminals.size,
      rooms: socketServer.sockets.adapter.rooms.size,
    }
    if (stats.connections > 0) {
      if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Status:`, stats)
    }
  }, 60000) // Every minute

  // Periodic cleanup of stale terminal entries (every 5 minutes)
  setInterval(() => {
    let cleaned = 0
    for (const [terminalId, info] of connectedTerminals.entries()) {
      // Check if the socket is still connected
      const socket = socketServer.sockets.sockets.get(info.socketId)
      if (!socket || !socket.connected) {
        connectedTerminals.delete(terminalId)
        cleaned++
      }
    }
    if (cleaned > 0) {
      if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Cleaned ${cleaned} stale terminal entries`)
    }
  }, 5 * 60 * 1000) // Every 5 minutes

  // NOTE: Redundant 60s stale-terminal sweep removed (2026-03-09).
  // Socket disconnect events (line ~653) already mark terminals offline immediately
  // via markTerminalOffline(). The DB-polling sweep was a slower, redundant fallback
  // that added unnecessary DB queries every 60s and delayed offline detection vs
  // the authoritative socket disconnect handler.

  // Retry unacknowledged critical events every 2 seconds (QoS 1)
  setInterval(() => {
    const retryable = getRetryableEvents()
    for (const pending of retryable) {
      try {
        socketServer.to(pending.room).emit(pending.event, {
          ...(typeof pending.data === 'object' && pending.data !== null ? pending.data : {}),
          _ackId: pending.ackId,
          _retry: pending.attempts,
        })
        markRetryAttempt(pending.ackId)
      } catch (err) {
        console.error('[socket-ack] Retry emit failed:', err)
      }
    }
  }, 2000)

  // Store in global so API routes can emit events (survives HMR)
  setSocketServer(socketServer)
  if (process.env.DEBUG_SOCKETS) console.log('[Socket] Server initialized and stored in globalThis')
  return socketServer
}

/**
 * Get socket server instance (for API routes to emit events)
 * Uses globalThis to survive Next.js HMR in development (same pattern as Prisma client)
 */
const globalForSocket = globalThis as unknown as {
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
    return true
  }
  // IPC path: send pre-scoped room names so the remote ws-server uses correct rooms
  return emitViaIPC({ type: 'tags', target: rooms, event, data })
}

/**
 * Emit to location room (global alerts)
 */
export async function emitToLocation(locationId: string, event: string, data: unknown): Promise<boolean> {
  if (globalForSocket.socketServer) {
    const room = `location:${locationId}`
    const roomSockets = globalForSocket.socketServer.sockets.adapter.rooms.get(room)
    if (process.env.DEBUG_SOCKETS) console.log(`[Socket] emitToLocation: ${event} → ${room} (${roomSockets?.size ?? 0} clients)`)
    // Record in buffer and inject _eid for client catch-up tracking
    const eid = recordEvent(locationId, event, data, room)
    const enriched = data && typeof data === 'object' && !Array.isArray(data) ? { ...data as Record<string, unknown>, _eid: eid } : data
    globalForSocket.socketServer.to(room).emit(event, enriched)
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
  const room = `location:${locationId}`
  const ackId = enqueueAck(locationId, room, event, data)
  const payload = {
    ...(typeof data === 'object' && data !== null ? data : {}),
    _ackId: ackId,
  }
  if (globalForSocket.socketServer) {
    const roomSockets = globalForSocket.socketServer.sockets.adapter.rooms.get(room)
    if (process.env.DEBUG_SOCKETS) console.log(`[Socket] emitCriticalToLocation: ${event} -> ${room} (${roomSockets?.size ?? 0} clients) ackId=${ackId}`)
    // Also record in event buffer for catch-up
    const eid = recordEvent(locationId, event, payload, room)
    const enriched = { ...payload, _eid: eid }
    globalForSocket.socketServer.to(room).emit(event, enriched)
  } else {
    void emitViaIPC({ type: 'location', target: locationId, event, data: payload })
  }
}

/**
 * Emit to a specific terminal's room (for CFD events, pay-at-table, etc.)
 * Room name: terminal:{terminalId}
 */
export async function emitToTerminal(terminalId: string, event: string, data: unknown): Promise<boolean> {
  const room = `terminal:${terminalId}`
  if (globalForSocket.socketServer) {
    if (process.env.DEBUG_SOCKETS) console.log(`[Socket] emitToTerminal: ${event} → ${room}`)
    globalForSocket.socketServer.to(room).emit(event, data)
    return true
  }
  return emitViaIPC({ type: 'room', target: room, event, data })
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
