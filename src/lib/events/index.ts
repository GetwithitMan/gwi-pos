/**
 * GWI POS Real-time Events System
 *
 * Provides a provider-agnostic abstraction for real-time events.
 * Can be backed by Socket.io (dev), Pusher (prod), or Ably (alt).
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────┐
 * │                  Event Layer                     │
 * │  emit('order:created', data)                    │
 * │  subscribe('table:status', callback)            │
 * ├─────────────────────────────────────────────────┤
 * │              Provider Interface                  │
 * │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
 * │  │  Local   │  │ Socket.io│  │  Pusher  │      │
 * │  │  (dev)   │  │ (server) │  │  (prod)  │      │
 * │  └──────────┘  └──────────┘  └──────────┘      │
 * └─────────────────────────────────────────────────┘
 *
 * Usage:
 * ```typescript
 * import { useEvents } from '@/lib/events'
 *
 * function OrdersPage() {
 *   const { subscribe, emit } = useEvents({ locationId: 'loc_123' })
 *
 *   useEffect(() => {
 *     const unsub = subscribe('order:created', (data) => {
 *       console.log('New order:', data.orderId)
 *     })
 *     return unsub
 *   }, [subscribe])
 * }
 * ```
 */

import type { EventProvider, ProviderConfig } from './provider'
import { createLocalProvider } from './local-provider'
import { createSocketProvider } from './socket-provider'

// ==================== Provider Selection ====================

export type ProviderType = 'local' | 'socket' | 'pusher' | 'ably'

// Singleton provider instance
let providerInstance: EventProvider | null = null

/**
 * Get the event provider instance (singleton)
 *
 * By default, uses local provider for development.
 * Set NEXT_PUBLIC_EVENT_PROVIDER env var to change:
 * - 'local' (default) - In-memory, single-tab only
 * - 'socket' - Socket.io (requires server)
 * - 'pusher' - Pusher (serverless-compatible)
 * - 'ably' - Ably (serverless-compatible)
 */
export function getEventProvider(config?: Partial<ProviderConfig>): EventProvider {
  if (providerInstance) {
    return providerInstance
  }

  let providerType: ProviderType = 'local'
  if (typeof window !== 'undefined') {
    const envProvider = process.env.NEXT_PUBLIC_EVENT_PROVIDER as ProviderType | undefined
    providerType = envProvider || 'socket'
    if (!envProvider) {
      console.warn('[Events] NEXT_PUBLIC_EVENT_PROVIDER not set — defaulting to "socket". Set explicitly to silence this warning.')
    }
  }

  providerInstance = createProvider(providerType, config)
  return providerInstance
}

/**
 * Create a specific provider type
 */
export function createProvider(
  type: ProviderType,
  config?: Partial<ProviderConfig>
): EventProvider {
  switch (type) {
    case 'socket':
      return createSocketProvider(config)

    case 'pusher':
      // Pusher provider not yet implemented
      if (process.env.NODE_ENV !== 'production') console.warn('[Events] Pusher provider not implemented, falling back to local')
      return createLocalProvider(config)

    case 'ably':
      // Ably provider not yet implemented
      if (process.env.NODE_ENV !== 'production') console.warn('[Events] Ably provider not implemented, falling back to local')
      return createLocalProvider(config)

    case 'local':
    default:
      return createLocalProvider(config)
  }
}

/**
 * Reset the provider instance (useful for testing)
 */
export function resetProvider(): void {
  if (providerInstance) {
    providerInstance.disconnect().catch(() => {
      // Ignore disconnect errors
    })
    providerInstance = null
  }
}

/**
 * Set a custom provider instance (useful for testing)
 */
export function setProvider(provider: EventProvider): void {
  providerInstance = provider
}

// ==================== Re-exports ====================

// Types
export type {
  EventMap,
  EventName,
  EventCallback,
  UnsubscribeFn,
  ChannelType,
  Channel,
  ConnectionState,
  ConnectionStatus,
  // Event payloads
  OrderCreatedEvent,
  OrderUpdatedEvent,
  OrderItemAddedEvent,
  OrderItemUpdatedEvent,
  TableStatusChangedEvent,
  KDSTicketNewEvent,
  KDSTicketBumpedEvent,
  KDSItemBumpedEvent,
  SyncConflictEvent,
  SyncCompletedEvent,
  EmployeeClockEvent,
  PaymentProcessedEvent,
  TabUpdatedEvent,
  TableStatus,
  FloorPlanUpdatedEvent,
  EodResetCompleteEvent,
} from './types'

export { buildChannelName, parseChannelName } from './types'

// Provider types
export type { EventProvider, ProviderConfig, ProviderFactory } from './provider'
export { DEFAULT_PROVIDER_CONFIG } from './provider'

// Providers
export { createLocalProvider, LocalEventProvider } from './local-provider'
export { createSocketProvider, SocketEventProvider } from './socket-provider'

// React hooks
export { useEvents, useEventSubscription, useConnectionStatus } from './use-events'

// ==================== Server-side Helpers ====================

/**
 * Emit an event from server-side code (API routes)
 *
 * For local provider, this is a no-op (events don't cross server/client).
 * For Socket.io/Pusher/Ably, this pushes to all subscribed clients.
 *
 * @example
 * ```typescript
 * // In API route
 * import { emitServerEvent } from '@/lib/events'
 *
 * export async function POST(req: Request) {
 *   const order = await createOrder(data)
 *
 *   // Push to all clients subscribed to this location
 *   await emitServerEvent('order:created', {
 *     orderId: order.id,
 *     orderNumber: order.orderNumber,
 *     ...
 *   }, { type: 'location', id: locationId })
 *
 *   return Response.json({ data: order })
 * }
 * ```
 */
export async function emitServerEvent<T extends keyof import('./types').EventMap>(
  event: T,
  data: import('./types').EventMap[T],
  channel?: { type: import('./types').ChannelType; id: string }
): Promise<void> {
  // In the future, this will:
  // - For Socket.io: Use the server-side socket instance
  // - For Pusher: Call Pusher's REST API to trigger event
  // - For Ably: Call Ably's REST API to publish

  // DEFERRED: Implement server-side event emission — tracked in PM-TASK-BOARD.md
  // This requires storing a reference to the socket.io server instance
  // or Pusher/Ably server-side client
}
