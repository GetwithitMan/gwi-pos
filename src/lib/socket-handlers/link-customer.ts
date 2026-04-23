/**
 * Mobile Register customer-link socket handler.
 *
 * Mirrors the close-tab loopback pattern: the phone client emits a socket event,
 * the server HTTP-forwards to the canonical `PUT /api/orders/{id}/customer` route,
 * and broadcasts the result back over the socket so the requesting client (and
 * any other surface in the same location room — CFD, other mobile clients,
 * POS terminals) can react.
 *
 * The actual order mutation, event sourcing, outbox queueing, and downstream
 * loyalty wiring all happen inside the existing customer route. This handler is
 * a thin transport shim — it does NOT mutate the DB directly.
 */
import type { LinkCustomerRequestEvent, CustomerLinkedEvent } from '@/types/multi-surface'

export interface LinkCustomerDependencies {
  /** HTTP forward to PUT /api/orders/{id}/customer. Defaults to fetch + loopback. */
  httpFetch?: typeof fetch
  /** Origin for the loopback HTTP call. Defaults to http://127.0.0.1:${PORT}. */
  loopbackOrigin?: string
  /** Venue slug header forwarded to the customer route. */
  venueSlug?: string
  /** Logger (pino-shaped). */
  log?: {
    info: (obj: unknown, msg?: string) => void
    warn: (obj: unknown, msg?: string) => void
    error: (obj: unknown, msg?: string) => void
  }
}

export interface LinkCustomerResult {
  /** Payload to emit back as MOBILE_EVENTS.CUSTOMER_LINKED. */
  payload: CustomerLinkedEvent
  /**
   * Whether the result should also be broadcast to the location room.
   * Always true for both success + failure so other surfaces can refresh
   * (or surface the error if they were watching the same order).
   */
  broadcast: boolean
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Process a phone-originated customer link/unlink request.
 *
 * Validates inputs, calls the canonical customer route, and returns a normalized
 * payload ready to emit back over the socket.
 *
 * Pure-ish function — no socket emission inside, so it is easy to unit test.
 * The caller (socket-server.ts) is responsible for socket emission and broadcast.
 */
export async function processLinkCustomerRequest(
  data: Partial<LinkCustomerRequestEvent>,
  locationId: string | undefined,
  deps: LinkCustomerDependencies = {},
): Promise<LinkCustomerResult> {
  const log = deps.log
  const { orderId, customerId, employeeId } = data ?? {}

  if (!locationId) {
    return {
      payload: {
        orderId: orderId ?? '',
        success: false,
        customerId: customerId ?? null,
        error: 'Not authenticated to a location',
      },
      broadcast: false,
    }
  }

  if (!orderId || typeof orderId !== 'string') {
    return {
      payload: {
        orderId: orderId ?? '',
        success: false,
        customerId: customerId ?? null,
        error: 'Missing orderId',
      },
      broadcast: false,
    }
  }

  if (!employeeId || typeof employeeId !== 'string') {
    return {
      payload: {
        orderId,
        success: false,
        customerId: customerId ?? null,
        error: 'Missing employeeId',
      },
      broadcast: false,
    }
  }

  // customerId may be null (unlink) or a non-empty string. Anything else rejects.
  if (customerId !== null && (typeof customerId !== 'string' || customerId.length === 0)) {
    return {
      payload: {
        orderId,
        success: false,
        customerId: null,
        error: 'Invalid customerId',
      },
      broadcast: false,
    }
  }

  const httpFetch = deps.httpFetch ?? fetch
  const port = parseInt(process.env.PORT || '3005', 10)
  const origin = deps.loopbackOrigin ?? `http://127.0.0.1:${port}`
  const venueSlug = deps.venueSlug ?? process.env.POS_VENUE_SLUG ?? 'default'

  try {
    const res = await httpFetch(`${origin}/api/orders/${orderId}/customer`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-venue-slug': venueSlug,
      },
      body: JSON.stringify({ customerId, employeeId }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })

    let json: any = {}
    try {
      json = await res.json()
    } catch {
      // body was empty or not JSON
    }

    // The customer route wraps successful responses in { data: { ... } }
    // (via ok()) and errors in { error: '...' } (via err()).
    if (!res.ok) {
      const errorMsg =
        json?.error ||
        json?.data?.error?.message ||
        `Customer link failed (HTTP ${res.status})`
      log?.warn?.(
        { orderId, customerId, employeeId, status: res.status },
        'tab:link-customer-request — server route rejected',
      )
      return {
        payload: {
          orderId,
          success: false,
          customerId: customerId ?? null,
          error: String(errorMsg),
        },
        broadcast: true,
      }
    }

    const payload: CustomerLinkedEvent = {
      orderId,
      success: true,
      customerId: json?.data?.customerId ?? null,
      customer: json?.data?.customer ?? null,
      loyaltyEnabled: json?.data?.loyaltyEnabled ?? false,
    }
    return { payload, broadcast: true }
  } catch (err) {
    log?.error?.(
      { err, orderId, customerId, employeeId },
      'tab:link-customer-request — loopback call failed',
    )
    return {
      payload: {
        orderId,
        success: false,
        customerId: customerId ?? null,
        error: 'Failed to link customer',
      },
      broadcast: true,
    }
  }
}
