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
 *   • Per-customer trailing-edge debounce: high-frequency callers (worker
 *     draining a backlog, rapid back-to-back adjustments) are coalesced into
 *     at most ~10 emits/sec — but the FINAL state is ALWAYS emitted. We never
 *     silently drop an update; if a call exceeds the budget we schedule a
 *     trailing emit that re-fetches the customer at the window boundary so
 *     it carries the latest DB state.
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
// Trailing-edge coalescer — keep emit rate at ≤RATE_LIMIT_MAX_CALLS per
// RATE_LIMIT_WINDOW_MS for any one customer WITHOUT silently dropping
// updates. The latest state always wins:
//
//   • Under budget → emit immediately, record timestamp.
//   • Over budget → store the latest pending params; if no timer is yet
//     scheduled for this customer, schedule one to fire at the moment the
//     window slides open. When it fires, the deferred emit re-queries the
//     customer (so it sees whatever the FINAL DB state is at that instant)
//     and dispatches normally.
//
// Why re-fetching is safe: every dispatch path inside `_runEmit` does its
// own `db.customer.findFirst`, so a deferred emit naturally carries the
// latest snapshot. The only thing the coalescer caches is the last-known
// `(locationId, orderId)` tuple — these are stable for a given order and
// don't go stale within a 100ms window.
// ──────────────────────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 1000
const RATE_LIMIT_MAX_CALLS = 10

interface CoalesceState {
  /** Emit timestamps still inside the sliding window. */
  windowEmits: number[]
  /** Latest pending params for the trailing emit (null if nothing pending). */
  pendingParams: EmitCfdLoyaltyRefreshParams | null
  /** Active trailing-emit timer (null if none scheduled). */
  pendingTimer: ReturnType<typeof setTimeout> | null
}

const coalesceBuckets = new Map<string, CoalesceState>()

function getState(customerId: string): CoalesceState {
  let state = coalesceBuckets.get(customerId)
  if (!state) {
    state = { windowEmits: [], pendingParams: null, pendingTimer: null }
    coalesceBuckets.set(customerId, state)
  }
  return state
}

function pruneWindow(state: CoalesceState, now: number): void {
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  state.windowEmits = state.windowEmits.filter((t) => t > cutoff)
}

/**
 * Reset the in-memory coalescer — test hook only. Clears any pending timers
 * so test cases can't leak setTimeout handles between runs.
 */
export function _resetRateLimitForTests(): void {
  for (const state of coalesceBuckets.values()) {
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer)
    }
  }
  coalesceBuckets.clear()
}

/**
 * Test-only inspector: returns the current pending params for a customer.
 * Returns null when nothing is pending.
 */
export function _peekPendingForTests(
  customerId: string,
): EmitCfdLoyaltyRefreshParams | null {
  return coalesceBuckets.get(customerId)?.pendingParams ?? null
}

// ──────────────────────────────────────────────────────────────────────────
// Internal: actually fetch + dispatch. Never throws.
// ──────────────────────────────────────────────────────────────────────────

async function _runEmit(
  params: EmitCfdLoyaltyRefreshParams,
): Promise<void> {
  const { customerId, locationId, orderId } = params
  try {
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

// ──────────────────────────────────────────────────────────────────────────
// Trailing-emit timer plumbing
// ──────────────────────────────────────────────────────────────────────────

function scheduleTrailingEmit(
  customerId: string,
  state: CoalesceState,
  delayMs: number,
): void {
  if (state.pendingTimer) {
    return // already scheduled — newer params will be picked up when it fires
  }
  state.pendingTimer = setTimeout(() => {
    state.pendingTimer = null
    const params = state.pendingParams
    state.pendingParams = null
    if (!params) {
      return
    }

    // Re-evaluate the window AT FIRE TIME — if the burst is still going,
    // budget may already be full again, so we may need to re-defer. The
    // common case is the burst has died down and we just emit.
    const now = Date.now()
    pruneWindow(state, now)

    if (state.windowEmits.length < RATE_LIMIT_MAX_CALLS) {
      // Safe to emit. Record the timestamp + run.
      state.windowEmits.push(now)
      void _runEmit(params)
      return
    }

    // Still saturated — re-schedule for when the next slot opens.
    state.pendingParams = params
    const oldest = state.windowEmits[0] ?? now
    const nextAvailable = Math.max(1, oldest + RATE_LIMIT_WINDOW_MS - now)
    scheduleTrailingEmit(customerId, state, nextAvailable)
  }, Math.max(1, delayMs))

  // Don't keep the Node process alive solely to flush a CFD refresh.
  if (typeof state.pendingTimer === 'object' && state.pendingTimer !== null) {
    const t = state.pendingTimer as unknown as { unref?: () => void }
    if (typeof t.unref === 'function') {
      t.unref()
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Emit a CFD refresh event with the customer's latest loyalty balance.
 *
 * Fire-and-forget. Never throws. Never blocks the caller.
 *
 * Bursts >RATE_LIMIT_MAX_CALLS / RATE_LIMIT_WINDOW_MS for the same customer
 * are coalesced via a trailing-edge debounce: the LATEST params are emitted
 * once the window slides open. No update is ever silently dropped.
 */
export async function emitCfdLoyaltyRefresh(
  params: EmitCfdLoyaltyRefreshParams,
): Promise<void> {
  const { customerId, locationId } = params

  if (!customerId || !locationId) {
    return
  }

  const state = getState(customerId)
  const now = Date.now()
  pruneWindow(state, now)

  if (state.windowEmits.length < RATE_LIMIT_MAX_CALLS) {
    // Under budget — emit immediately.
    state.windowEmits.push(now)
    await _runEmit(params)
    return
  }

  // Over budget — coalesce. Latest call wins; schedule trailing emit if
  // none is already armed.
  const wasPending = state.pendingParams !== null
  state.pendingParams = params
  log.debug(
    { customerId, locationId, alreadyPending: wasPending },
    'Coalesced CFD loyalty refresh — trailing emit will carry latest state',
  )

  const oldest = state.windowEmits[0] ?? now
  const delayMs = Math.max(1, oldest + RATE_LIMIT_WINDOW_MS - now)
  scheduleTrailingEmit(customerId, state, delayMs)
}
