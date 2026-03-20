// ---------------------------------------------------------------------------
// UberEats API Client — Marketplace + Uber Direct (DaaS)
//
// Marketplace: Receive orders from UberEats, accept/deny, status updates, menu sync
// Uber Direct:  Request Uber drivers for your own orders (delivery-as-a-service)
//
// Auth: OAuth 2.0 client_credentials. Tokens last 30 days.
// Rate limit: 100 token requests/hour — cache aggressively.
// All prices in CENTS.
// ---------------------------------------------------------------------------

import type { GwiLogger } from '@/lib/logger'
import { platformFetch, withRetry } from './base-client'
import type {
  IPlatformClient,
  UberEatsCredentials,
  DeliveryQuote,
  DeliveryTracking,
  DeliveryStatus,
  CreateDeliveryRequest,
  OrderConfirmation,
  OrderRejection,
  MenuSyncItem,
  MenuSyncModifierGroup,
  MenuSyncResult,
} from './types'

// ---------------------------------------------------------------------------
// Lazy logger — no module-scope side effects
// ---------------------------------------------------------------------------

let _log: GwiLogger | null = null
function log() {
  if (!_log) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _log = require('@/lib/logger').createChildLogger('ubereats-client')
  }
  return _log!
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_URL = 'https://auth.uber.com/oauth/v2/token'
const API_BASE = 'https://api.uber.com'
const TOKEN_SCOPE = 'eats.store eats.store.orders.read eats.store.orders.write eats.deliveries'

// Refresh 5 minutes before actual expiry to avoid clock-skew races
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1_000

// ---------------------------------------------------------------------------
// Deny reason codes
// ---------------------------------------------------------------------------

type UberDenyReasonCode =
  | 'STORE_CLOSED'
  | 'POS_OFFLINE'
  | 'ITEM_AVAILABILITY'
  | 'CAPACITY'
  | 'ADDRESS'
  | 'PRICING'
  | 'SPECIAL_INSTRUCTIONS'
  | 'OTHER'
  | 'POS_NOT_READY'
  | 'CANNOT_COMPLETE'
  | 'STORE_UNDER_REVIEW'

// ---------------------------------------------------------------------------
// Uber Direct status → unified DeliveryStatus mapping
// ---------------------------------------------------------------------------

const UBER_DIRECT_STATUS_MAP: Record<string, DeliveryStatus> = {
  pending:          'created',
  pickup:           'driver_en_route_pickup',
  pickup_complete:  'picked_up',
  dropoff:          'driver_en_route_dropoff',
  delivered:        'delivered',
  canceled:         'cancelled',
  returned:         'failed',
}

function mapUberDirectStatus(uberStatus: string): DeliveryStatus {
  return UBER_DIRECT_STATUS_MAP[uberStatus] ?? 'created'
}

// ---------------------------------------------------------------------------
// UberEats menu format converters
// ---------------------------------------------------------------------------

interface UberMenuModifierOption {
  id: string
  title: string
  price_info: { price: number; overrides: unknown[] }
  quantity_info: { quantity: { max_permitted: number; charge_above: number } }
  tax_info: { tax_rate: number }
  available: boolean
}

interface UberMenuModifierGroup {
  id: string
  title: string
  quantity_info: {
    quantity: {
      min_permitted: number
      max_permitted: number
    }
  }
  modifier_options: UberMenuModifierOption[]
}

interface UberMenuItem {
  id: string
  title: string
  description: string
  image_url?: string
  price_info: { price: number; overrides: unknown[] }
  quantity_info: { quantity: { max_permitted: number } }
  tax_info: { tax_rate: number }
  modifier_groups?: UberMenuModifierGroup[]
  available: boolean
}

interface UberMenuCategory {
  id: string
  title: string
  entities: Array<{ id: string; type: 'ITEM' }>
}

interface UberMenuSection {
  id: string
  title: string
  categories: UberMenuCategory[]
  items: UberMenuItem[]
  modifier_groups: UberMenuModifierGroup[]
}

interface UberMenuPayload {
  menus: UberMenuSection[]
}

function buildModifierGroup(group: MenuSyncModifierGroup): UberMenuModifierGroup {
  return {
    id: group.externalId,
    title: group.name,
    quantity_info: {
      quantity: {
        min_permitted: group.minSelections,
        max_permitted: group.maxSelections,
      },
    },
    modifier_options: group.options.map(opt => ({
      id: opt.externalId,
      title: opt.name,
      price_info: { price: opt.price, overrides: [] },
      quantity_info: { quantity: { max_permitted: 1, charge_above: 0 } },
      tax_info: { tax_rate: 0 },
      available: opt.available,
    })),
  }
}

function buildUberMenuPayload(items: MenuSyncItem[]): UberMenuPayload {
  // Group items by category
  const catMap = new Map<string, { categoryName: string; categoryExternalId: string; items: MenuSyncItem[] }>()
  for (const item of items) {
    const existing = catMap.get(item.categoryExternalId)
    if (existing) {
      existing.items.push(item)
    } else {
      catMap.set(item.categoryExternalId, {
        categoryName: item.categoryName,
        categoryExternalId: item.categoryExternalId,
        items: [item],
      })
    }
  }

  // Collect all modifier groups (deduplicated by externalId)
  const allModGroups = new Map<string, UberMenuModifierGroup>()
  const allMenuItems: UberMenuItem[] = []
  const categories: UberMenuCategory[] = []

  for (const [, cat] of Array.from(catMap)) {
    const entityRefs: Array<{ id: string; type: 'ITEM' }> = []

    for (const item of cat.items) {
      const modGroupIds: string[] = []
      if (item.modifierGroups) {
        for (const mg of item.modifierGroups) {
          if (!allModGroups.has(mg.externalId)) {
            allModGroups.set(mg.externalId, buildModifierGroup(mg))
          }
          modGroupIds.push(mg.externalId)
        }
      }

      const menuItem: UberMenuItem = {
        id: item.externalId,
        title: item.name,
        description: item.description || '',
        price_info: { price: item.price, overrides: [] },
        quantity_info: { quantity: { max_permitted: 99 } },
        tax_info: { tax_rate: 0 },
        available: item.available,
      }
      if (item.imageUrl) {
        menuItem.image_url = item.imageUrl
      }
      if (modGroupIds.length > 0) {
        menuItem.modifier_groups = modGroupIds
          .map(id => allModGroups.get(id))
          .filter((g): g is UberMenuModifierGroup => !!g)
      }

      allMenuItems.push(menuItem)
      entityRefs.push({ id: item.externalId, type: 'ITEM' })
    }

    categories.push({
      id: cat.categoryExternalId,
      title: cat.categoryName,
      entities: entityRefs,
    })
  }

  return {
    menus: [
      {
        id: 'main-menu',
        title: 'Main Menu',
        categories,
        items: allMenuItems,
        modifier_groups: Array.from(allModGroups.values()),
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// UberEatsClient
// ---------------------------------------------------------------------------

export class UberEatsClient implements IPlatformClient {
  readonly platform = 'ubereats' as const

  private credentials: UberEatsCredentials
  private storeId: string
  private onTokenRefresh?: (token: string, expiresAt: number) => void

  constructor(
    credentials: UberEatsCredentials,
    storeId: string,
    onTokenRefresh?: (token: string, expiresAt: number) => void,
  ) {
    this.credentials = { ...credentials }
    this.storeId = storeId
    this.onTokenRefresh = onTokenRefresh
  }

  // -------------------------------------------------------------------------
  // Token management
  // -------------------------------------------------------------------------

  private isTokenValid(): boolean {
    if (!this.credentials.accessToken || !this.credentials.accessTokenExpiresAt) {
      return false
    }
    return Date.now() < this.credentials.accessTokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
  }

  private async refreshToken(): Promise<string> {
    log().info('Refreshing UberEats OAuth token')

    const params = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      grant_type: 'client_credentials',
      scope: TOKEN_SCOPE,
    })

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    if (!response.ok) {
      const body = await response.text()
      log().error(
        { status: response.status, body: body.slice(0, 500) },
        'UberEats token refresh failed',
      )
      throw new Error(`UberEats token refresh failed: ${response.status} - ${body.slice(0, 200)}`)
    }

    const data = (await response.json()) as { access_token: string; expires_in: number }
    const expiresAt = Date.now() + data.expires_in * 1_000

    // Update in-memory cache
    this.credentials.accessToken = data.access_token
    this.credentials.accessTokenExpiresAt = expiresAt

    // Notify caller so they can persist to settings
    if (this.onTokenRefresh) {
      this.onTokenRefresh(data.access_token, expiresAt)
    }

    log().info({ expiresIn: data.expires_in }, 'UberEats token refreshed')
    return data.access_token
  }

  private async getToken(): Promise<string> {
    if (this.isTokenValid()) {
      return this.credentials.accessToken!
    }
    return this.refreshToken()
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken()
    return { Authorization: `Bearer ${token}` }
  }

  // -------------------------------------------------------------------------
  // Internal fetch helpers
  // -------------------------------------------------------------------------

  private async apiGet(path: string): Promise<unknown> {
    const headers = await this.authHeaders()
    const { data } = await platformFetch('ubereats', {
      method: 'GET',
      url: `${API_BASE}${path}`,
      headers,
    })
    return data
  }

  private async apiPost(path: string, body?: unknown): Promise<unknown> {
    const headers = await this.authHeaders()
    const { data } = await platformFetch('ubereats', {
      method: 'POST',
      url: `${API_BASE}${path}`,
      headers,
      body,
    })
    return data
  }

  private async apiPut(path: string, body?: unknown): Promise<unknown> {
    const headers = await this.authHeaders()
    const { data } = await platformFetch('ubereats', {
      method: 'PUT',
      url: `${API_BASE}${path}`,
      headers,
      body,
    })
    return data
  }

  // -------------------------------------------------------------------------
  // Marketplace — Order management
  // -------------------------------------------------------------------------

  async confirmOrder(
    externalOrderId: string,
    prepTimeMinutes?: number,
  ): Promise<OrderConfirmation> {
    return withRetry(
      async () => {
        const pickupTime = prepTimeMinutes
          ? Math.floor(Date.now() / 1_000) + prepTimeMinutes * 60
          : Math.floor(Date.now() / 1_000) + 20 * 60 // default 20 min

        await this.apiPost(`/v1/eats/orders/${externalOrderId}/accept_pos_order`, {
          reason: { explanation: 'Order accepted by POS' },
          pickup_time: pickupTime,
        })

        log().info({ orderId: externalOrderId, prepTimeMinutes }, 'UberEats order accepted')
        return {
          platform: 'ubereats' as const,
          externalOrderId,
          confirmed: true,
          estimatedPickupAt: new Date(pickupTime * 1_000).toISOString(),
        }
      },
      { platform: 'ubereats', operation: `confirmOrder(${externalOrderId})` },
    )
  }

  async rejectOrder(
    externalOrderId: string,
    reason: string,
  ): Promise<OrderRejection> {
    return withRetry(
      async () => {
        // Map free-text reason to closest deny code, default to OTHER
        const code = mapReasonToDenyCode(reason)

        await this.apiPost(`/v1/eats/orders/${externalOrderId}/deny_pos_order`, {
          reason: { code, explanation: reason },
        })

        log().info({ orderId: externalOrderId, code, reason }, 'UberEats order denied')
        return {
          platform: 'ubereats' as const,
          externalOrderId,
          rejected: true,
        }
      },
      { platform: 'ubereats', operation: `rejectOrder(${externalOrderId})` },
    )
  }

  async markReady(
    externalOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return withRetry(
      async () => {
        // Restaurant delivery: mark as started (food is ready for pickup)
        await this.apiPost(`/v1/eats/orders/${externalOrderId}/restaurantdelivery/status`, {
          status: 'started',
        })

        log().info({ orderId: externalOrderId }, 'UberEats order marked ready (started)')
        return { success: true }
      },
      { platform: 'ubereats', operation: `markReady(${externalOrderId})` },
    )
  }

  async cancelOrder(
    externalOrderId: string,
    reason: string,
  ): Promise<{ success: boolean; error?: string }> {
    return withRetry(
      async () => {
        // Use deny endpoint with CANNOT_COMPLETE for post-accept cancellation
        await this.apiPost(`/v1/eats/orders/${externalOrderId}/deny_pos_order`, {
          reason: { code: 'CANNOT_COMPLETE' as UberDenyReasonCode, explanation: reason },
        })

        log().info({ orderId: externalOrderId, reason }, 'UberEats order cancelled')
        return { success: true }
      },
      { platform: 'ubereats', operation: `cancelOrder(${externalOrderId})` },
    )
  }

  // -------------------------------------------------------------------------
  // Marketplace — Get order details
  // -------------------------------------------------------------------------

  async getOrder(externalOrderId: string): Promise<Record<string, unknown>> {
    return withRetry(
      async () => {
        const data = await this.apiGet(`/v2/eats/order/${externalOrderId}`)
        return data as Record<string, unknown>
      },
      { platform: 'ubereats', operation: `getOrder(${externalOrderId})` },
    )
  }

  // -------------------------------------------------------------------------
  // Marketplace — Restaurant delivery status updates
  // -------------------------------------------------------------------------

  async updateRestaurantDeliveryStatus(
    externalOrderId: string,
    status: 'started' | 'arriving' | 'delivered',
  ): Promise<{ success: boolean; error?: string }> {
    return withRetry(
      async () => {
        await this.apiPost(`/v1/eats/orders/${externalOrderId}/restaurantdelivery/status`, {
          status,
        })

        log().info({ orderId: externalOrderId, status }, 'UberEats restaurant delivery status updated')
        return { success: true }
      },
      { platform: 'ubereats', operation: `updateRestaurantDeliveryStatus(${externalOrderId})` },
    )
  }

  // -------------------------------------------------------------------------
  // Marketplace — Menu sync
  // -------------------------------------------------------------------------

  async syncMenu(items: MenuSyncItem[]): Promise<MenuSyncResult> {
    return withRetry(
      async () => {
        const payload = buildUberMenuPayload(items)

        await this.apiPut(`/v2/eats/stores/${this.storeId}/menus`, payload)

        log().info(
          { storeId: this.storeId, itemCount: items.length },
          'UberEats menu synced',
        )
        return {
          platform: 'ubereats' as const,
          success: true,
          itemsSynced: items.length,
          errors: [],
        }
      },
      { platform: 'ubereats', operation: 'syncMenu' },
    )
  }

  async updateItemAvailability(
    externalItemId: string,
    available: boolean,
  ): Promise<{ success: boolean }> {
    return withRetry(
      async () => {
        const body = available
          ? { suspension_info: { suspend_until: 0, reason: '' } }
          : { suspension_info: { suspend_until: 0, reason: 'OUT_OF_STOCK' } }

        await this.apiPost(
          `/v2/eats/stores/${this.storeId}/menus/items/${externalItemId}`,
          body,
        )

        log().info(
          { storeId: this.storeId, itemId: externalItemId, available },
          'UberEats item availability updated',
        )
        return { success: true }
      },
      { platform: 'ubereats', operation: `updateItemAvailability(${externalItemId})` },
    )
  }

  // -------------------------------------------------------------------------
  // Uber Direct — Delivery as a Service (DaaS)
  // -------------------------------------------------------------------------

  private get directCustomerId(): string {
    if (!this.credentials.directCustomerId) {
      throw new Error('Uber Direct customer ID not configured — enable directEnabled and set directCustomerId')
    }
    return this.credentials.directCustomerId
  }

  async getDeliveryQuote(request: CreateDeliveryRequest): Promise<DeliveryQuote> {
    if (!this.credentials.directEnabled) {
      throw new Error('Uber Direct is not enabled for this location')
    }

    return withRetry(
      async () => {
        const customerId = this.directCustomerId
        const body = {
          pickup_address: request.pickupAddress,
          pickup_name: request.pickupBusinessName,
          pickup_phone_number: request.pickupPhoneNumber,
          dropoff_address: request.dropoffAddress,
          dropoff_name: request.dropoffContactFirstName + (request.dropoffContactLastName ? ` ${request.dropoffContactLastName}` : ''),
          dropoff_phone_number: request.dropoffPhoneNumber,
          manifest_items: (request.items || []).map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
          })),
        }

        const data = (await this.apiPost(
          `/v1/customers/${customerId}/delivery_quotes`,
          body,
        )) as {
          id: string
          fee: number
          currency: string
          estimated_pickup_time_minutes?: number
          estimated_delivery_time_minutes?: number
          expires_at?: string
        }

        log().info(
          { quoteId: data.id, fee: data.fee },
          'Uber Direct quote received',
        )

        return {
          platform: 'ubereats' as const,
          quoteId: data.id,
          feeAmountCents: data.fee,
          currency: data.currency || 'USD',
          estimatedPickupMinutes: data.estimated_pickup_time_minutes ?? 15,
          estimatedDeliveryMinutes: data.estimated_delivery_time_minutes ?? 30,
          expiresAt: data.expires_at || new Date(Date.now() + 30 * 60_000).toISOString(),
          rawResponse: data as unknown as Record<string, unknown>,
        }
      },
      { platform: 'ubereats', operation: 'getDeliveryQuote' },
    )
  }

  async createDelivery(
    quoteId: string,
  ): Promise<{ externalDeliveryId: string; trackingUrl?: string }> {
    if (!this.credentials.directEnabled) {
      throw new Error('Uber Direct is not enabled for this location')
    }

    return withRetry(
      async () => {
        const customerId = this.directCustomerId

        const data = (await this.apiPost(
          `/v1/customers/${customerId}/deliveries`,
          { quote_id: quoteId },
        )) as {
          id: string
          tracking_url?: string
        }

        log().info(
          { deliveryId: data.id, quoteId },
          'Uber Direct delivery created',
        )

        return {
          externalDeliveryId: data.id,
          trackingUrl: data.tracking_url,
        }
      },
      { platform: 'ubereats', operation: `createDelivery(quote=${quoteId})` },
    )
  }

  async getDeliveryStatus(
    externalDeliveryId: string,
  ): Promise<DeliveryTracking> {
    if (!this.credentials.directEnabled) {
      throw new Error('Uber Direct is not enabled for this location')
    }

    return withRetry(
      async () => {
        const customerId = this.directCustomerId

        const data = (await this.apiGet(
          `/v1/customers/${customerId}/deliveries/${externalDeliveryId}`,
        )) as {
          id: string
          status: string
          courier?: {
            name?: string
            phone_number?: string
            location?: { lat?: number; lng?: number }
          }
          pickup_eta?: string
          dropoff_eta?: string
          tracking_url?: string
          dropoff?: {
            verification?: {
              picture?: { url?: string }
              signature?: { url?: string }
              pin_code?: { code?: string }
            }
          }
        }

        log().info(
          { deliveryId: externalDeliveryId, status: data.status },
          'Uber Direct delivery status fetched',
        )

        return {
          platform: 'ubereats' as const,
          externalDeliveryId: data.id,
          status: mapUberDirectStatus(data.status),
          driverName: data.courier?.name,
          driverPhone: data.courier?.phone_number,
          driverLatitude: data.courier?.location?.lat,
          driverLongitude: data.courier?.location?.lng,
          estimatedPickupAt: data.pickup_eta,
          estimatedDeliveryAt: data.dropoff_eta,
          trackingUrl: data.tracking_url,
          proofOfDelivery: data.dropoff?.verification
            ? {
                photoUrl: data.dropoff.verification.picture?.url,
                signatureUrl: data.dropoff.verification.signature?.url,
                verificationCode: data.dropoff.verification.pin_code?.code,
              }
            : undefined,
        }
      },
      { platform: 'ubereats', operation: `getDeliveryStatus(${externalDeliveryId})` },
    )
  }

  async cancelDelivery(
    externalDeliveryId: string,
    reason: string,
  ): Promise<{ success: boolean }> {
    if (!this.credentials.directEnabled) {
      throw new Error('Uber Direct is not enabled for this location')
    }

    return withRetry(
      async () => {
        const customerId = this.directCustomerId

        await this.apiPost(
          `/v1/customers/${customerId}/deliveries/${externalDeliveryId}/cancel`,
          { reason },
        )

        log().info(
          { deliveryId: externalDeliveryId, reason },
          'Uber Direct delivery cancelled',
        )

        return { success: true }
      },
      { platform: 'ubereats', operation: `cancelDelivery(${externalDeliveryId})` },
    )
  }
}

// ---------------------------------------------------------------------------
// Helper: map free-text reason to UberEats deny reason code
// ---------------------------------------------------------------------------

function mapReasonToDenyCode(reason: string): UberDenyReasonCode {
  const r = reason.toLowerCase()
  if (r.includes('closed') || r.includes('close'))       return 'STORE_CLOSED'
  if (r.includes('offline') || r.includes('pos'))         return 'POS_OFFLINE'
  if (r.includes('item') || r.includes('out of stock') || r.includes('86') || r.includes('unavailable'))
                                                           return 'ITEM_AVAILABILITY'
  if (r.includes('busy') || r.includes('capacity'))       return 'CAPACITY'
  if (r.includes('address'))                               return 'ADDRESS'
  if (r.includes('price') || r.includes('pricing'))        return 'PRICING'
  if (r.includes('instruction'))                           return 'SPECIAL_INSTRUCTIONS'
  if (r.includes('review'))                                return 'STORE_UNDER_REVIEW'
  if (r.includes('not ready'))                             return 'POS_NOT_READY'
  if (r.includes('cannot') || r.includes('can\'t'))        return 'CANNOT_COMPLETE'
  return 'OTHER'
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUberEatsClient(
  credentials: UberEatsCredentials,
  storeId: string,
  onTokenRefresh?: (token: string, expiresAt: number) => void,
): UberEatsClient {
  return new UberEatsClient(credentials, storeId, onTokenRefresh)
}
