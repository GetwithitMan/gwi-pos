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
    console.log(`[Socket] New connection from ${clientIp} (${socket.id})`)

    // Auto-join location room from handshake query (used by SocketEventProvider)
    const queryLocationId = socket.handshake.query?.locationId as string | undefined
    if (queryLocationId) {
      socket.join(`location:${queryLocationId}`)
      console.log(`[Socket] Auto-joined location:${queryLocationId} from query`)
    }

    // Handle channel subscribe/unsubscribe from SocketEventProvider
    socket.on('subscribe', (channelName: string) => {
      socket.join(channelName)
    })
    socket.on('unsubscribe', (channelName: string) => {
      socket.leave(channelName)
    })

    // ==================== Room Management ====================

    /**
     * Join station rooms based on terminal identity
     * Called when a KDS/terminal starts up
     */
    socket.on('join_station', ({ locationId, tags, terminalId, stationId }: JoinStationPayload) => {
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

      // Track connection
      connectedTerminals.set(terminalId, {
        socketId: socket.id,
        locationId,
        tags,
        connectedAt: new Date(),
      })

      console.log(`[Socket] Terminal ${terminalId} joined rooms:`, {
        location: `location:${locationId}`,
        tags: tags.map(t => `tag:${t}`),
        station: stationId ? `station:${stationId}` : null,
      })

      // Acknowledge successful join
      socket.emit('joined', { success: true, rooms: socket.rooms.size })
    })

    /**
     * Leave station rooms (cleanup)
     */
    socket.on('leave_station', ({ terminalId }: { terminalId: string }) => {
      connectedTerminals.delete(terminalId)
      // Socket.io automatically cleans up room memberships on disconnect
    })

    // ==================== Order Events ====================

    /**
     * New order "fired" to kitchen
     * Dispatches to tag-based rooms from routing manifest
     */
    socket.on('new_order', (manifest: OrderRoutingManifest) => {
      console.log(`[Socket] New order routing to ${manifest.destinations.length} destinations`)

      manifest.destinations.forEach((dest) => {
        // Send to tag-specific room
        socketServer.to(`tag:${dest.tag}`).emit('kds:order-received', dest.orderData)

        // Also send to expo (they see everything)
        if (dest.tag !== 'expo') {
          const expoData = typeof dest.orderData === 'object' && dest.orderData !== null
            ? { ...(dest.orderData as Record<string, unknown>), isExpoView: true }
            : { orderData: dest.orderData, isExpoView: true }
          socketServer.to('tag:expo').emit('kds:order-received', expoData)
        }
      })

      // Broadcast to location for general awareness
      socketServer.to(`location:${manifest.locationId}`).emit('order:created', {
        destinations: manifest.destinations.map(d => d.stationName),
      })
    })

    // ==================== Item/Ticket Bumping ====================

    /**
     * Item status changed (cooking → ready, etc.)
     * Notify Expo and the originating terminal
     */
    socket.on('item_status', (payload: ItemBumpPayload) => {
      const update = {
        orderId: payload.orderId,
        itemId: payload.itemId,
        status: payload.status,
        updatedBy: payload.bumpedBy,
        updatedAt: new Date().toISOString(),
        stationId: payload.stationId,
      }

      // Notify all expo stations
      socketServer.to('tag:expo').emit('kds:item-status', update)

      // Notify all stations (they may need to update reference items)
      socketServer.to(`location:${socket.data.locationId}`).emit('kds:item-status', update)

      console.log(`[Socket] Item ${payload.itemId} → ${payload.status}`)
    })

    /**
     * Order bumped from station (all items done)
     */
    socket.on('order_bumped', (payload: OrderBumpPayload) => {
      const update = {
        orderId: payload.orderId,
        stationId: payload.stationId,
        bumpedBy: payload.bumpedBy,
        bumpedAt: new Date().toISOString(),
        allItemsServed: payload.allItemsServed,
      }

      // Notify expo
      socketServer.to('tag:expo').emit('kds:order-bumped', update)

      // Notify location
      socketServer.to(`location:${socket.data.locationId}`).emit('kds:order-bumped', update)

      console.log(`[Socket] Order ${payload.orderId} bumped from ${payload.stationId}`)
    })

    // ==================== Entertainment Events ====================

    /**
     * Entertainment session update (timer started/extended/stopped)
     */
    socket.on('entertainment_update', (payload: EntertainmentUpdatePayload) => {
      // Broadcast to entertainment tag
      socketServer.to('tag:entertainment').emit('entertainment:session-update', payload)

      // Also broadcast to location for POS terminals
      socketServer.to(`location:${payload.locationId}`).emit('entertainment:session-update', payload)

      console.log(`[Socket] Entertainment ${payload.action}: ${payload.tableName}`)
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
      socketServer.to(`terminal:${terminalId}`).emit(event, data)
    })

    // ==================== Sync Events ====================

    /**
     * Sync completed notification
     */
    socket.on('sync_completed', ({ terminalId, stats }: {
      terminalId: string
      stats: { pushed: number; pulled: number; conflicts: number }
    }) => {
      socketServer.to(`terminal:${terminalId}`).emit('sync:completed', stats)
    })

    // ==================== Connection Lifecycle ====================

    socket.on('disconnect', (reason: string) => {
      // Clean up terminal tracking
      for (const [terminalId, info] of connectedTerminals.entries()) {
        if (info.socketId === socket.id) {
          connectedTerminals.delete(terminalId)
          console.log(`[Socket] Terminal ${terminalId} disconnected: ${reason}`)
          break
        }
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
      console.log(`[Socket] Status:`, stats)
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
      console.log(`[Socket] Cleaned ${cleaned} stale terminal entries`)
    }
  }, 5 * 60 * 1000) // Every 5 minutes

  // Store in global so API routes can emit events (survives HMR)
  setSocketServer(socketServer)
  console.log('[Socket] Server initialized and stored in globalThis')
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
    console.log(`[Socket] emitToLocation: ${event} → ${room} (${roomSockets?.size ?? 0} clients)`)
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
