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

const TOKEN_URL_PRODUCTION = 'https://auth.uber.com/oauth/v2/token'
const TOKEN_URL_SANDBOX = 'https://sandbox-login.uber.com/oauth/v2/token'
const API_BASE_PRODUCTION = 'https://api.uber.com'
const API_BASE_SANDBOX = 'https://test-api.uber.com'
const TOKEN_SCOPE = 'eats.store eats.order eats.store.orders.restaurantdelivery.status eats.deliveries'

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
  | 'MISSING_ITEM'
  | 'MISSING_INFO'

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

interface UberMenuItemPayload {
  id: string
  title: { translations: { en: string } }
  description: { translations: { en: string } }
  image_url?: string
  price_info: { price: number; overrides: unknown[] }
  quantity_info: { quantity: { max_permitted: number } }
  tax_info: { tax_rate: number }
  external_data?: string
}

interface UberMenuModifierOptionRef {
  id: string
  type: 'ITEM'
  price_info: { price: number; overrides: unknown[] }
}

interface UberMenuModifierGroupPayload {
  id: string
  title: { translations: { en: string } }
  quantity_info: {
    quantity: {
      min_permitted: number
      max_permitted: number
    }
  }
  modifier_options: UberMenuModifierOptionRef[]
}

interface UberMenuCategoryPayload {
  id: string
  title: { translations: { en: string } }
  entities: Array<{ id: string; type: 'ITEM' }>
}

interface UberMenuEntryPayload {
  id: string
  title: { translations: { en: string } }
  service_availability: Array<{
    day_of_week: string
    time_periods: Array<{ start_time: string; end_time: string }>
  }>
  category_ids: string[]
}

interface UberMenuPayload {
  items: UberMenuItemPayload[]
  categories: UberMenuCategoryPayload[]
  menus: UberMenuEntryPayload[]
  modifier_groups: UberMenuModifierGroupPayload[]
}

const ALL_DAYS_AVAILABILITY = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
].map(day => ({
  day_of_week: day,
  time_periods: [{ start_time: '00:00', end_time: '23:59' }],
}))

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

  // Flat top-level arrays (Uber Eats requires this structure)
  const allModGroups = new Map<string, UberMenuModifierGroupPayload>()
  const allItems: UberMenuItemPayload[] = []
  const categories: UberMenuCategoryPayload[] = []
  // Track modifier option items that need to be in the top-level items array
  const modifierItemIds = new Set<string>()

  for (const [, cat] of Array.from(catMap)) {
    const entityRefs: Array<{ id: string; type: 'ITEM' }> = []

    for (const item of cat.items) {
      if (item.modifierGroups) {
        for (const mg of item.modifierGroups) {
          if (!allModGroups.has(mg.externalId)) {
            const modOptionRefs: UberMenuModifierOptionRef[] = []
            for (const opt of mg.options) {
              modOptionRefs.push({
                id: opt.externalId,
                type: 'ITEM',
                price_info: { price: opt.price, overrides: [] },
              })
              // Add modifier option as a top-level item if not already present
              if (!modifierItemIds.has(opt.externalId)) {
                modifierItemIds.add(opt.externalId)
                allItems.push({
                  id: opt.externalId,
                  title: { translations: { en: opt.name } },
                  description: { translations: { en: '' } },
                  price_info: { price: opt.price, overrides: [] },
                  quantity_info: { quantity: { max_permitted: 99 } },
                  tax_info: { tax_rate: 0 },
                  external_data: opt.externalId,
                })
              }
            }
            allModGroups.set(mg.externalId, {
              id: mg.externalId,
              title: { translations: { en: mg.name } },
              quantity_info: {
                quantity: {
                  min_permitted: mg.minSelections,
                  max_permitted: mg.maxSelections,
                },
              },
              modifier_options: modOptionRefs,
            })
          }
        }
      }

      const menuItem: UberMenuItemPayload = {
        id: item.externalId,
        title: { translations: { en: item.name } },
        description: { translations: { en: item.description || '' } },
        price_info: { price: item.price, overrides: [] },
        quantity_info: { quantity: { max_permitted: 99 } },
        tax_info: { tax_rate: 0 },
        external_data: item.externalId,
      }
      if (item.imageUrl) {
        menuItem.image_url = item.imageUrl
      }

      allItems.push(menuItem)
      entityRefs.push({ id: item.externalId, type: 'ITEM' })
    }

    categories.push({
      id: cat.categoryExternalId,
      title: { translations: { en: cat.categoryName } },
      entities: entityRefs,
    })
  }

  return {
    items: allItems,
    categories,
    menus: [
      {
        id: 'main-menu',
        title: { translations: { en: 'Full Menu' } },
        service_availability: ALL_DAYS_AVAILABILITY,
        category_ids: categories.map(c => c.id),
      },
    ],
    modifier_groups: Array.from(allModGroups.values()),
  }
}

// ---------------------------------------------------------------------------
// UberEatsClient
// ---------------------------------------------------------------------------

export class UberEatsClient implements IPlatformClient {
  readonly platform = 'ubereats' as const

  private credentials: UberEatsCredentials
  private storeId: string
  private sandbox: boolean
  private onTokenRefresh?: (token: string, expiresAt: number) => void

  private get tokenUrl(): string {
    return this.sandbox ? TOKEN_URL_SANDBOX : TOKEN_URL_PRODUCTION
  }

  private get apiBase(): string {
    return this.sandbox ? API_BASE_SANDBOX : API_BASE_PRODUCTION
  }

  constructor(
    credentials: UberEatsCredentials,
    storeId: string,
    onTokenRefresh?: (token: string, expiresAt: number) => void,
    sandbox = false,
  ) {
    this.credentials = { ...credentials }
    this.storeId = storeId
    this.onTokenRefresh = onTokenRefresh
    this.sandbox = sandbox
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

    const response = await fetch(this.tokenUrl, {
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
      url: `${this.apiBase}${path}`,
      headers,
    })
    return data
  }

  private async apiPost(path: string, body?: unknown): Promise<unknown> {
    const headers = await this.authHeaders()
    const { data } = await platformFetch('ubereats', {
      method: 'POST',
      url: `${this.apiBase}${path}`,
      headers,
      body,
    })
    return data
  }

  private async apiPut(path: string, body?: unknown): Promise<unknown> {
    const headers = await this.authHeaders()
    const { data } = await platformFetch('ubereats', {
      method: 'PUT',
      url: `${this.apiBase}${path}`,
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
    posOrderId?: string,
  ): Promise<OrderConfirmation> {
    return withRetry(
      async () => {
        const pickupTime = prepTimeMinutes
          ? Math.floor(Date.now() / 1_000) + prepTimeMinutes * 60
          : Math.floor(Date.now() / 1_000) + 20 * 60 // default 20 min

        const body: Record<string, unknown> = {
          reason: 'Order accepted by POS',
          pickup_time: pickupTime,
        }
        if (posOrderId) {
          body.external_reference_id = posOrderId
        }

        await this.apiPost(`/v1/eats/orders/${externalOrderId}/accept_pos_order`, body)

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
        // Use the cancel endpoint for post-accept cancellation
        await this.apiPost(`/v1/eats/orders/${externalOrderId}/cancel`, {
          reason: { code: 'OTHER', explanation: reason },
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
          ? { suspension_info: { suspension: { suspend_until: 0 } } }
          : { suspension_info: { suspension: { suspend_until: 8640000000, reason: 'OUT_OF_STOCK' } } }

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
          pickup_duration?: number
          duration?: number
          expires?: string
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
          estimatedPickupMinutes: data.pickup_duration ?? 15,
          estimatedDeliveryMinutes: data.duration ?? 30,
          expiresAt: data.expires || new Date(Date.now() + 30 * 60_000).toISOString(),
          rawResponse: data as unknown as Record<string, unknown>,
        }
      },
      { platform: 'ubereats', operation: 'getDeliveryQuote' },
    )
  }

  async createDelivery(
    quoteId: string,
    request?: CreateDeliveryRequest,
  ): Promise<{ externalDeliveryId: string; trackingUrl?: string }> {
    if (!this.credentials.directEnabled) {
      throw new Error('Uber Direct is not enabled for this location')
    }

    return withRetry(
      async () => {
        const customerId = this.directCustomerId

        const body: Record<string, unknown> = { quote_id: quoteId }

        if (request) {
          body.pickup = {
            address: request.pickupAddress,
            name: request.pickupBusinessName,
            phone_number: request.pickupPhoneNumber,
          }
          body.dropoff = {
            address: request.dropoffAddress,
            name: request.dropoffContactFirstName + (request.dropoffContactLastName ? ` ${request.dropoffContactLastName}` : ''),
            phone_number: request.dropoffPhoneNumber,
            notes: request.dropoffInstructions || '',
          }
          body.manifest_items = (request.items || []).map(item => ({
            name: item.name,
            quantity: item.quantity,
          }))
        }

        const data = (await this.apiPost(
          `/v1/customers/${customerId}/deliveries`,
          body,
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
  if (r.includes('not ready'))                             return 'POS_NOT_READY'
  if (r.includes('missing item'))                          return 'MISSING_ITEM'
  if (r.includes('missing info') || r.includes('missing information'))
                                                           return 'MISSING_INFO'
  return 'OTHER'
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUberEatsClient(
  credentials: UberEatsCredentials,
  storeId: string,
  onTokenRefresh?: (token: string, expiresAt: number) => void,
  sandbox = false,
): UberEatsClient {
  return new UberEatsClient(credentials, storeId, onTokenRefresh, sandbox)
}
