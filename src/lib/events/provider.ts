/**
 * Event Provider Interface
 *
 * Abstract interface for real-time event providers.
 * Implementations can use Socket.io, Pusher, Ably, or polling.
 *
 * Provider pattern enables easy swapping:
 * - Development: Socket.io or Polling
 * - Production: Pusher or Ably (serverless-compatible)
 */

import type {
  EventMap,
  EventName,
  EventCallback,
  UnsubscribeFn,
  ChannelType,
  ConnectionState,
} from './types'

/**
 * Event Provider Interface
 *
 * All real-time providers must implement this interface.
 */
export interface EventProvider {
  /**
   * Provider name for debugging
   */
  readonly name: string

  /**
   * Current connection state
   */
  getConnectionState(): ConnectionState

  /**
   * Connect to the event service
   * @param locationId - The location to connect to
   * @param authToken - Optional authentication token
   */
  connect(locationId: string, authToken?: string): Promise<void>

  /**
   * Disconnect from the event service
   */
  disconnect(): Promise<void>

  /**
   * Subscribe to a channel
   * @param channelType - Type of channel (location, table, kds, etc.)
   * @param channelId - ID for the channel
   */
  subscribeChannel(channelType: ChannelType, channelId: string): UnsubscribeFn

  /**
   * Unsubscribe from a channel
   * @param channelType - Type of channel
   * @param channelId - ID for the channel
   */
  unsubscribeChannel(channelType: ChannelType, channelId: string): void

  /**
   * Subscribe to a specific event type
   * @param event - Event name to subscribe to
   * @param callback - Callback function when event is received
   * @param channelFilter - Optional channel to filter events
   */
  subscribe<T extends EventName>(
    event: T,
    callback: EventCallback<T>,
    channelFilter?: { type: ChannelType; id: string }
  ): UnsubscribeFn

  /**
   * Emit an event
   * @param event - Event name
   * @param data - Event payload
   * @param channel - Optional channel to emit to
   */
  emit<T extends EventName>(
    event: T,
    data: EventMap[T],
    channel?: { type: ChannelType; id: string }
  ): Promise<void>

  /**
   * Register a connection state change listener
   */
  onConnectionChange(callback: (state: ConnectionState) => void): UnsubscribeFn
}

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  /**
   * Base URL for the event server (Socket.io)
   */
  serverUrl?: string

  /**
   * Pusher app key (for Pusher provider)
   */
  pusherKey?: string

  /**
   * Pusher cluster (for Pusher provider)
   */
  pusherCluster?: string

  /**
   * Ably API key (for Ably provider)
   */
  ablyKey?: string

  /**
   * Reconnection settings
   */
  reconnect?: {
    enabled: boolean
    maxAttempts: number
    delayMs: number
    maxDelayMs: number
  }

  /**
   * Debug mode - logs all events
   */
  debug?: boolean
}

/**
 * Default configuration
 */
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    delayMs: 1000,
    maxDelayMs: 30000,
  },
  debug: process.env.NODE_ENV === 'development',
}

/**
 * Provider factory type for creating providers
 */
export type ProviderFactory = (config?: Partial<ProviderConfig>) => EventProvider
