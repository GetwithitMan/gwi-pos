/**
 * T11 — CFD Loyalty Balance Refresh
 *
 * Emits a CFD refresh after every loyalty balance change so the customer-
 * facing display sees the new points/tier within ~100ms of the DB write.
 *
 * Called (fire-and-forget) by every loyalty balance mutation path:
 *   1. `loyalty-earn-worker.ts` — drain of PendingLoyaltyEarn (post-commit)
 *   2. `reverse-earn.ts` — refund/void/comp-void reversals
 *   3. `/api/loyalty/adjust` — admin manual adjustments
 *   4. `/api/loyalty/redeem` — redemption for a dollar discount
 *
 * Why this exists:
 * All four paths write `Customer.loyaltyPoints` asynchronously, AFTER whatever
 * CFD event (receipt-sent, idle, order-updated) has already fired. Without a
 * dedicated refresh, the CFD displays a stale points total until the next
 * order cycle.
 *
 * Contract:
 *   • NEVER throws — all failures are swallowed via `.catch(log.warn)`.
 *   • NEVER blocks the write path — callers `void emitCfdLoyaltyRefresh(...)`.
 *   • Rate-limited per customerId (10/sec) so a worker draining a large
 *     backlog does not fan out 1000 socket events.
 *   • When `orderId` belongs to an active (non-terminal) order, emits
 *     `dispatchCFDOrderUpdated` so the current CFD order view gets the
 *     fresh points. Otherwise emits `dispatchCFDLoyaltyBalanceUpdated`.
 *
 * FOLLOW-UP: The gwi-cfd Android app does NOT yet subscribe to
 * `cfd:loyalty-balance-updated`. Added separately — see dispatcher comment.
 */

import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import {
  dispatchCFDOrderUpdated,
  dispatchCFDLoyaltyBalanceUpdated,
} from '@/lib/socket-dispatch/cfd-dispatch'

const log = createChildLogger('emit-cfd-loyalty-refresh')

// Active (non-terminal) order statuses. Terminal states are paid/closed/
// voided/merged/cancelled/completed.
const ACTIVE_ORDER_STATUSES = new Set([
  'draft',
  'open',
  'in_progress',
  'sent',
  'pending',
  'split',
])

export interface EmitCfdLoyaltyRefreshParams {
  customerId: string
  locationId: string
  /** Optional — if provided AND the order is active, piggy-back the refresh
   *  on a dispatchCFDOrderUpdated so the CFD's current order view gets the
   *  fresh loyalty snapshot alongside the order totals. */
  orderId?: string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Rate limiter — coalesce >10 refreshes/sec for the same customerId.
//
// Simple sliding-window counter in-memory. The worst-case cost of a miss
// (firing a duplicate event) is one extra socket emit; the benefit is not
// swamping every CFD in the venue when the worker drains a backlog of 500
// pending earns for one customer (e.g. after a long outage replay).
// ──────────────────────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 1000
const RATE_LIMIT_MAX_CALLS = 10
const rateLimitBuckets = new Map<string, number[]>()

/**
 * Returns true if the call should proceed; false if it should be coalesced.
 * Exported for the test suite.
 */
export function _shouldEmitForCustomer(
  customerId: string,
  now: number = Date.now(),
): boolean {
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const existing = rateLimitBuckets.get(customerId) ?? []
  // Drop timestamps outside the window.
  const recent = existing.filter((t) => t > cutoff)
  if (recent.length >= RATE_LIMIT_MAX_CALLS) {
    rateLimitBuckets.set(customerId, recent)
    return false
  }
  recent.push(now)
  rateLimitBuckets.set(customerId, recent)
  return true
}

/** Reset the in-memory rate limiter — test hook only. */
export function _resetRateLimitForTests(): void {
  rateLimitBuckets.clear()
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Emit a CFD refresh event with the customer's latest loyalty balance.
 *
 * Fire-and-forget. Never throws. Never blocks the caller.
 */
export async function emitCfdLoyaltyRefresh(
  params: EmitCfdLoyaltyRefreshParams,
): Promise<void> {
  const { customerId, locationId, orderId } = params

  try {
    if (!customerId || !locationId) {
      return
    }

    // Rate-limit: coalesce rapid calls for the same customer.
    if (!_shouldEmitForCustomer(customerId)) {
      log.debug(
        { customerId, locationId },
        'Coalesced CFD loyalty refresh (rate-limited)',
      )
      return
    }

    // Fetch the fresh customer snapshot.
    const customer = await db.customer
      .findFirst({
        where: { id: customerId, locationId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          loyaltyPoints: true,
          lifetimePoints: true,
          loyaltyTier: { select: { name: true } },
        },
      })
      .catch((err) => {
        log.warn(
          { err, customerId, locationId },
          'Customer lookup failed during CFD loyalty refresh',
        )
        return null
      })

    if (!customer) {
      return
    }

    const loyaltyPoints = Number(customer.loyaltyPoints ?? 0)
    const lifetimePoints = Number(customer.lifetimePoints ?? 0)
    const tier = customer.loyaltyTier?.name ?? null
    const lastName = customer.lastName?.trim()
      ? customer.lastName.trim()
      : null

    // ── Active-order path ───────────────────────────────────────────────
    // If the caller gave us an orderId AND that order is still active,
    // piggy-back on dispatchCFDOrderUpdated so the CFD's live order view
    // gets both the refreshed loyalty snapshot and the current totals.
    if (orderId) {
      const order = await db.order
        .findFirst({
          where: { id: orderId, locationId, deletedAt: null },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            subtotal: true,
            taxTotal: true,
            total: true,
            discountTotal: true,
            taxFromInclusive: true,
            taxFromExclusive: true,
            items: {
              where: { deletedAt: null, status: 'active' },
              select: {
                name: true,
                quantity: true,
                itemTotal: true,
                status: true,
                modifiers: {
                  where: { deletedAt: null },
                  select: { name: true },
                },
              },
            },
          },
        })
        .catch((err) => {
          log.warn(
            { err, orderId, locationId },
            'Order lookup failed during CFD loyalty refresh',
          )
          return null
        })

      if (order && ACTIVE_ORDER_STATUSES.has(String(order.status))) {
        dispatchCFDOrderUpdated(locationId, {
          orderId: order.id,
          orderNumber: order.orderNumber,
          items: order.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            price: Number(i.itemTotal),
            modifiers: i.modifiers.map((m) => m.name),
            status: i.status,
          })),
          subtotal: Number(order.subtotal),
          tax: Number(order.taxTotal),
          total: Number(order.total),
          discountTotal: Number(order.discountTotal ?? 0),
          taxFromInclusive: Number(order.taxFromInclusive ?? 0),
          taxFromExclusive: Number(order.taxFromExclusive ?? 0),
          // Pass the fresh customer snapshot explicitly so the dispatcher
          // skips its own DB lookup and uses our up-to-date values.
          customer: {
            id: customer.id,
            firstName: customer.firstName,
            lastName,
            loyaltyPoints,
            tier,
          },
          loyaltyEnabled: true,
        })
        return
      }
    }

    // ── Post-pay / idle path ────────────────────────────────────────────
    // No active order — emit the dedicated loyalty-balance event.
    dispatchCFDLoyaltyBalanceUpdated(locationId, {
      customerId: customer.id,
      loyaltyPoints,
      lifetimePoints,
      tier,
      firstName: customer.firstName,
      lastName,
    })
  } catch (err) {
    // Belt-and-suspenders — every known failure is already caught above,
    // but callers depend on this never throwing.
    log.warn(
      { err, customerId, locationId, orderId },
      'emitCfdLoyaltyRefresh failed unexpectedly (swallowed)',
    )
  }
}
