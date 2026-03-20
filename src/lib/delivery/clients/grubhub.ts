// ---------------------------------------------------------------------------
// Grubhub Platform Client
//
// Covers TWO products:
//   1. Grubhub Marketplace — receive & manage orders, push menus
//   2. Grubhub Connect (DaaS) — request Grubhub drivers for in-house orders
//
// Authentication: HMAC-SHA256 MAC header + X-GH-PARTNER-KEY
// All prices in cents.
// ---------------------------------------------------------------------------

import { createHmac, createHash, randomBytes } from 'crypto'
import { platformFetch, withRetry, PlatformApiError } from './base-client'
import type {
  IPlatformClient,
  GrubhubCredentials,
  CreateDeliveryRequest,
  DeliveryQuote,
  DeliveryTracking,
  DeliveryStatus,
  MenuSyncItem,
  MenuSyncResult,
  OrderConfirmation,
  OrderRejection,
} from './types'

import type { GwiLogger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Lazy logger — no module-scope side effects
// ---------------------------------------------------------------------------

let _log: GwiLogger | null = null
function log() {
  if (!_log) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _log = require('@/lib/logger').createChildLogger('grubhub-client')
  }
  return _log!
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARKETPLACE_BASE = 'https://api-third-party-gtm.grubhub.com'
const PLATFORM = 'grubhub'

// ---------------------------------------------------------------------------
// MAC Auth Header Builder
// ---------------------------------------------------------------------------

interface MacComponents {
  clientId: string
  secretKey: string // base64-encoded shared secret
  method: string
  url: string
  body: string
}

/**
 * Build the MAC Authorization header per Grubhub spec.
 *
 * Format: MAC id="<clientId>",nonce="<ts:random>",bodyhash="<base64(SHA256(body))>",mac="<base64(HMAC-SHA256(normalized,key))>"
 *
 * Normalized string:
 *   nonce\n
 *   METHOD\n
 *   path\n
 *   host\n
 *   port\n
 *   bodyhash\n
 */
function buildMacHeader(opts: MacComponents): string {
  const { clientId, secretKey, method, url, body } = opts

  // Parse URL components
  const parsed = new URL(url)
  const host = parsed.hostname
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  const path = parsed.pathname + parsed.search

  // Nonce: timestamp:random
  const timestamp = Math.floor(Date.now() / 1000)
  const random = randomBytes(8).toString('hex')
  const nonce = `${timestamp}:${random}`

  // Body hash: base64(SHA-256(body))
  const bodyhash = createHash('sha256').update(body || '').digest('base64')

  // Normalized string
  const normalized = `${nonce}\n${method.toUpperCase()}\n${path}\n${host}\n${port}\n${bodyhash}\n`

  // MAC: base64(HMAC-SHA256(normalized, base64decode(secretKey)))
  const keyBuffer = Buffer.from(secretKey, 'base64')
  const mac = createHmac('sha256', keyBuffer).update(normalized).digest('base64')

  return `MAC id="${clientId}",nonce="${nonce}",bodyhash="${bodyhash}",mac="${mac}"`
}

// ---------------------------------------------------------------------------
// Grubhub rejection reason codes
// ---------------------------------------------------------------------------

type GrubhubRejectReason = 'CAPACITY' | 'HOURS' | 'MENU' | 'OTHER'

/**
 * Map a free-text rejection reason to a Grubhub reason code.
 */
function mapRejectReason(reason: string): GrubhubRejectReason {
  const lower = reason.toLowerCase()
  if (lower.includes('capacity') || lower.includes('busy') || lower.includes('volume')) return 'CAPACITY'
  if (lower.includes('hours') || lower.includes('closed')) return 'HOURS'
  if (lower.includes('menu') || lower.includes('item') || lower.includes('unavailable')) return 'MENU'
  return 'OTHER'
}

// ---------------------------------------------------------------------------
// Grubhub Connect status → unified DeliveryStatus mapping
// ---------------------------------------------------------------------------

function mapConnectStatus(ghStatus: string): DeliveryStatus {
  switch (ghStatus) {
    case 'CREATED':
    case 'PENDING':
      return 'created'
    case 'CONFIRMED':
    case 'ACCEPTED':
      return 'confirmed'
    case 'DRIVER_ASSIGNED':
      return 'driver_assigned'
    case 'EN_ROUTE_TO_PICKUP':
      return 'driver_en_route_pickup'
    case 'ARRIVED_AT_PICKUP':
      return 'driver_arrived_pickup'
    case 'PICKED_UP':
      return 'picked_up'
    case 'EN_ROUTE_TO_DROPOFF':
      return 'driver_en_route_dropoff'
    case 'ARRIVED_AT_DROPOFF':
      return 'driver_arrived_dropoff'
    case 'DELIVERED':
      return 'delivered'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return 'created'
  }
}

// ---------------------------------------------------------------------------
// GrubhubClient
// ---------------------------------------------------------------------------

export class GrubhubClient implements IPlatformClient {
  readonly platform: 'grubhub' = PLATFORM

  private readonly credentials: GrubhubCredentials
  private readonly merchantId: string

  constructor(credentials: GrubhubCredentials, merchantId: string) {
    this.credentials = credentials
    this.merchantId = merchantId
  }

  // ─── Private: Authenticated request ──────────────────────────────────────

  private authHeaders(method: string, url: string, body: string): Record<string, string> {
    return {
      'Authorization': buildMacHeader({
        clientId: this.credentials.clientId,
        secretKey: this.credentials.secretKey,
        method,
        url,
        body,
      }),
      'X-GH-PARTNER-KEY': this.credentials.partnerKey,
    }
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const url = `${MARKETPLACE_BASE}${path}`
    const bodyStr = body ? JSON.stringify(body) : ''

    return platformFetch(PLATFORM, {
      method,
      url,
      headers: this.authHeaders(method, url, bodyStr),
      body,
    })
  }

  // ─── Order Management (Marketplace) ──────────────────────────────────────

  async confirmOrder(
    externalOrderId: string,
    prepTimeMinutes = 20,
  ): Promise<OrderConfirmation> {
    return withRetry(
      async () => {
        await this.request(
          'PUT',
          `/pos/v1/merchant/${this.merchantId}/orders/${externalOrderId}/status`,
          { status: 'CONFIRMED', wait_time_in_minutes: prepTimeMinutes },
        )

        log().info(
          { orderId: externalOrderId, prepTimeMinutes },
          `[grubhub] Order confirmed`,
        )

        return {
          platform: PLATFORM,
          externalOrderId,
          confirmed: true,
          estimatedPickupAt: new Date(
            Date.now() + prepTimeMinutes * 60_000,
          ).toISOString(),
        }
      },
      { platform: PLATFORM, operation: 'confirmOrder' },
    )
  }

  async rejectOrder(
    externalOrderId: string,
    reason: string,
  ): Promise<OrderRejection> {
    return withRetry(
      async () => {
        await this.request(
          'PUT',
          `/pos/v1/merchant/${this.merchantId}/orders/${externalOrderId}/status`,
          {
            status: 'REJECTED',
            reason_code: mapRejectReason(reason),
            message: reason,
          },
        )

        log().info({ orderId: externalOrderId, reason }, `[grubhub] Order rejected`)

        return {
          platform: PLATFORM,
          externalOrderId,
          rejected: true,
        }
      },
      { platform: PLATFORM, operation: 'rejectOrder' },
    )
  }

  async markReady(
    externalOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return withRetry(
      async () => {
        await this.request(
          'PUT',
          `/pos/v1/merchant/${this.merchantId}/orders/${externalOrderId}/status`,
          { status: 'PICKUP_READY' },
        )

        log().info({ orderId: externalOrderId }, `[grubhub] Order marked ready`)
        return { success: true }
      },
      { platform: PLATFORM, operation: 'markReady' },
    )
  }

  async cancelOrder(
    externalOrderId: string,
    reason: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Grubhub uses the same status endpoint for cancellation
      await this.request(
        'PUT',
        `/pos/v1/merchant/${this.merchantId}/orders/${externalOrderId}/status`,
        {
          status: 'REJECTED',
          reason_code: 'OTHER',
          message: reason,
        },
      )

      log().info({ orderId: externalOrderId, reason }, `[grubhub] Order cancelled`)
      return { success: true }
    } catch (error) {
      const msg = error instanceof PlatformApiError
        ? `${error.statusCode}: ${error.responseBody}`
        : (error as Error).message
      log().error({ orderId: externalOrderId, error: msg }, `[grubhub] Cancel failed`)
      return { success: false, error: msg }
    }
  }

  // ─── Menu Sync (Marketplace) ─────────────────────────────────────────────

  async syncMenu(items: MenuSyncItem[]): Promise<MenuSyncResult> {
    return withRetry(
      async () => {
        const menuPayload = this.buildMenuPayload(items)

        const { data } = await this.request('POST', '/pos/v1/menu/ingestion', menuPayload)
        const response = data as { job_id?: string }

        log().info(
          { itemCount: items.length, jobId: response.job_id },
          `[grubhub] Menu sync submitted`,
        )

        return {
          platform: PLATFORM,
          success: true,
          itemsSynced: items.length,
          errors: [],
          jobId: response.job_id,
        }
      },
      { platform: PLATFORM, operation: 'syncMenu' },
    )
  }

  async updateItemAvailability(
    externalItemId: string,
    available: boolean,
  ): Promise<{ success: boolean }> {
    // Grubhub does not support individual item availability toggles via API.
    // A full menu push is required. Log the intent and return success so callers
    // can queue a batched syncMenu call.
    log().warn(
      { externalItemId, available },
      `[grubhub] Individual item availability not supported — queue a full menu sync`,
    )
    return { success: true }
  }

  /**
   * Check status of an async menu ingestion job.
   */
  async checkMenuJob(jobId: string): Promise<{ status: string; errors: string[] }> {
    const { data } = await this.request('GET', `/pos/v1/menu/ingestion/jobs/${jobId}`)
    const response = data as { status?: string; errors?: string[] }

    return {
      status: response.status || 'UNKNOWN',
      errors: response.errors || [],
    }
  }

  // ─── Delivery as a Service — Grubhub Connect (DaaS) ─────────────────────

  async getDeliveryQuote(request: CreateDeliveryRequest): Promise<DeliveryQuote> {
    return withRetry(
      async () => {
        const payload = {
          pickup_address: request.pickupAddress,
          pickup_business_name: request.pickupBusinessName,
          pickup_phone_number: request.pickupPhoneNumber,
          pickup_instructions: request.pickupInstructions,
          pickup_time: request.pickupTime,
          dropoff_address: request.dropoffAddress,
          dropoff_phone_number: request.dropoffPhoneNumber,
          dropoff_instructions: request.dropoffInstructions,
          dropoff_contact_first_name: request.dropoffContactFirstName,
          dropoff_contact_last_name: request.dropoffContactLastName,
          order_value: request.orderValue, // cents
          external_order_id: request.externalOrderId,
          items: request.items?.map(i => ({
            name: i.name,
            quantity: i.quantity,
            price: i.price, // cents
          })),
        }

        const { data } = await this.request('POST', '/pos/v1/deliveries/quote', payload)
        const quote = data as {
          quote_id: string
          fee_amount: number
          currency: string
          estimated_pickup_minutes: number
          estimated_delivery_minutes: number
          expires_at: string
        }

        log().info(
          { quoteId: quote.quote_id, feeCents: quote.fee_amount },
          `[grubhub] Delivery quote received`,
        )

        return {
          platform: PLATFORM,
          quoteId: quote.quote_id,
          feeAmountCents: quote.fee_amount,
          currency: quote.currency || 'USD',
          estimatedPickupMinutes: quote.estimated_pickup_minutes,
          estimatedDeliveryMinutes: quote.estimated_delivery_minutes,
          expiresAt: quote.expires_at,
          rawResponse: quote as unknown as Record<string, unknown>,
        }
      },
      { platform: PLATFORM, operation: 'getDeliveryQuote' },
    )
  }

  async createDelivery(
    quoteId: string,
  ): Promise<{ externalDeliveryId: string; trackingUrl?: string }> {
    return withRetry(
      async () => {
        const { data } = await this.request('POST', '/pos/v1/deliveries', {
          quote_id: quoteId,
        })

        const delivery = data as {
          delivery_id: string
          tracking_url?: string
        }

        log().info(
          { deliveryId: delivery.delivery_id, quoteId },
          `[grubhub] Delivery created`,
        )

        return {
          externalDeliveryId: delivery.delivery_id,
          trackingUrl: delivery.tracking_url,
        }
      },
      { platform: PLATFORM, operation: 'createDelivery' },
    )
  }

  async cancelDelivery(
    externalDeliveryId: string,
    reason: string,
  ): Promise<{ success: boolean }> {
    try {
      await this.request('DELETE', `/pos/v1/deliveries/${externalDeliveryId}`)

      log().info(
        { deliveryId: externalDeliveryId, reason },
        `[grubhub] Delivery cancelled`,
      )
      return { success: true }
    } catch (error) {
      const msg = error instanceof PlatformApiError
        ? `${error.statusCode}: ${error.responseBody}`
        : (error as Error).message
      log().error(
        { deliveryId: externalDeliveryId, error: msg },
        `[grubhub] Cancel delivery failed`,
      )
      return { success: false }
    }
  }

  async getDeliveryStatus(externalDeliveryId: string): Promise<DeliveryTracking> {
    return withRetry(
      async () => {
        const { data } = await this.request(
          'GET',
          `/pos/v1/deliveries/${externalDeliveryId}`,
        )

        const delivery = data as {
          delivery_id: string
          status: string
          driver_name?: string
          driver_phone?: string
          driver_latitude?: number
          driver_longitude?: number
          estimated_pickup_at?: string
          estimated_delivery_at?: string
          tracking_url?: string
        }

        return {
          platform: PLATFORM,
          externalDeliveryId: delivery.delivery_id,
          status: mapConnectStatus(delivery.status),
          driverName: delivery.driver_name,
          driverPhone: delivery.driver_phone,
          driverLatitude: delivery.driver_latitude,
          driverLongitude: delivery.driver_longitude,
          estimatedPickupAt: delivery.estimated_pickup_at,
          estimatedDeliveryAt: delivery.estimated_delivery_at,
          trackingUrl: delivery.tracking_url,
        }
      },
      { platform: PLATFORM, operation: 'getDeliveryStatus' },
    )
  }

  // ─── Private: Menu payload builder ───────────────────────────────────────

  /**
   * Build the Grubhub full-menu ingestion payload from POS MenuSyncItems.
   * Groups items by category and maps modifiers to Grubhub modifier groups.
   * All prices converted from cents to dollars (Grubhub uses dollars).
   */
  private buildMenuPayload(items: MenuSyncItem[]): Record<string, unknown> {
    // Group items by category
    const categories = new Map<string, {
      id: string
      name: string
      items: MenuSyncItem[]
    }>()

    for (const item of items) {
      let cat = categories.get(item.categoryExternalId)
      if (!cat) {
        cat = { id: item.categoryExternalId, name: item.categoryName, items: [] }
        categories.set(item.categoryExternalId, cat)
      }
      cat.items.push(item)
    }

    return {
      restaurant_id: this.merchantId,
      categories: Array.from(categories.values()).map(cat => ({
        external_id: cat.id,
        name: cat.name,
        items: cat.items.map(item => ({
          external_id: item.externalId,
          name: item.name,
          description: item.description || '',
          price: item.price / 100, // cents → dollars
          image_url: item.imageUrl,
          available: item.available,
          modifier_groups: (item.modifierGroups || []).map(mg => ({
            external_id: mg.externalId,
            name: mg.name,
            min_selections: mg.minSelections,
            max_selections: mg.maxSelections,
            options: mg.options.map(opt => ({
              external_id: opt.externalId,
              name: opt.name,
              price: opt.price / 100, // cents → dollars
              available: opt.available,
            })),
          })),
        })),
      })),
    }
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createGrubhubClient(
  credentials: GrubhubCredentials,
  merchantId: string,
): GrubhubClient {
  return new GrubhubClient(credentials, merchantId)
}
