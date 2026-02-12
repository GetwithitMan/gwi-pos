/**
 * Socket.io Event Provider
 *
 * Real-time event provider using Socket.io for WebSocket communication.
 * Use this for local server deployments where you control the infrastructure.
 *
 * Requirements:
 * - npm install socket.io-client
 * - A Socket.io server running (see /api/socket for Next.js integration)
 *
 * Note: Socket.io does NOT work with Vercel serverless functions.
 * For serverless deployments, use Pusher or Ably provider instead.
 */

import type {
  EventMap,
  EventName,
  EventCallback,
  UnsubscribeFn,
  ChannelType,
  ConnectionState,
  ConnectionStatus,
} from './types'
import { buildChannelName } from './types'
import type { EventProvider, ProviderConfig } from './provider'
import { DEFAULT_PROVIDER_CONFIG } from './provider'

// Socket.io types (optional dependency)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Socket = any

/**
 * Socket.io event provider
 *
 * Requires socket.io-client to be installed:
 * npm install socket.io-client
 */
export class SocketEventProvider implements EventProvider {
  readonly name = 'socket.io'

  private socket: Socket | null = null
  private locationId: string | null = null
  private subscribedChannels: Set<string> = new Set()
  private connectionState: ConnectionState = {
    status: 'disconnected',
    reconnectAttempts: 0,
  }
  private connectionCallbacks: Array<(state: ConnectionState) => void> = []
  private config: ProviderConfig
  private eventListeners: Map<string, Set<EventCallback<EventName>>> = new Map()

  constructor(config?: Partial<ProviderConfig>) {
    this.config = { ...DEFAULT_PROVIDER_CONFIG, ...config }
  }

  getConnectionState(): ConnectionState {
    return { ...this.connectionState }
  }

  private setConnectionStatus(status: ConnectionStatus, error?: string): void {
    this.connectionState = {
      ...this.connectionState,
      status,
      error,
      lastConnected: status === 'connected' ? new Date() : this.connectionState.lastConnected,
    }
    this.connectionCallbacks.forEach((cb) => cb(this.connectionState))
  }

  async connect(locationId: string, authToken?: string): Promise<void> {
    // Dynamically import socket.io-client
    let io: (url: string, opts: object) => Socket

    try {
      // Dynamic import - socket.io-client is a listed dependency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const socketIo = await import('socket.io-client') as any
      io = socketIo.io || socketIo.default?.io || socketIo.default
    } catch {
      throw new Error(
        'socket.io-client is not installed. Run: npm install socket.io-client'
      )
    }

    this.setConnectionStatus('connecting')
    this.locationId = locationId

    const serverUrl = this.config.serverUrl || window.location.origin

    this.socket = io(serverUrl, {
      path: '/api/socket',
      auth: authToken ? { token: authToken } : undefined,
      query: { locationId },
      transports: ['websocket', 'polling'],
      reconnection: this.config.reconnect?.enabled ?? true,
      reconnectionAttempts: this.config.reconnect?.maxAttempts ?? 10,
      reconnectionDelay: this.config.reconnect?.delayMs ?? 1000,
      reconnectionDelayMax: this.config.reconnect?.maxDelayMs ?? 30000,
    })

    // Set up connection event handlers
    this.socket.on('connect', () => {
      this.setConnectionStatus('connected')
      this.connectionState.reconnectAttempts = 0

      // Re-subscribe to channels after reconnection
      this.subscribedChannels.forEach((channelName) => {
        this.socket?.emit('subscribe', channelName)
      })
    })

    this.socket.on('disconnect', (reason: string) => {
      if (reason === 'io server disconnect') {
        // Server disconnected us, don't auto-reconnect
        this.setConnectionStatus('disconnected')
      } else {
        // Client-side disconnect or network issue
        this.setConnectionStatus('reconnecting')
      }
    })

    this.socket.on('connect_error', (error: Error) => {
      this.connectionState.reconnectAttempts++
      this.setConnectionStatus('error', error.message)

      if (this.config.debug) {
        console.error(`[SocketEvents] Connection error:`, error)
      }
    })

    this.socket.on('reconnect_attempt', (attempt: number) => {
      this.connectionState.reconnectAttempts = attempt
      this.setConnectionStatus('reconnecting')

    })

    this.socket.on('reconnect_failed', () => {
      this.setConnectionStatus('error', 'Reconnection failed')
    })

    // Set up event forwarding from server
    this.socket.onAny((eventName: string, data: EventMap[EventName]) => {
      console.log(`[SocketEvents] Received: ${eventName}`, { hasListeners: this.eventListeners.has(eventName), listenerCount: this.eventListeners.get(eventName)?.size ?? 0 })
      const listeners = this.eventListeners.get(eventName)
      if (listeners) {
        listeners.forEach((callback) => {
          try {
            callback(data)
          } catch (error) {
            console.error(`[SocketEvents] Error in listener for ${eventName}:`, error)
          }
        })
      }
    })

    // Auto-subscribe to location channel
    this.subscribeChannel('location', locationId)

    // Wait for connection
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
      }, 10000)

      this.socket!.once('connect', () => {
        clearTimeout(timeout)
        resolve()
      })

      this.socket!.once('connect_error', (error: Error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }

    this.eventListeners.clear()
    this.subscribedChannels.clear()
    this.locationId = null
    this.setConnectionStatus('disconnected')

  }

  subscribeChannel(channelType: ChannelType, channelId: string): UnsubscribeFn {
    const channelName = buildChannelName(channelType, channelId)
    this.subscribedChannels.add(channelName)

    if (this.socket?.connected) {
      this.socket.emit('subscribe', channelName)
    }

    return () => this.unsubscribeChannel(channelType, channelId)
  }

  unsubscribeChannel(channelType: ChannelType, channelId: string): void {
    const channelName = buildChannelName(channelType, channelId)
    this.subscribedChannels.delete(channelName)

    if (this.socket?.connected) {
      this.socket.emit('unsubscribe', channelName)
    }

  }

  subscribe<T extends EventName>(
    event: T,
    callback: EventCallback<T>,
    channelFilter?: { type: ChannelType; id: string }
  ): UnsubscribeFn {
    // Build event key (with channel filter if provided)
    const eventKey = channelFilter
      ? `${buildChannelName(channelFilter.type, channelFilter.id)}:${event}`
      : event

    if (!this.eventListeners.has(eventKey)) {
      this.eventListeners.set(eventKey, new Set())
    }

    this.eventListeners.get(eventKey)!.add(callback as EventCallback<EventName>)

    return () => {
      const listeners = this.eventListeners.get(eventKey)
      if (listeners) {
        listeners.delete(callback as EventCallback<EventName>)
        if (listeners.size === 0) {
          this.eventListeners.delete(eventKey)
        }
      }
    }
  }

  async emit<T extends EventName>(
    event: T,
    data: EventMap[T],
    channel?: { type: ChannelType; id: string }
  ): Promise<void> {
    if (!this.socket?.connected) {
      throw new Error('Not connected to event server')
    }

    const channelName = channel ? buildChannelName(channel.type, channel.id) : null
    const payload = { event, data, channel: channelName }

    return new Promise((resolve, reject) => {
      this.socket!.emit('event', payload, (response: { success: boolean; error?: string }) => {
        if (response?.success) {
          resolve()
        } else {
          reject(new Error(response?.error || 'Failed to emit event'))
        }
      })
    })
  }

  onConnectionChange(callback: (state: ConnectionState) => void): UnsubscribeFn {
    this.connectionCallbacks.push(callback)
    // Immediately call with current state
    callback(this.connectionState)

    return () => {
      const index = this.connectionCallbacks.indexOf(callback)
      if (index !== -1) {
        this.connectionCallbacks.splice(index, 1)
      }
    }
  }
}

/**
 * Create a Socket.io event provider instance
 *
 * @param config - Provider configuration
 * @returns EventProvider instance
 *
 * @example
 * ```typescript
 * const provider = createSocketProvider({
 *   serverUrl: 'http://localhost:3000',
 *   debug: true,
 * })
 * await provider.connect('location_123')
 * ```
 */
export function createSocketProvider(config?: Partial<ProviderConfig>): EventProvider {
  return new SocketEventProvider(config)
}
