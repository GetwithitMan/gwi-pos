// ---------------------------------------------------------------------------
// DoorDash API client — Marketplace + Drive (DaaS)
//
// Marketplace: receive orders from DoorDash app, confirm/reject, mark ready
// Drive: request DoorDash drivers for your own orders (delivery-as-a-service)
//
// Auth: JWT (HS256) signed with per-venue credentials. Tokens are short-lived
// (5 min) and generated fresh for each request batch.
// ---------------------------------------------------------------------------

import { createHmac } from 'crypto'

import type { GwiLogger } from '@/lib/logger'
import { platformFetch, withRetry, PlatformApiError } from './base-client'
import type {
  IPlatformClient,
  DoorDashCredentials,
  DeliveryQuote,
  DeliveryStatus,
  DeliveryTracking,
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
    _log = require('@/lib/logger').createChildLogger('doordash-client')
  }
  return _log!
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://openapi.doordash.com'
const JWT_EXPIRY_SECONDS = 300 // 5 minutes

// ---------------------------------------------------------------------------
// JWT generation (HS256, no jsonwebtoken dependency)
// ---------------------------------------------------------------------------

function base64UrlEncode(input: string | Buffer): string {
  const b64 = Buffer.from(input).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createJwt(credentials: DoorDashCredentials): string {
  const now = Math.floor(Date.now() / 1000)

  const header = {
    alg: 'HS256',
    typ: 'JWT',
    'dd-ver': 'DD-JWT-V1',
  }

  const payload = {
    aud: 'doordash',
    iss: credentials.developerId,
    kid: credentials.keyId,
    exp: now + JWT_EXPIRY_SECONDS,
    iat: now,
  }

  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`

  // Signing secret from DoorDash may be base64-encoded
  const secretBytes = Buffer.from(credentials.signingSecret, 'base64')
  const signature = createHmac('sha256', secretBytes)
    .update(signingInput)
    .digest()
  const signatureB64 = base64UrlEncode(signature)

  return `${signingInput}.${signatureB64}`
}

// ---------------------------------------------------------------------------
// DoorDash Drive status → unified DeliveryStatus mapping
// ---------------------------------------------------------------------------

const DRIVE_STATUS_MAP: Record<string, DeliveryStatus> = {
  // Pre-assignment
  'quote': 'created',
  'created': 'created',

  // Driver assigned & en route
  'confirmed': 'confirmed',
  'enroute_to_pickup': 'driver_en_route_pickup',
  'arrived_at_pickup': 'driver_arrived_pickup',
  'picked_up': 'picked_up',
  'enroute_to_dropoff': 'driver_en_route_dropoff',
  'arrived_at_dropoff': 'driver_arrived_dropoff',

  // Terminal
  'delivered': 'delivered',
  'cancelled': 'cancelled',
  'returned': 'failed',
}

function mapDriveStatus(ddStatus: string): DeliveryStatus {
  return DRIVE_STATUS_MAP[ddStatus] ?? 'created'
}

// ---------------------------------------------------------------------------
// DoorDash Client
// ---------------------------------------------------------------------------

export class DoorDashClient implements IPlatformClient {
  readonly platform = 'doordash' as const

  private credentials: DoorDashCredentials
  private storeId: string

  constructor(credentials: DoorDashCredentials, storeId: string) {
    this.credentials = credentials
    this.storeId = storeId
  }

  // ── Auth header ─────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    const token = createJwt(this.credentials)
    return { Authorization: `Bearer ${token}` }
  }

  // ── Marketplace: confirm order ──────────────────────────────────────────

  async confirmOrder(
    externalOrderId: string,
    _prepTimeMinutes?: number,
    posOrderId?: string,
  ): Promise<OrderConfirmation> {
    try {
      await withRetry(
        () =>
          platformFetch('doordash', {
            method: 'PATCH',
            url: `${BASE_URL}/marketplace/api/v1/orders/${externalOrderId}`,
            headers: this.authHeaders(),
            body: { order_status: 'success', merchant_supplied_id: posOrderId || '' },
          }),
        { platform: 'doordash', operation: `confirmOrder(${externalOrderId})` },
      )

      log().info(
        { externalOrderId },
        'DoorDash order confirmed',
      )

      return {
        platform: 'doordash',
        externalOrderId,
        confirmed: true,
      }
    } catch (error) {
      const msg = error instanceof PlatformApiError
        ? `DoorDash confirm failed: ${error.statusCode} — ${error.responseBody.slice(0, 200)}`
        : `DoorDash confirm failed: ${(error as Error).message}`

      log().error({ err: error, externalOrderId }, msg)

      return {
        platform: 'doordash',
        externalOrderId,
        confirmed: false,
        error: msg,
      }
    }
  }

  // ── Marketplace: reject order ───────────────────────────────────────────

  async rejectOrder(
    externalOrderId: string,
    reason: string,
  ): Promise<OrderRejection> {
    try {
      await withRetry(
        () =>
          platformFetch('doordash', {
            method: 'PATCH',
            url: `${BASE_URL}/marketplace/api/v1/orders/${externalOrderId}`,
            headers: this.authHeaders(),
            body: { order_status: 'fail', failure_reason: reason },
          }),
        { platform: 'doordash', operation: `rejectOrder(${externalOrderId})` },
      )

      log().info(
        { externalOrderId, reason },
        'DoorDash order rejected',
      )

      return {
        platform: 'doordash',
        externalOrderId,
        rejected: true,
      }
    } catch (error) {
      const msg = error instanceof PlatformApiError
        ? `DoorDash reject failed: ${error.statusCode} — ${error.responseBody.slice(0, 200)}`
        : `DoorDash reject failed: ${(error as Error).message}`

      log().error({ err: error, externalOrderId }, msg)

      return {
        platform: 'doordash',
        externalOrderId,
        rejected: false,
        error: msg,
      }
    }
  }

  // ── Marketplace: mark order ready for pickup ────────────────────────────

  async markReady(
    externalOrderId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await withRetry(
        () =>
          platformFetch('doordash', {
            method: 'PATCH',
            url: `${BASE_URL}/marketplace/api/v1/orders/${externalOrderId}/events/order_ready_for_pickup`,
            headers: this.authHeaders(),
            body: { merchant_supplied_id: '' },
          }),
        { platform: 'doordash', operation: `markReady(${externalOrderId})` },
      )

      log().info({ externalOrderId }, 'DoorDash order marked ready for pickup')
      return { success: true }
    } catch (error) {
      const msg = error instanceof PlatformApiError
        ? `DoorDash markReady failed: ${error.statusCode} — ${error.responseBody.slice(0, 200)}`
        : `DoorDash markReady failed: ${(error as Error).message}`

      log().error({ err: error, externalOrderId }, msg)
      return { success: false, error: msg }
    }
  }

  // ── Marketplace: cancel order ───────────────────────────────────────────

  async cancelOrder(
    externalOrderId: string,
    reason: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await withRetry(
        () =>
          platformFetch('doordash', {
            method: 'PATCH',
            url: `${BASE_URL}/marketplace/api/v1/orders/${externalOrderId}/cancellation`,
            headers: this.authHeaders(),
            body: { cancel_reason: mapCancelReason(reason) },
          }),
        { platform: 'doordash', operation: `cancelOrder(${externalOrderId})` },
      )

      log().info({ externalOrderId, reason }, 'DoorDash order cancelled')
      return { success: true }
    } catch (error) {
      const msg = error instanceof PlatformApiError
        ? `DoorDash cancel failed: ${error.statusCode} — ${error.responseBody.slice(0, 200)}`
        : `DoorDash cancel failed: ${(error as Error).message}`

      log().error({ err: error, externalOrderId }, msg)
      return { success: false, error: msg }
    }
  }

  // ── Marketplace: sync menu ──────────────────────────────────────────────

  async syncMenu(items: MenuSyncItem[]): Promise<MenuSyncResult> {
    const errors: string[] = []

    try {
      const menuPayload = buildDoorDashMenuPayload(items, this.storeId)

      const { data } = await withRetry(
        () =>
          platformFetch('doordash', {
            method: 'POST',
            url: `${BASE_URL}/marketplace/api/v1/menus`,
            headers: this.authHeaders(),
            body: menuPayload,
            timeoutMs: 60_000, // menu pushes can be large
          }),
        { platform: 'doordash', operation: 'syncMenu', maxRetries: 1 },
      )

      const response = data as Record<string, unknown>
      const jobId = (response.job_id ?? response.id ?? '') as string

      log().info(
        { itemCount: items.length, jobId },
        'DoorDash menu sync submitted',
      )

      return {
        platform: 'doordash',
        success: true,
        itemsSynced: items.filter(i => i.available).length,
        errors,
        jobId: jobId || undefined,
      }
    } catch (error) {
      const msg = error instanceof PlatformApiError
        ? `DoorDash menu sync failed: ${error.statusCode} — ${error.responseBody.slice(0, 500)}`
        : `DoorDash menu sync failed: ${(error as Error).message}`

      log().error({ err: error }, msg)
      errors.push(msg)

      return {
        platform: 'doordash',
        success: false,
        itemsSynced: 0,
        errors,
      }
    }
  }

  // ── Marketplace: update item availability (86 an item) ──────────────────

  async updateItemAvailability(
    externalItemId: string,
    available: boolean,
  ): Promise<{ success: boolean }> {
    try {
      await withRetry(
        () =>
          platformFetch('doordash', {
            method: 'PUT',
            url: `${BASE_URL}/api/v1/stores/${this.storeId}/items/status`,
            headers: this.authHeaders(),
            body: {
              item_ids: [externalItemId],
              active: available,
            },
          }),
        {
          platform: 'doordash',
          operation: `updateItemAvailability(${externalItemId}, ${available})`,
        },
      )

      log().info(
        { externalItemId, available, storeId: this.storeId },
        `DoorDash item ${available ? 'enabled' : '86\'d'}`,
      )

      return { success: true }
    } catch (error) {
      log().error(
        { err: error, externalItemId, available },
        'DoorDash updateItemAvailability failed',
      )
      return { success: false }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DoorDash Drive (DaaS)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Drive: get delivery quote ───────────────────────────────────────────

  async getDeliveryQuote(request: CreateDeliveryRequest): Promise<DeliveryQuote> {
    const body = {
      external_delivery_id: request.externalOrderId,
      order_value: request.orderValue, // cents
      tip: request.tip ?? 0,
      pickup_address: request.pickupAddress,
      pickup_business_name: request.pickupBusinessName,
      pickup_phone_number: request.pickupPhoneNumber,
      pickup_instructions: request.pickupInstructions ?? '',
      pickup_time: request.pickupTime,
      dropoff_address: request.dropoffAddress,
      dropoff_business_name: request.dropoffBusinessName ?? '',
      dropoff_phone_number: request.dropoffPhoneNumber,
      dropoff_instructions: request.dropoffInstructions ?? '',
      dropoff_contact_given_name: request.dropoffContactFirstName,
      dropoff_contact_family_name: request.dropoffContactLastName ?? '',
      items: (request.items ?? []).map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price, // cents
      })),
    }

    const { data } = await withRetry(
      () =>
        platformFetch('doordash', {
          method: 'POST',
          url: `${BASE_URL}/drive/v2/quotes`,
          headers: this.authHeaders(),
          body,
        }),
      { platform: 'doordash', operation: 'getDeliveryQuote' },
    )

    const resp = data as Record<string, unknown>

    log().info(
      { quoteId: resp.external_delivery_id, fee: resp.fee },
      'DoorDash Drive quote received',
    )

    return {
      platform: 'doordash',
      quoteId: (resp.external_delivery_id ?? resp.id ?? '') as string,
      feeAmountCents: (resp.fee ?? 0) as number,
      currency: (resp.currency ?? 'USD') as string,
      estimatedPickupMinutes: estimateMinutes(resp.pickup_time_estimated as string | undefined),
      estimatedDeliveryMinutes: estimateMinutes(resp.dropoff_time_estimated as string | undefined),
      expiresAt: (resp.quote_expiration ?? '') as string,
      rawResponse: resp,
    }
  }

  // ── Drive: accept quote (create delivery) ───────────────────────────────

  async createDelivery(
    quoteId: string,
  ): Promise<{ externalDeliveryId: string; trackingUrl?: string }> {
    const { data } = await withRetry(
      () =>
        platformFetch('doordash', {
          method: 'POST',
          url: `${BASE_URL}/drive/v2/quotes/${quoteId}/accept`,
          headers: this.authHeaders(),
        }),
      { platform: 'doordash', operation: `createDelivery(${quoteId})` },
    )

    const resp = data as Record<string, unknown>

    log().info(
      { quoteId, deliveryId: resp.external_delivery_id },
      'DoorDash Drive delivery created',
    )

    return {
      externalDeliveryId: (resp.external_delivery_id ?? quoteId) as string,
      trackingUrl: (resp.tracking_url ?? undefined) as string | undefined,
    }
  }

  // ── Drive: get delivery status ──────────────────────────────────────────

  async getDeliveryStatus(externalDeliveryId: string): Promise<DeliveryTracking> {
    const { data } = await withRetry(
      () =>
        platformFetch('doordash', {
          method: 'GET',
          url: `${BASE_URL}/drive/v2/deliveries/${externalDeliveryId}`,
          headers: this.authHeaders(),
        }),
      { platform: 'doordash', operation: `getDeliveryStatus(${externalDeliveryId})` },
    )

    const resp = data as Record<string, unknown>
    const dasher = resp.dasher as Record<string, unknown> | undefined
    const dasherLocation = dasher?.location as Record<string, unknown> | undefined

    return {
      platform: 'doordash',
      externalDeliveryId,
      status: mapDriveStatus((resp.delivery_status ?? 'created') as string),
      driverName: dasher
        ? `${dasher.first_name ?? ''} ${dasher.last_name ?? ''}`.trim() || undefined
        : undefined,
      driverPhone: (dasher?.phone_number ?? undefined) as string | undefined,
      driverLatitude: (dasherLocation?.lat ?? undefined) as number | undefined,
      driverLongitude: (dasherLocation?.lng ?? undefined) as number | undefined,
      estimatedPickupAt: (resp.pickup_time_estimated ?? undefined) as string | undefined,
      estimatedDeliveryAt: (resp.dropoff_time_estimated ?? undefined) as string | undefined,
      trackingUrl: (resp.tracking_url ?? undefined) as string | undefined,
    }
  }

  // ── Drive: cancel delivery ──────────────────────────────────────────────

  async cancelDelivery(
    externalDeliveryId: string,
    reason: string,
  ): Promise<{ success: boolean }> {
    try {
      await withRetry(
        () =>
          platformFetch('doordash', {
            method: 'PUT',
            url: `${BASE_URL}/drive/v2/deliveries/${externalDeliveryId}/cancel`,
            headers: this.authHeaders(),
            body: { cancel_reason: mapCancelReason(reason) },
          }),
        { platform: 'doordash', operation: `cancelDelivery(${externalDeliveryId})` },
      )

      log().info({ externalDeliveryId, reason }, 'DoorDash Drive delivery cancelled')
      return { success: true }
    } catch (error) {
      log().error(
        { err: error, externalDeliveryId },
        'DoorDash Drive cancel failed',
      )
      return { success: false }
    }
  }
}

// ---------------------------------------------------------------------------
// Menu payload builder
//
// DoorDash menu format:
//   Menu → store_id, categories[]
//   Category → id, title, items[]
//   Item → id, title, description, price, extras[]
//   Extra (modifier group) → id, title, min_num_options, max_num_options, options[]
//   Option (modifier) → id, title, price, active
// ---------------------------------------------------------------------------

interface DDMenuOption {
  id: string
  title: string
  price: number // cents
  active: boolean
}

interface DDMenuExtra {
  id: string
  title: string
  min_num_options: number
  max_num_options: number
  options: DDMenuOption[]
}

interface DDMenuItem {
  id: string
  title: string
  description: string
  price: number // cents
  active: boolean
  image_url?: string
  extras: DDMenuExtra[]
}

interface DDMenuCategory {
  id: string
  title: string
  items: DDMenuItem[]
}

interface DDMenuPayload {
  store_id: string
  categories: DDMenuCategory[]
}

function buildDoorDashMenuPayload(
  items: MenuSyncItem[],
  storeId: string,
): DDMenuPayload {
  // Group items by category
  const categoryMap = new Map<string, { id: string; name: string; items: MenuSyncItem[] }>()

  for (const item of items) {
    let cat = categoryMap.get(item.categoryExternalId)
    if (!cat) {
      cat = { id: item.categoryExternalId, name: item.categoryName, items: [] }
      categoryMap.set(item.categoryExternalId, cat)
    }
    cat.items.push(item)
  }

  const categories: DDMenuCategory[] = []

  for (const cat of Array.from(categoryMap.values())) {
    const ddItems: DDMenuItem[] = cat.items.map(item => {
      const extras: DDMenuExtra[] = (item.modifierGroups ?? []).map(group => ({
        id: group.externalId,
        title: group.name,
        min_num_options: group.minSelections,
        max_num_options: group.maxSelections,
        options: group.options.map(opt => ({
          id: opt.externalId,
          title: opt.name,
          price: opt.price, // cents
          active: opt.available,
        })),
      }))

      return {
        id: item.externalId,
        title: item.name,
        description: item.description ?? '',
        price: item.price, // cents
        active: item.available,
        ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
        extras,
      }
    })

    categories.push({
      id: cat.id,
      title: cat.name,
      items: ddItems,
    })
  }

  return { store_id: storeId, categories }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate minutes from now until an ISO timestamp.
 * Returns 0 if the timestamp is missing or in the past.
 */
function estimateMinutes(isoTimestamp: string | undefined): number {
  if (!isoTimestamp) return 0
  const diff = new Date(isoTimestamp).getTime() - Date.now()
  return Math.max(0, Math.round(diff / 60_000))
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDoorDashClient(
  credentials: DoorDashCredentials,
  storeId: string,
): DoorDashClient {
  return new DoorDashClient(credentials, storeId)
}
