/**
 * Socket.io Server Setup for GWI POS
 *
 * Room Architecture:
 * - location:{id} - Global venue alerts (sync status, hardware failures)
 * - tag:{tagName} - Prep stations (pizza KDS only hears tag:pizza)
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

  const socketServer = new Server(httpServer, {
    path: process.env.SOCKET_PATH || '/api/socket',
    cors: {
      origin: process.env.NODE_ENV === 'development' ? '*' : process.env.ALLOWED_ORIGINS?.split(','),
      methods: ['GET', 'POST'],
    },
    // Connection settings optimized for local network
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
  })

  socketServer.on('connection', (socket: Socket) => {
    const clientIp = socket.handshake.address
    if (process.env.DEBUG_SOCKETS) console.log(`[Socket] New connection from ${clientIp} (${socket.id})`)

    // ===== Native client auth via deviceToken =====
    const deviceToken = socket.handshake.auth?.deviceToken as string | undefined
    if (deviceToken && typeof deviceToken === 'string') {
      void (async () => {
        try {
          const terminal = await db.terminal.findFirst({
            where: { deviceToken, deletedAt: null },
            select: { id: true, locationId: true, name: true, platform: true },
          })
          if (!terminal) {
            console.warn(`[Socket] Invalid deviceToken from ${clientIp}, disconnecting`)
            socket.disconnect(true)
            return
          }
          socket.data.terminalId = terminal.id
          socket.data.terminalName = terminal.name
          socket.data.platform = terminal.platform
          socket.data.locationId = terminal.locationId
          socket.join(`location:${terminal.locationId}`)
          if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Native client authenticated: ${terminal.name} (${terminal.platform})`)
        } catch (err) {
          console.error(`[Socket] deviceToken auth error:`, err)
          socket.disconnect(true)
        }
      })()
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
      socket.data.locationId = queryLocationId
      socket.join(`location:${queryLocationId}`)
      if (process.env.DEBUG_SOCKETS) console.log(`[Socket] Auto-joined location:${queryLocationId} from query`)
    }

    // Valid room prefixes for subscribe
    const ALLOWED_ROOM_PREFIXES = ['location:', 'tag:', 'terminal:', 'station:']

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
        tags.forEach((tag: string) => {
          socket.join(`tag:${tag}`)
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
          tags: tags.map(t => `tag:${t}`),
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
    socket.on('order:editing', (data: { orderId: string; terminalId: string; terminalName: string; locationId: string }) => {
      try {
        if (typeof data.locationId === 'string' && typeof data.orderId === 'string') {
          socketServer.to(`location:${data.locationId}`).except(socket.id).emit('order:editing', {
            orderId: data.orderId,
            terminalId: data.terminalId,
            terminalName: data.terminalName,
          })
        }
      } catch (err) {
        console.error(JSON.stringify({ event: 'order:editing', socketId: socket.id, error: String(err) }))
      }
    })

    socket.on('order:editing-released', (data: { orderId: string; terminalId: string; locationId: string }) => {
      try {
        if (typeof data.locationId === 'string' && typeof data.orderId === 'string') {
          socketServer.to(`location:${data.locationId}`).except(socket.id).emit('order:editing-released', {
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
    socket.on(MOBILE_EVENTS.TAB_CLOSE_REQUEST, (data: { orderId: string; locationId: string; employeeId: string; tipMode: string }) => {
      try {
        if (typeof data.locationId !== 'string') return
        socketServer.to(`location:${data.locationId}`).except(socket.id).emit(MOBILE_EVENTS.TAB_CLOSE_REQUEST, data)
      } catch (err) {
        console.error(JSON.stringify({ event: 'TAB_CLOSE_REQUEST', socketId: socket.id, error: String(err) }))
      }
    })

    // Phone → relay transfer request to all terminals in location
    socket.on(MOBILE_EVENTS.TAB_TRANSFER_REQUEST, (data: { orderId: string; locationId: string; employeeId: string }) => {
      try {
        if (typeof data.locationId !== 'string') return
        socketServer.to(`location:${data.locationId}`).except(socket.id).emit(MOBILE_EVENTS.TAB_TRANSFER_REQUEST, data)
      } catch (err) {
        console.error(JSON.stringify({ event: 'TAB_TRANSFER_REQUEST', socketId: socket.id, error: String(err) }))
      }
    })

    // Phone → relay manager alert to all terminals in location (fire-and-forget, no response needed)
    socket.on(MOBILE_EVENTS.TAB_ALERT_MANAGER, (data: { orderId: string; locationId: string; employeeId: string }) => {
      try {
        if (typeof data.locationId !== 'string') return
        socketServer.to(`location:${data.locationId}`).emit(MOBILE_EVENTS.TAB_ALERT_MANAGER, data)
      } catch (err) {
        console.error(JSON.stringify({ event: 'TAB_ALERT_MANAGER', socketId: socket.id, error: String(err) }))
      }
    })

    // ==================== Direct Terminal Messages ====================

    /**
     * Send message to specific terminal
     */
    socket.on('terminal_message', ({ terminalId, event, data }: {
      terminalId: string
      event: string
      data: unknown
    }) => {
      try {
        socketServer.to(`terminal:${terminalId}`).emit(event, data)
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
 */
export async function emitToTags(tags: string[], event: string, data: unknown): Promise<boolean> {
  if (globalForSocket.socketServer) {
    tags.forEach((tag) => {
      globalForSocket.socketServer!.to(`tag:${tag}`).emit(event, data)
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
