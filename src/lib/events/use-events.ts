'use client'

/**
 * React Hook for Real-time Events
 *
 * Provides easy access to the event system from React components.
 *
 * @example
 * ```typescript
 * function OrdersPage() {
 *   const { subscribe, emit, connectionStatus } = useEvents()
 *
 *   useEffect(() => {
 *     const unsubscribe = subscribe('order:created', (data) => {
 *       console.log('New order:', data)
 *     })
 *     return unsubscribe
 *   }, [subscribe])
 *
 *   const handleNewOrder = () => {
 *     emit('order:created', { orderId: '123', ... })
 *   }
 * }
 * ```
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import type {
  EventMap,
  EventName,
  EventCallback,
  UnsubscribeFn,
  ChannelType,
  ConnectionState,
} from './types'
import type { EventProvider } from './provider'
import { getEventProvider } from './index'

interface UseEventsOptions {
  /**
   * Location ID to connect to (required for connecting)
   */
  locationId?: string

  /**
   * Authentication token
   */
  authToken?: string

  /**
   * Auto-connect on mount (default: true if locationId provided)
   */
  autoConnect?: boolean

  /**
   * Channels to auto-subscribe to
   */
  channels?: Array<{ type: ChannelType; id: string }>
}

interface UseEventsReturn {
  /**
   * Current connection status
   */
  connectionStatus: ConnectionState['status']

  /**
   * Full connection state
   */
  connectionState: ConnectionState

  /**
   * Whether currently connected
   */
  isConnected: boolean

  /**
   * Connect to the event server
   */
  connect: (locationId: string, authToken?: string) => Promise<void>

  /**
   * Disconnect from the event server
   */
  disconnect: () => Promise<void>

  /**
   * Subscribe to an event
   */
  subscribe: <T extends EventName>(
    event: T,
    callback: EventCallback<T>,
    channelFilter?: { type: ChannelType; id: string }
  ) => UnsubscribeFn

  /**
   * Emit an event
   */
  emit: <T extends EventName>(
    event: T,
    data: EventMap[T],
    channel?: { type: ChannelType; id: string }
  ) => Promise<void>

  /**
   * Subscribe to a channel
   */
  subscribeChannel: (channelType: ChannelType, channelId: string) => UnsubscribeFn

  /**
   * Unsubscribe from a channel
   */
  unsubscribeChannel: (channelType: ChannelType, channelId: string) => void
}

/**
 * React hook for accessing the event system
 */
export function useEvents(options: UseEventsOptions = {}): UseEventsReturn {
  const { locationId, authToken, autoConnect = true, channels = [] } = options

  const providerRef = useRef<EventProvider | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'disconnected',
    reconnectAttempts: 0,
  })

  // Get or create provider
  const getProvider = useCallback((): EventProvider => {
    if (!providerRef.current) {
      providerRef.current = getEventProvider()
    }
    return providerRef.current
  }, [])

  // Connect
  const connect = useCallback(async (locId: string, token?: string) => {
    const provider = getProvider()
    await provider.connect(locId, token)
  }, [getProvider])

  // Disconnect
  const disconnect = useCallback(async () => {
    const provider = getProvider()
    await provider.disconnect()
  }, [getProvider])

  // Subscribe to event
  const subscribe = useCallback(<T extends EventName>(
    event: T,
    callback: EventCallback<T>,
    channelFilter?: { type: ChannelType; id: string }
  ): UnsubscribeFn => {
    const provider = getProvider()
    return provider.subscribe(event, callback, channelFilter)
  }, [getProvider])

  // Emit event
  const emit = useCallback(async <T extends EventName>(
    event: T,
    data: EventMap[T],
    channel?: { type: ChannelType; id: string }
  ): Promise<void> => {
    const provider = getProvider()
    await provider.emit(event, data, channel)
  }, [getProvider])

  // Subscribe to channel
  const subscribeChannel = useCallback((channelType: ChannelType, channelId: string): UnsubscribeFn => {
    const provider = getProvider()
    return provider.subscribeChannel(channelType, channelId)
  }, [getProvider])

  // Unsubscribe from channel
  const unsubscribeChannel = useCallback((channelType: ChannelType, channelId: string): void => {
    const provider = getProvider()
    provider.unsubscribeChannel(channelType, channelId)
  }, [getProvider])

  // Set up connection state listener
  useEffect(() => {
    const provider = getProvider()
    const unsubscribe = provider.onConnectionChange(setConnectionState)
    return unsubscribe
  }, [getProvider])

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect && locationId) {
      connect(locationId, authToken).catch((error) => {
        console.error('[useEvents] Auto-connect failed:', error)
      })
    }

    // Disconnect on unmount
    return () => {
      if (autoConnect && locationId) {
        disconnect().catch(() => {
          // Ignore disconnect errors on unmount
        })
      }
    }
  }, [autoConnect, locationId, authToken, connect, disconnect])

  // Auto-subscribe to channels
  useEffect(() => {
    if (connectionState.status !== 'connected') return

    const unsubscribes: UnsubscribeFn[] = []

    channels.forEach(({ type, id }) => {
      unsubscribes.push(subscribeChannel(type, id))
    })

    return () => {
      unsubscribes.forEach((unsub) => unsub())
    }
  }, [connectionState.status, channels, subscribeChannel])

  return {
    connectionStatus: connectionState.status,
    connectionState,
    isConnected: connectionState.status === 'connected',
    connect,
    disconnect,
    subscribe,
    emit,
    subscribeChannel,
    unsubscribeChannel,
  }
}

/**
 * Hook for subscribing to a specific event
 *
 * @example
 * ```typescript
 * function KDSPage() {
 *   useEventSubscription('kds:ticket-new', (data) => {
 *     playNotificationSound()
 *     setTickets(prev => [...prev, data])
 *   }, { type: 'kds', id: stationId })
 * }
 * ```
 */
export function useEventSubscription<T extends EventName>(
  event: T,
  callback: EventCallback<T>,
  channelFilter?: { type: ChannelType; id: string },
  deps: unknown[] = []
): void {
  const { subscribe, isConnected } = useEvents()

  useEffect(() => {
    if (!isConnected) return

    const unsubscribe = subscribe(event, callback, channelFilter)
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, isConnected, event, channelFilter?.type, channelFilter?.id, ...deps])
}

/**
 * Hook for connection status monitoring
 *
 * @example
 * ```typescript
 * function StatusIndicator() {
 *   const { isConnected, status, reconnectAttempts } = useConnectionStatus()
 *
 *   if (!isConnected) {
 *     return <div>Reconnecting... (attempt {reconnectAttempts})</div>
 *   }
 *   return <div className="text-green-500">Connected</div>
 * }
 * ```
 */
export function useConnectionStatus(): {
  isConnected: boolean
  status: ConnectionState['status']
  reconnectAttempts: number
  lastConnected?: Date
  error?: string
} {
  const { connectionState } = useEvents()

  return {
    isConnected: connectionState.status === 'connected',
    status: connectionState.status,
    reconnectAttempts: connectionState.reconnectAttempts,
    lastConnected: connectionState.lastConnected,
    error: connectionState.error,
  }
}
