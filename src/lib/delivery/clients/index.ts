// ---------------------------------------------------------------------------
// Delivery Platform Clients — Barrel Export
// NO export * — explicit re-exports only
// ---------------------------------------------------------------------------

// Platform client types
export type {
  DeliveryPlatformId,
  DoorDashCredentials,
  UberEatsCredentials,
  GrubhubCredentials,
  DeliverectCredentials,
  DeliveryQuote,
  DeliveryStatus,
  DeliveryTracking,
  CreateDeliveryRequest,
  OrderConfirmation,
  OrderRejection,
  MenuSyncItem,
  MenuSyncModifierGroup,
  MenuSyncModifierOption,
  MenuSyncResult,
  IPlatformClient,
} from './types'

// Platform clients
export { DoorDashClient, createDoorDashClient } from './doordash'
export { UberEatsClient, createUberEatsClient } from './ubereats'
export { GrubhubClient, createGrubhubClient } from './grubhub'

// Registry
export { getPlatformClient, getActivePlatformClients } from './platform-registry'

// Base
export { PlatformApiError, platformFetch, withRetry } from './base-client'
