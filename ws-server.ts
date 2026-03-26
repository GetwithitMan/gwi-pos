/**
 * Standalone WebSocket Server for GWI POS
 *
 * Runs Socket.io on its own process/port, separate from Next.js.
 * Next.js API routes communicate via HTTP IPC to emit events.
 *
 * Why standalone?
 *   - Heavy socket traffic never slows the main request/response loop
 *   - Can be scaled independently (Docker, separate CPU core)
 *   - Cleaner separation of concerns
 *
 * Usage:
 *   Development: npm run ws:dev
 *   Production:  node ws-server.js
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Server as SocketServer, Socket } from 'socket.io'
import {
  setSocketServer,
  emitToRoom,
  emitToTags,
  emitToLocation,
} from './src/lib/socket-server'

const port = parseInt(process.env.WS_PORT || '3001', 10)
const hostname = process.env.WS_HOSTNAME || '0.0.0.0'
const socketPath = process.env.SOCKET_PATH || '/ws'

// ─── Connected terminal tracking (same as socket-server.ts) ───
const connectedTerminals = new Map<
  string,
  {
    socketId: string
    locationId: string
    tags: string[]
    connectedAt: Date
  }
>()

// ─── Payload types (mirrored from socket-server.ts) ───

interface JoinStationPayload {
  locationId: string
  tags: string[]
  terminalId: string
  stationId?: string
}

interface OrderRoutingManifest {
  locationId: string
  destinations: Array<{
    tag: string
    stationId: string
    stationName: string
    orderData: unknown
  }>
}

interface ItemBumpPayload {
  orderId: string
  itemId: string
  status: 'pending' | 'cooking' | 'ready' | 'served' | 'bumped'
  stationId: string
  bumpedBy: string
}

interface OrderBumpPayload {
  orderId: string
  stationId: string
  bumpedBy: string
  allItemsServed: boolean
}

interface EntertainmentUpdatePayload {
  sessionId: string
  tableId: string
  tableName: string
  action: 'started' | 'extended' | 'stopped' | 'warning'
  expiresAt: string | null
  addedMinutes?: number
  partyName?: string
  locationId: string
}

// ─── HTTP body reader ───

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

// ─── Socket.io connection handler ───
// Replicates the room management and event handlers from socket-server.ts
// so the standalone server handles all client interactions identically.

// Valid room prefixes for subscribe validation
const ALLOWED_ROOM_PREFIXES = ['location:', 'tag:', 'terminal:', 'station:', 'scale:']
const MAX_ROOMS_PER_SOCKET = 50

// ── Per-socket rate limiting (mirrors socket-server.ts) ──────────────────────
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

// Clean stale rate limit entries every 30s
setInterval(() => {
  const now = Date.now()
  for (const [socketId, state] of socketRateLimits) {
    if (now > state.resetAt + 5000) {
      socketRateLimits.delete(socketId)
    }
  }
}, 30_000)

// ── Event allow-list for terminal_message relay (mirrors socket-server.ts) ───
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

function setupConnectionHandler(socketServer: SocketServer): void {
  // ==================== Authentication Middleware ====================
  socketServer.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.auth?.deviceToken || socket.handshake.headers?.authorization
      const locationId = socket.handshake.auth?.locationId || socket.handshake.query?.locationId

      if (!locationId) {
        // In development, allow connections without locationId
        if (process.env.NODE_ENV !== 'production') {
          socket.data.authenticated = false
          return next()
        }
        console.warn(`[WS] Rejected connection — no locationId (${socket.handshake.address})`)
        return next(new Error('locationId required'))
      }

      // In production, validate token against WS_AUTH_SECRET
      const authSecret = process.env.WS_AUTH_SECRET
      if (process.env.NODE_ENV === 'production') {
        if (!token) {
          console.warn(`[WS] Rejected connection — no auth token (${socket.handshake.address})`)
          return next(new Error('Authentication required'))
        }
        if (authSecret && token !== authSecret) {
          console.warn(`[WS] Rejected connection — invalid token (${socket.handshake.address})`)
          return next(new Error('Invalid authentication token'))
        }
      }

      socket.data.locationId = locationId
      socket.data.authenticated = true
      // Track terminalId from handshake for cross-location validation
      if (socket.handshake.auth?.terminalId) {
        socket.data.terminalId = socket.handshake.auth.terminalId
      }
      return next()
    } catch (err) {
      console.error('[WS] Auth middleware error:', err)
      return next(new Error('Authentication error'))
    }
  })

  socketServer.on('connection', (socket: Socket) => {
    const clientIp = socket.handshake.address
    console.log(`[WS] New connection from ${clientIp} (${socket.id})`)

    // Per-socket room tracking for rate limiting
    if (!socket.data.joinedRooms) socket.data.joinedRooms = new Set<string>()

    // Auto-join location room from handshake query (used by SocketEventProvider)
    const queryLocationId = socket.handshake.query?.locationId as string | undefined
    if (queryLocationId) {
      socket.join(`location:${queryLocationId}`)
      ;(socket.data.joinedRooms as Set<string>).add(`location:${queryLocationId}`)
      console.log(`[WS] Auto-joined location:${queryLocationId} from query`)
    }

    // Handle channel subscribe/unsubscribe from SocketEventProvider
    socket.on('subscribe', (channelName: string) => {
      if (!checkSocketRateLimit(socket.id)) {
        socket.emit('rate_limited', { message: 'Too many events per second', event: 'subscribe' })
        return
      }
      if (typeof channelName !== 'string' || !ALLOWED_ROOM_PREFIXES.some(p => channelName.startsWith(p))) {
        console.warn(`[WS] Rejected subscribe to invalid room: ${channelName}`)
        return
      }
      const joinedRooms = socket.data.joinedRooms as Set<string>
      if (!joinedRooms.has(channelName) && joinedRooms.size >= MAX_ROOMS_PER_SOCKET) {
        console.warn(`[WS] Rejected subscribe — socket ${socket.id} at max rooms (${MAX_ROOMS_PER_SOCKET}): ${channelName}`)
        return
      }
      // Validate location rooms against authenticated context
      if (channelName.startsWith('location:')) {
        const roomLocationId = channelName.slice('location:'.length)
        if (socket.data.locationId && roomLocationId !== socket.data.locationId) {
          console.warn(`[WS] Rejected cross-location subscribe: socket bound to ${socket.data.locationId}, tried ${roomLocationId}`)
          return
        }
      }
      socket.join(channelName)
      joinedRooms.add(channelName)
    })
    socket.on('unsubscribe', (channelName: string) => {
      socket.leave(channelName)
      ;(socket.data.joinedRooms as Set<string>)?.delete(channelName)
    })

    // ==================== Room Management ====================

    socket.on('join_station', ({ locationId, tags, terminalId, stationId }: JoinStationPayload) => {
      socket.join(`location:${locationId}`)
      socket.join(`terminal:${terminalId}`)

      tags.forEach((tag: string) => {
        socket.join(`tag:${locationId}:${tag}`)
      })

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

      connectedTerminals.set(terminalId, {
        socketId: socket.id,
        locationId,
        tags,
        connectedAt: new Date(),
      })

      console.log(`[WS] Terminal ${terminalId} joined rooms:`, {
        location: `location:${locationId}`,
        tags: tags.map((t) => `tag:${locationId}:${t}`),
        station: stationId ? `station:${stationId}` : null,
      })

      socket.emit('joined', { success: true, rooms: socket.rooms.size })
    })

    socket.on('leave_station', ({ terminalId }: { terminalId: string }) => {
      connectedTerminals.delete(terminalId)
    })

    // ==================== Order Events ====================

    socket.on('new_order', (manifest: OrderRoutingManifest) => {
      console.log(`[WS] New order routing to ${manifest.destinations.length} destinations`)

      manifest.destinations.forEach((dest) => {
        socketServer.to(`tag:${manifest.locationId}:${dest.tag}`).emit('kds:order-received', dest.orderData)

        if (dest.tag !== 'expo') {
          const expoData =
            typeof dest.orderData === 'object' && dest.orderData !== null
              ? { ...(dest.orderData as Record<string, unknown>), isExpoView: true }
              : { orderData: dest.orderData, isExpoView: true }
          socketServer.to(`tag:${manifest.locationId}:expo`).emit('kds:order-received', expoData)
        }
      })

      socketServer.to(`location:${manifest.locationId}`).emit('order:created', {
        destinations: manifest.destinations.map((d) => d.stationName),
      })
    })

    // ==================== Item/Ticket Bumping ====================

    socket.on('item_status', (payload: ItemBumpPayload) => {
      const update = {
        orderId: payload.orderId,
        itemId: payload.itemId,
        status: payload.status,
        updatedBy: payload.bumpedBy,
        updatedAt: new Date().toISOString(),
        stationId: payload.stationId,
      }

      const itemLocationId = socket.data.locationId
      socketServer.to(`tag:${itemLocationId}:expo`).emit('kds:item-status', update)
      socketServer.to(`location:${itemLocationId}`).emit('kds:item-status', update)

      console.log(`[WS] Item ${payload.itemId} -> ${payload.status}`)
    })

    socket.on('order_bumped', (payload: OrderBumpPayload) => {
      const update = {
        orderId: payload.orderId,
        stationId: payload.stationId,
        bumpedBy: payload.bumpedBy,
        bumpedAt: new Date().toISOString(),
        allItemsServed: payload.allItemsServed,
      }

      const bumpLocationId = socket.data.locationId
      socketServer.to(`tag:${bumpLocationId}:expo`).emit('kds:order-bumped', update)
      socketServer.to(`location:${bumpLocationId}`).emit('kds:order-bumped', update)

      console.log(`[WS] Order ${payload.orderId} bumped from ${payload.stationId}`)
    })

    // ==================== Entertainment Events ====================

    socket.on('entertainment_update', (payload: EntertainmentUpdatePayload) => {
      socketServer.to(`tag:${payload.locationId}:entertainment`).emit('entertainment:session-update', payload)
      socketServer.to(`location:${payload.locationId}`).emit('entertainment:session-update', payload)

      console.log(`[WS] Entertainment ${payload.action}: ${payload.tableName}`)
    })

    // ==================== Direct Terminal Messages ====================

    socket.on(
      'terminal_message',
      ({ terminalId, event, data }: { terminalId: string; event: string; data: unknown }) => {
        // Rate limit check
        if (!checkSocketRateLimit(socket.id)) {
          socket.emit('rate_limited', { message: 'Too many events per second', event: 'terminal_message' })
          return
        }

        // Require authenticated locationId on sender
        const senderLocationId = socket.data.locationId
        if (!senderLocationId) {
          console.warn(`[WS] terminal_message rejected — no authenticated locationId on socket ${socket.id}`)
          return
        }

        // Validate event name against allow-list
        if (!TERMINAL_MESSAGE_ALLOWED_EVENTS.has(event)) {
          console.warn(`[WS] terminal_message rejected — event "${event}" not in allow-list (socket ${socket.id})`)
          return
        }

        // Validate target terminal belongs to the same location
        const targetInfo = connectedTerminals.get(terminalId)
        if (targetInfo && targetInfo.locationId !== senderLocationId) {
          console.warn(`[WS] terminal_message rejected — cross-location: sender ${senderLocationId}, target ${targetInfo.locationId}`)
          return
        }

        socketServer.to(`terminal:${terminalId}`).emit(event, data)
      }
    )

    // ==================== Sync Events ====================

    socket.on(
      'sync_completed',
      ({ terminalId, stats }: { terminalId: string; stats: { pushed: number; pulled: number; conflicts: number } }) => {
        socketServer.to(`terminal:${terminalId}`).emit('sync:completed', stats)
      }
    )

    // ==================== Connection Lifecycle ====================

    socket.on('disconnect', (reason: string) => {
      for (const [terminalId, info] of connectedTerminals.entries()) {
        if (info.socketId === socket.id) {
          connectedTerminals.delete(terminalId)
          console.log(`[WS] Terminal ${terminalId} disconnected: ${reason}`)
          break
        }
      }
    })

    socket.on('error', (error: Error) => {
      console.error(`[WS] Error on ${socket.id}:`, error)
    })
  })

  // Periodic status logging (every 60s)
  setInterval(() => {
    const stats = {
      connections: socketServer.engine.clientsCount,
      terminals: connectedTerminals.size,
      rooms: socketServer.sockets.adapter.rooms.size,
    }
    if (stats.connections > 0) {
      console.log(`[WS] Status:`, stats)
    }
  }, 60000)

  // Periodic cleanup of stale terminal entries (every 5 minutes)
  setInterval(() => {
    let cleaned = 0
    for (const [terminalId, info] of connectedTerminals.entries()) {
      const socket = socketServer.sockets.sockets.get(info.socketId)
      if (!socket || !socket.connected) {
        connectedTerminals.delete(terminalId)
        cleaned++
      }
    }
    if (cleaned > 0) {
      console.log(`[WS] Cleaned ${cleaned} stale terminal entries`)
    }
  }, 5 * 60 * 1000)
}

// ─── Main ───

async function main() {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // ─── Internal Emit API (from Next.js API routes) ───
    if (req.method === 'POST' && req.url === '/internal/emit') {
      try {
        const body = JSON.parse(await readBody(req))
        const { type, target, event, data } = body

        let success = false
        if (type === 'location') {
          success = await emitToLocation(target, event, data)
        } else if (type === 'tags') {
          success = await emitToTags(target, event, data)
        } else if (type === 'room') {
          success = await emitToRoom(target, event, data)
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: `Unknown emit type: ${type}` }))
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: success }))
      } catch (err) {
        console.error('[WS] Internal emit error:', err)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }))
      }
      return
    }

    // ─── Health Check ───
    if (req.url === '/health') {
      const socketServer = (globalThis as Record<string, unknown>).socketServer as SocketServer | undefined
      const stats = socketServer
        ? {
            status: 'ok',
            connections: socketServer.engine.clientsCount,
            terminals: connectedTerminals.size,
            uptime: process.uptime(),
          }
        : { status: 'ok', connections: 0, terminals: 0, uptime: process.uptime() }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(stats))
      return
    }

    // ─── 404 ───
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  })

  // ─── Initialize Socket.io on this HTTP server ───
  const socketServer = new SocketServer(httpServer, {
    path: socketPath,
    cors: {
      origin: process.env.NODE_ENV === 'development' ? '*' : process.env.ALLOWED_ORIGINS?.split(','),
      methods: ['GET', 'POST'],
    },
    // Connection settings optimized for local network
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
  })

  // Register in globalThis so emit functions from socket-server.ts work
  setSocketServer(socketServer)

  // Set up all connection/room/event handlers
  setupConnectionHandler(socketServer)

  console.log('[WS] Socket.io server initialized and stored in globalThis')

  httpServer.listen(port, hostname, () => {
    console.log(`[WS] ──────────────────────────────────────────────`)
    console.log(`[WS] WebSocket server ready`)
    console.log(`[WS]   Socket.io:    ws://${hostname}:${port}${socketPath}`)
    console.log(`[WS]   Internal API: http://${hostname}:${port}/internal/emit`)
    console.log(`[WS]   Health:       http://${hostname}:${port}/health`)
    console.log(`[WS]   Mode:         ${process.env.NODE_ENV || 'development'}`)
    console.log(`[WS] ──────────────────────────────────────────────`)
  })
}

main().catch((err) => {
  console.error('[WS] Fatal error:', err)
  process.exit(1)
})
