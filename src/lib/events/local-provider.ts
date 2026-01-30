/**
 * Local Event Provider
 *
 * In-memory event provider for development and single-server deployments.
 * Uses a simple pub/sub pattern without external dependencies.
 *
 * Limitations:
 * - Events only work within the same browser tab
 * - No cross-client communication (use Socket.io or Pusher for that)
 *
 * Use cases:
 * - Development without running a socket server
 * - Testing event flows
 * - Single-tab applications
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

type Listener = {
  event: EventName
  callback: EventCallback<EventName>
  channelFilter?: string
}

/**
 * Local (in-memory) event provider
 */
export class LocalEventProvider implements EventProvider {
  readonly name = 'local'

  private locationId: string | null = null
  private listeners: Listener[] = []
  private subscribedChannels: Set<string> = new Set()
  private connectionState: ConnectionState = {
    status: 'disconnected',
    reconnectAttempts: 0,
  }
  private connectionCallbacks: Array<(state: ConnectionState) => void> = []
  private config: ProviderConfig

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
    this.setConnectionStatus('connecting')
    this.locationId = locationId

    // Simulate connection delay
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Auto-subscribe to location channel
    this.subscribeChannel('location', locationId)
    this.setConnectionStatus('connected')

    if (this.config.debug) {
      console.log(`[LocalEvents] Connected to location: ${locationId}`)
    }
  }

  async disconnect(): Promise<void> {
    this.listeners = []
    this.subscribedChannels.clear()
    this.locationId = null
    this.setConnectionStatus('disconnected')

    if (this.config.debug) {
      console.log('[LocalEvents] Disconnected')
    }
  }

  subscribeChannel(channelType: ChannelType, channelId: string): UnsubscribeFn {
    const channelName = buildChannelName(channelType, channelId)
    this.subscribedChannels.add(channelName)

    if (this.config.debug) {
      console.log(`[LocalEvents] Subscribed to channel: ${channelName}`)
    }

    return () => this.unsubscribeChannel(channelType, channelId)
  }

  unsubscribeChannel(channelType: ChannelType, channelId: string): void {
    const channelName = buildChannelName(channelType, channelId)
    this.subscribedChannels.delete(channelName)

    // Remove listeners for this channel
    this.listeners = this.listeners.filter((l) => l.channelFilter !== channelName)

    if (this.config.debug) {
      console.log(`[LocalEvents] Unsubscribed from channel: ${channelName}`)
    }
  }

  subscribe<T extends EventName>(
    event: T,
    callback: EventCallback<T>,
    channelFilter?: { type: ChannelType; id: string }
  ): UnsubscribeFn {
    const channelName = channelFilter
      ? buildChannelName(channelFilter.type, channelFilter.id)
      : undefined

    const listener: Listener = {
      event,
      callback: callback as EventCallback<EventName>,
      channelFilter: channelName,
    }

    this.listeners.push(listener)

    if (this.config.debug) {
      console.log(`[LocalEvents] Subscribed to event: ${event}`, channelFilter || 'all channels')
    }

    return () => {
      const index = this.listeners.indexOf(listener)
      if (index !== -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  async emit<T extends EventName>(
    event: T,
    data: EventMap[T],
    channel?: { type: ChannelType; id: string }
  ): Promise<void> {
    const channelName = channel ? buildChannelName(channel.type, channel.id) : null

    if (this.config.debug) {
      console.log(`[LocalEvents] Emit: ${event}`, data, channelName || 'broadcast')
    }

    // Find matching listeners
    const matchingListeners = this.listeners.filter((listener) => {
      // Must match event type
      if (listener.event !== event) return false

      // If listener has channel filter, must match
      if (listener.channelFilter && channelName) {
        return listener.channelFilter === channelName
      }

      // If no channel filter on listener, receive all
      return true
    })

    // Call all matching listeners
    matchingListeners.forEach((listener) => {
      try {
        listener.callback(data)
      } catch (error) {
        console.error(`[LocalEvents] Error in listener for ${event}:`, error)
      }
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
 * Create a local event provider instance
 */
export function createLocalProvider(config?: Partial<ProviderConfig>): EventProvider {
  return new LocalEventProvider(config)
}
