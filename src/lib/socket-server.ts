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
import { MOBILE_EVENTS } from '@/types/multi-surface'
import { db } from '@/lib/db'
import { verifySessionToken, POS_SESSION_COOKIE } from '@/lib/auth-session'

// Dynamic import for socket.io (optional dependency)
let io: typeof import('socket.io').Server | null = null

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
          select: { id: true, locationId: true, name: true, platform: true },
        })
        if (!terminal) {
          return next(new Error('Invalid device token'))
        }
        socket.data.terminalId = terminal.id
        socket.data.terminalName = terminal.name
        socket.data.platform = terminal.platform
        socket.data.locationId = terminal.locationId
        socket.data.authenticated = true
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

        // Acknowledge successful join
        socket.emit('joined', { success: true, rooms: socket.rooms.size })
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

    // Phone → relay tab close request to all terminals in location
    socket.on(MOBILE_EVENTS.TAB_CLOSE_REQUEST, (data: { orderId: string; employeeId: string; tipMode: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) return
        socketServer.to(`location:${locationId}`).except(socket.id).emit(MOBILE_EVENTS.TAB_CLOSE_REQUEST, { ...data, locationId })
      } catch (err) {
        console.error(JSON.stringify({ event: 'TAB_CLOSE_REQUEST', socketId: socket.id, error: String(err) }))
      }
    })

    // Phone → relay transfer request to all terminals in location
    socket.on(MOBILE_EVENTS.TAB_TRANSFER_REQUEST, (data: { orderId: string; employeeId: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) return
        socketServer.to(`location:${locationId}`).except(socket.id).emit(MOBILE_EVENTS.TAB_TRANSFER_REQUEST, { ...data, locationId })
      } catch (err) {
        console.error(JSON.stringify({ event: 'TAB_TRANSFER_REQUEST', socketId: socket.id, error: String(err) }))
      }
    })

    // Phone → relay manager alert to all terminals in location (fire-and-forget, no response needed)
    socket.on(MOBILE_EVENTS.TAB_ALERT_MANAGER, (data: { orderId: string; employeeId: string }) => {
      try {
        const locationId = socket.data.locationId
        if (!locationId) return
        socketServer.to(`location:${locationId}`).emit(MOBILE_EVENTS.TAB_ALERT_MANAGER, { ...data, locationId })
      } catch (err) {
        console.error(JSON.stringify({ event: 'TAB_ALERT_MANAGER', socketId: socket.id, error: String(err) }))
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

    // ==================== Connection Lifecycle ====================

    socket.on('disconnect', (reason: string) => {
      try {
        // Clean up terminal tracking
        for (const [terminalId, info] of connectedTerminals.entries()) {
          if (info.socketId === socket.id) {
            connectedTerminals.delete(terminalId)
            if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Terminal ${terminalId} disconnected: ${reason}`)
            break
          }
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
  if (globalForSocket.socketServer) {
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
  if (globalForSocket.socketServer) {
    tags.forEach((tag) => {
      const room = locationId ? `tag:${locationId}:${tag}` : `tag:${tag}`
      globalForSocket.socketServer!.to(room).emit(event, data)
    })
    return true
  }
  return emitViaIPC({ type: 'tags', target: tags, event, data })
}

/**
 * Emit to location room (global alerts)
 */
export async function emitToLocation(locationId: string, event: string, data: unknown): Promise<boolean> {
  if (globalForSocket.socketServer) {
    const room = `location:${locationId}`
    const roomSockets = globalForSocket.socketServer.sockets.adapter.rooms.get(room)
    if (process.env.DEBUG_SOCKETS) console.log(`[Socket] emitToLocation: ${event} → ${room} (${roomSockets?.size ?? 0} clients)`)
    globalForSocket.socketServer.to(room).emit(event, data)
    return true
  }
  return emitViaIPC({ type: 'location', target: locationId, event, data })
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
