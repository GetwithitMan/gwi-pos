// ---------------------------------------------------------------------------
// Shared types for third-party delivery platform integrations
// ---------------------------------------------------------------------------

// Platform identifier
export type DeliveryPlatformId = 'doordash' | 'ubereats' | 'grubhub' | 'deliverect'

// ---------------------------------------------------------------------------
// Per-platform credentials (stored in LocationSettings.thirdPartyDelivery)
// ---------------------------------------------------------------------------

export interface DoorDashCredentials {
  developerId: string
  keyId: string
  signingSecret: string
  // Drive-specific
  driveEnabled: boolean
}

export interface UberEatsCredentials {
  clientId: string
  clientSecret: string
  // Token cache (persisted to settings)
  accessToken?: string
  accessTokenExpiresAt?: number // epoch ms
  // Uber Direct
  directEnabled: boolean
  directCustomerId?: string // Uber Direct customer ID
}

export interface GrubhubCredentials {
  clientId: string      // sv:v1:...
  secretKey: string     // base64 shared secret
  issueDate: string     // timestamp from Grubhub
  partnerKey: string
  // Connect (DaaS)
  connectEnabled: boolean
}

export interface DeliverectCredentials {
  channelLinkId: string
  apiKey: string
}

// ---------------------------------------------------------------------------
// Unified delivery quote (DoorDash Drive / Uber Direct / Grubhub Connect)
// ---------------------------------------------------------------------------

export interface DeliveryQuote {
  platform: DeliveryPlatformId
  quoteId: string
  feeAmountCents: number
  currency: string
  estimatedPickupMinutes: number
  estimatedDeliveryMinutes: number
  expiresAt: string // ISO date
  rawResponse: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Unified delivery status & tracking
// ---------------------------------------------------------------------------

export type DeliveryStatus =
  | 'created'
  | 'confirmed'
  | 'driver_assigned'
  | 'driver_en_route_pickup'
  | 'driver_arrived_pickup'
  | 'picked_up'
  | 'driver_en_route_dropoff'
  | 'driver_arrived_dropoff'
  | 'delivered'
  | 'cancelled'
  | 'failed'

export interface DeliveryTracking {
  platform: DeliveryPlatformId
  externalDeliveryId: string
  status: DeliveryStatus
  driverName?: string
  driverPhone?: string
  driverLatitude?: number
  driverLongitude?: number
  estimatedPickupAt?: string
  estimatedDeliveryAt?: string
  trackingUrl?: string
  proofOfDelivery?: {
    photoUrl?: string
    signatureUrl?: string
    verificationCode?: string
  }
}

// ---------------------------------------------------------------------------
// Create delivery request (for DaaS: Drive / Direct / Connect)
// ---------------------------------------------------------------------------

export interface CreateDeliveryRequest {
  // Pickup
  pickupAddress: string
  pickupBusinessName: string
  pickupPhoneNumber: string
  pickupInstructions?: string
  pickupTime?: string // ISO date -- when food will be ready

  // Dropoff
  dropoffAddress: string
  dropoffBusinessName?: string
  dropoffPhoneNumber: string
  dropoffInstructions?: string
  dropoffContactFirstName: string
  dropoffContactLastName?: string

  // Order details
  orderValue: number // cents
  tip?: number // cents
  externalOrderId: string // POS order ID
  items?: Array<{
    name: string
    quantity: number
    price: number // cents
  }>
}

// ---------------------------------------------------------------------------
// Order confirmation / rejection
// ---------------------------------------------------------------------------

export interface OrderConfirmation {
  platform: DeliveryPlatformId
  externalOrderId: string
  confirmed: boolean
  estimatedPickupAt?: string
  error?: string
}

export interface OrderRejection {
  platform: DeliveryPlatformId
  externalOrderId: string
  rejected: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Menu sync
// ---------------------------------------------------------------------------

export interface MenuSyncItem {
  externalId: string // POS menu item ID
  name: string
  description?: string
  price: number // cents
  categoryName: string
  categoryExternalId: string
  imageUrl?: string
  available: boolean
  modifierGroups?: MenuSyncModifierGroup[]
}

export interface MenuSyncModifierGroup {
  externalId: string
  name: string
  minSelections: number
  maxSelections: number
  options: MenuSyncModifierOption[]
}

export interface MenuSyncModifierOption {
  externalId: string
  name: string
  price: number // cents
  available: boolean
}

export interface MenuSyncResult {
  platform: DeliveryPlatformId
  success: boolean
  itemsSynced: number
  errors: string[]
  jobId?: string // async job ID if platform processes async
}

// ---------------------------------------------------------------------------
// Platform client interface -- all clients implement this
// ---------------------------------------------------------------------------

export interface IPlatformClient {
  readonly platform: DeliveryPlatformId

  // Order management
  confirmOrder(externalOrderId: string, prepTimeMinutes?: number): Promise<OrderConfirmation>
  rejectOrder(externalOrderId: string, reason: string): Promise<OrderRejection>
  markReady(externalOrderId: string): Promise<{ success: boolean; error?: string }>
  cancelOrder(externalOrderId: string, reason: string): Promise<{ success: boolean; error?: string }>

  // Menu sync
  syncMenu(items: MenuSyncItem[]): Promise<MenuSyncResult>
  updateItemAvailability(externalItemId: string, available: boolean): Promise<{ success: boolean }>

  // Delivery as a Service (DaaS) -- optional, only Drive / Direct / Connect
  getDeliveryQuote?(request: CreateDeliveryRequest): Promise<DeliveryQuote>
  createDelivery?(quoteId: string): Promise<{ externalDeliveryId: string; trackingUrl?: string }>
  cancelDelivery?(externalDeliveryId: string, reason: string): Promise<{ success: boolean }>
  getDeliveryStatus?(externalDeliveryId: string): Promise<DeliveryTracking>
}
