/**
 * Socket.io Event Provider
 *
 * Real-time event provider using Socket.io for WebSocket communication.
 * Uses the shared socket singleton from @/lib/shared-socket to avoid
 * multiple connections per browser tab.
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
 * Socket.io event provider using shared socket singleton
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
  private pendingEvents: Map<string, { data: unknown; timer: ReturnType<typeof setTimeout> }> = new Map()
  private readonly DEBOUNCE_MS = 150

  // Named handler references for proper cleanup
  private onConnectHandler: (() => void) | null = null
  private onDisconnectHandler: ((reason: string) => void) | null = null
  private onConnectErrorHandler: ((error: Error) => void) | null = null
  private onReconnectAttemptHandler: ((attempt: number) => void) | null = null
  private onReconnectFailedHandler: (() => void) | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onAnyHandler: ((eventName: string, data: any) => void) | null = null

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

  async connect(locationId: string): Promise<void> {
    // Use shared socket singleton instead of creating our own connection
    let getSharedSocket: () => Socket

    try {
      const shared = await import('@/lib/shared-socket')
      getSharedSocket = shared.getSharedSocket
    } catch {
      throw new Error(
        'shared-socket module not found'
      )
    }

    this.setConnectionStatus('connecting')
    this.locationId = locationId

    this.socket = getSharedSocket()

    // Create named handlers for proper cleanup
    this.onConnectHandler = () => {
      this.setConnectionStatus('connected')
      this.connectionState.reconnectAttempts = 0

      // Re-subscribe to channels after reconnection
      this.subscribedChannels.forEach((channelName) => {
        this.socket?.emit('subscribe', channelName)
      })
    }

    this.onDisconnectHandler = (reason: string) => {
      if (reason === 'io server disconnect') {
        this.setConnectionStatus('disconnected')
      } else {
        this.setConnectionStatus('reconnecting')
      }
    }

    this.onConnectErrorHandler = (error: Error) => {
      this.connectionState.reconnectAttempts++
      this.setConnectionStatus('error', error.message)

      if (this.config.debug) {
        console.error(`[SocketEvents] Connection error:`, error)
      }
    }

    this.onReconnectAttemptHandler = (attempt: number) => {
      this.connectionState.reconnectAttempts = attempt
      this.setConnectionStatus('reconnecting')
    }

    this.onReconnectFailedHandler = () => {
      this.setConnectionStatus('error', 'Reconnection failed')
    }

    // Event forwarding with debouncing
    this.onAnyHandler = (eventName: string, data: EventMap[EventName]) => {
      const listeners = this.eventListeners.get(eventName)
      if (!listeners || listeners.size === 0) return

      const pending = this.pendingEvents.get(eventName)
      if (pending) {
        clearTimeout(pending.timer)
      }

      const timer = setTimeout(() => {
        this.pendingEvents.delete(eventName)
        const currentListeners = this.eventListeners.get(eventName)
        if (currentListeners) {
          currentListeners.forEach((callback) => {
            try {
              callback(data)
            } catch (error) {
              console.error(`[SocketEvents] Error in listener for ${eventName}:`, error)
            }
          })
        }
      }, this.DEBOUNCE_MS)

      this.pendingEvents.set(eventName, { data, timer })
    }

    // Register handlers on shared socket
    this.socket.on('connect', this.onConnectHandler)
    this.socket.on('disconnect', this.onDisconnectHandler)
    this.socket.on('connect_error', this.onConnectErrorHandler)
    this.socket.on('reconnect_attempt', this.onReconnectAttemptHandler)
    this.socket.on('reconnect_failed', this.onReconnectFailedHandler)
    this.socket.onAny(this.onAnyHandler)

    // Auto-subscribe to location channel
    this.subscribeChannel('location', locationId)

    // If already connected (shared socket was created by another consumer), resolve immediately
    if (this.socket.connected) {
      this.onConnectHandler()
      return Promise.resolve()
    }

    // Wait for connection with proper listener cleanup on timeout
    return new Promise((resolve, reject) => {
      const onceConnect = () => {
        clearTimeout(timeout)
        this.socket!.off('connect_error', onceConnectError)
        resolve()
      }
      const onceConnectError = (error: Error) => {
        clearTimeout(timeout)
        this.socket!.off('connect', onceConnect)
        reject(error)
      }
      const timeout = setTimeout(() => {
        // Clean up both listeners to prevent leaks
        this.socket!.off('connect', onceConnect)
        this.socket!.off('connect_error', onceConnectError)
        reject(new Error('Connection timeout'))
      }, 10000)

      this.socket!.once('connect', onceConnect)
      this.socket!.once('connect_error', onceConnectError)
    })
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      // Remove our handlers from the shared socket (don't disconnect it)
      if (this.onConnectHandler) this.socket.off('connect', this.onConnectHandler)
      if (this.onDisconnectHandler) this.socket.off('disconnect', this.onDisconnectHandler)
      if (this.onConnectErrorHandler) this.socket.off('connect_error', this.onConnectErrorHandler)
      if (this.onReconnectAttemptHandler) this.socket.off('reconnect_attempt', this.onReconnectAttemptHandler)
      if (this.onReconnectFailedHandler) this.socket.off('reconnect_failed', this.onReconnectFailedHandler)
      if (this.onAnyHandler) this.socket.offAny(this.onAnyHandler)

      // Release our reference to the shared socket
      try {
        const { releaseSharedSocket } = await import('@/lib/shared-socket')
        releaseSharedSocket()
      } catch {
        // Ignore if module not available during cleanup
      }

      this.socket = null
    }

    this.onConnectHandler = null
    this.onDisconnectHandler = null
    this.onConnectErrorHandler = null
    this.onReconnectAttemptHandler = null
    this.onReconnectFailedHandler = null
    this.onAnyHandler = null

    this.eventListeners.clear()
    // Clear pending debounce timers
    for (const pending of this.pendingEvents.values()) {
      clearTimeout(pending.timer)
    }
    this.pendingEvents.clear()
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
      const timeout = setTimeout(() => {
        reject(new Error(`emit("${event}") timed out after 10s`))
      }, 10000)

      this.socket!.emit('event', payload, (response: { success: boolean; error?: string }) => {
        clearTimeout(timeout)
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
 */
export function createSocketProvider(config?: Partial<ProviderConfig>): EventProvider {
  return new SocketEventProvider(config)
}
