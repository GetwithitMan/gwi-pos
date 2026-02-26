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
 * Includes Android/mobile visibility handling: when the app returns
 * to foreground, we probe the socket and force reconnect if stale.
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
let visibilityHandlerAttached = false
let lastPongAt = 0 // Timestamp of last successful pong/event from server

// Stable terminal ID per tab (survives component re-mounts AND page refreshes via sessionStorage)
let stableTerminalId: string | null = null
const TERMINAL_ID_KEY = 'gwi-pos-terminal-id'

export function getTerminalId(): string {
  if (!stableTerminalId) {
    try {
      stableTerminalId = sessionStorage.getItem(TERMINAL_ID_KEY)
    } catch {
      // sessionStorage unavailable (SSR, sandboxed iframe)
    }
    if (!stableTerminalId) {
      stableTerminalId = 'pos-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
      try {
        sessionStorage.setItem(TERMINAL_ID_KEY, stableTerminalId)
      } catch {
        // sessionStorage unavailable
      }
    }
  }
  return stableTerminalId
}

/**
 * Handle Android/mobile visibility change.
 *
 * When the app returns to foreground after being backgrounded:
 * 1. The OS may have frozen JS (server pings timed out → socket dead)
 * 2. The TCP connection may have been silently killed
 * 3. The socket object still reports connected (zombie state)
 *
 * We force a disconnect→reconnect cycle to guarantee a fresh connection.
 * Socket.io's 'connect' event will fire after reconnect, which triggers
 * room rejoin + data refresh in consumer components.
 */
function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  if (!sharedSocket) return

  const now = Date.now()
  const timeSinceLastPong = now - lastPongAt

  // If we haven't received any server data in >30s, the socket is likely stale
  // (server pings every 25s, so 30s without a pong = zombie connection)
  if (sharedSocket.connected && timeSinceLastPong > 30_000) {
    console.log('[SharedSocket] Foreground return — socket stale (no pong in', Math.round(timeSinceLastPong / 1000), 's). Forcing reconnect.')
    sharedSocket.disconnect()
    // Small delay before reconnect so disconnect completes cleanly
    setTimeout(() => {
      if (sharedSocket && !sharedSocket.connected) {
        sharedSocket.connect()
      }
    }, 100)
    return
  }

  // If socket reports disconnected, kick off reconnect immediately
  if (!sharedSocket.connected) {
    console.log('[SharedSocket] Foreground return — socket disconnected. Reconnecting.')
    sharedSocket.connect()
  }
}

/**
 * Attach the visibility handler once (idempotent).
 * Also wire up pong tracking on the socket.
 */
function attachVisibilityHandler(socket: Socket) {
  if (visibilityHandlerAttached) return
  if (typeof document === 'undefined') return

  visibilityHandlerAttached = true
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // Track last successful data receipt from server.
  // We use multiple events as "proof of life" signals:
  // - pong (built-in socket.io heartbeat response)
  // - connect (just connected/reconnected)
  // - Any incoming event at all (via onAny)
  lastPongAt = Date.now()

  socket.io.on('ping', () => {
    lastPongAt = Date.now()
  })

  socket.on('connect', () => {
    lastPongAt = Date.now()
  })

  // Any incoming event from the server = proof of life
  socket.onAny(() => {
    lastPongAt = Date.now()
  })
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
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
    })

    attachVisibilityHandler(sharedSocket)
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
