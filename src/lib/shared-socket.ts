'use client'

import { io, type Socket } from 'socket.io-client'

/**
 * Shared Socket.io connection — one per browser tab.
 *
 * Replaces individual io() calls scattered across components.
 * All consumers share this single WebSocket connection and add
 * their own event listeners. Socket auto-disconnects when the
 * last consumer releases it.
 *
 * Usage:
 *   const socket = getSharedSocket()
 *   socket.on('my-event', handler)
 *   // on cleanup:
 *   socket.off('my-event', handler)
 *   releaseSharedSocket()
 */

let sharedSocket: Socket | null = null
let refCount = 0

// Stable terminal ID per tab (survives component re-mounts)
let stableTerminalId: string | null = null

export function getTerminalId(): string {
  if (!stableTerminalId) {
    stableTerminalId = 'pos-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  }
  return stableTerminalId
}

/**
 * Get the shared socket connection.
 * Creates it lazily on first call. Increments ref count.
 * Call releaseSharedSocket() when your component unmounts.
 */
export function getSharedSocket(): Socket {
  if (!sharedSocket) {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL
    const serverUrl = wsUrl || process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin
    // Standalone ws-server uses /ws path; monolithic uses /api/socket
    const socketPath = wsUrl ? '/ws' : '/api/socket'

    sharedSocket = io(serverUrl, {
      path: socketPath,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    })
  }
  refCount++
  return sharedSocket
}

/**
 * Release a reference to the shared socket.
 * Socket disconnects only when all consumers have released.
 */
export function releaseSharedSocket(): void {
  refCount = Math.max(0, refCount - 1)
  if (refCount === 0 && sharedSocket) {
    sharedSocket.disconnect()
    sharedSocket = null
  }
}

/**
 * Check if the shared socket exists and is connected.
 */
export function isSharedSocketConnected(): boolean {
  return sharedSocket?.connected ?? false
}
