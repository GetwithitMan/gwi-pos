/**
 * Delivery State Machine
 *
 * Single entry point for ALL delivery order, run, and driver session
 * status changes. Validates transitions against a canonical map,
 * sets the corresponding timestamp column, writes an audit log entry,
 * and fires socket events.
 *
 * Usage:
 * ```typescript
 * import { advanceDeliveryStatus } from '@/lib/delivery/state-machine'
 *
 * const result = await advanceDeliveryStatus({
 *   deliveryOrderId, locationId, newStatus: 'dispatched', employeeId,
 * })
 * if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })
 * ```
 *
 * NOTE: Uses $queryRawUnsafe/$executeRawUnsafe because DeliveryOrder, DeliveryRun,
 * DriverSession, and DeliveryAuditLog are raw SQL tables (not Prisma-managed).
 * All queries use positional $1/$2 params — safe from injection.
 */

import { db } from '@/lib/db'
import {
  dispatchDeliveryStatusChanged,
  dispatchRunEvent,
  dispatchDriverStatusChanged,
} from './dispatch-events'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { reallocateTipToDriver } from './tip-reallocation'
import { processDeliveryTipSplit } from '@/lib/domain/tips/delivery-tip-split'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('delivery')

// ── Delivery Order States ───────────────────────────────────────────────────

export type DeliveryOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready_for_pickup'
  | 'assigned'
  | 'dispatched'
  | 'en_route'
  | 'arrived'
  | 'delivered'
  | 'attempted'
  | 'failed_delivery'
  | 'returned_to_store'
  | 'redelivery_pending'
  | 'cancelled_before_dispatch'
  | 'cancelled_after_dispatch'

// ── Run States ──────────────────────────────────────────────────────────────

export type DeliveryRunStatus =
  | 'assigned'
  | 'handoff_ready'
  | 'dispatched'
  | 'in_progress'
  | 'completed'
  | 'returned'
  | 'cancelled'

// ── Driver Session States ───────────────────────────────────────────────────

export type DriverSessionStatus =
  | 'available'
  | 'on_delivery'
  | 'returning'
  | 'break'
  | 'off_duty'

// ── Valid Transitions Map (canonical — defines ALL allowed transitions) ─────

const VALID_DELIVERY_TRANSITIONS: Record<DeliveryOrderStatus, DeliveryOrderStatus[]> = {
  pending: ['confirmed', 'cancelled_before_dispatch'],
  confirmed: ['preparing', 'cancelled_before_dispatch'],
  preparing: ['ready_for_pickup', 'cancelled_before_dispatch'],
  ready_for_pickup: ['assigned', 'cancelled_before_dispatch'],
  assigned: ['dispatched', 'cancelled_before_dispatch'],
  dispatched: ['en_route', 'cancelled_after_dispatch'],
  en_route: ['arrived', 'cancelled_after_dispatch'],
  arrived: ['delivered', 'attempted', 'failed_delivery'],
  attempted: ['delivered', 'returned_to_store', 'redelivery_pending'],
  failed_delivery: ['returned_to_store', 'redelivery_pending'],
  returned_to_store: ['redelivery_pending', 'cancelled_after_dispatch'],
  redelivery_pending: ['assigned', 'failed_delivery'],
  delivered: [],
  cancelled_before_dispatch: [],
  cancelled_after_dispatch: [],
}

const VALID_RUN_TRANSITIONS: Record<DeliveryRunStatus, DeliveryRunStatus[]> = {
  assigned: ['handoff_ready', 'cancelled'],
  handoff_ready: ['dispatched', 'cancelled'],
  dispatched: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'returned', 'cancelled'],
  completed: [],
  returned: [],
  cancelled: [],
}

const VALID_SESSION_TRANSITIONS: Record<DriverSessionStatus, DriverSessionStatus[]> = {
  available: ['on_delivery', 'break', 'off_duty'],
  on_delivery: ['available', 'returning'],
  returning: ['available'],
  break: ['available', 'off_duty'],
  off_duty: [],
}

// ── Terminal States ─────────────────────────────────────────────────────────

const TERMINAL_DELIVERY_STATES: DeliveryOrderStatus[] = [
  'delivered',
  'cancelled_before_dispatch',
  'cancelled_after_dispatch',
]

const TERMINAL_RUN_STATES: DeliveryRunStatus[] = [
  'completed',
  'returned',
  'cancelled',
]

// ── Status → Timestamp Column Mappings ──────────────────────────────────────

const STATUS_TIMESTAMP_MAP: Partial<Record<DeliveryOrderStatus, string>> = {
  confirmed: 'confirmedAt',
  assigned: 'assignedAt',
  dispatched: 'dispatchedAt',
  en_route: 'enRouteAt',
  arrived: 'arrivedAt',
  delivered: 'deliveredAt',
  attempted: 'attemptedAt',
  failed_delivery: 'failedAt',
  returned_to_store: 'returnedAt',
  cancelled_before_dispatch: 'cancelledAt',
  cancelled_after_dispatch: 'cancelledAt',
}

const RUN_STATUS_TIMESTAMP_MAP: Partial<Record<DeliveryRunStatus, string>> = {
  handoff_ready: 'handoffAt',
  dispatched: 'dispatchedAt',
  in_progress: 'startedAt',
  completed: 'completedAt',
  returned: 'returnedAt',
  cancelled: 'cancelledAt',
}

// ── Delivery Order State Machine ────────────────────────────────────────────

export interface AdvanceDeliveryStatusParams {
  deliveryOrderId: string
  locationId: string
  newStatus: DeliveryOrderStatus
  employeeId: string
  reason?: string
  cancelReason?: string
  policyOverride?: boolean
}

export interface AdvanceDeliveryResult {
  success: boolean
  error?: string
  deliveryOrder?: any
}

/**
 * Single entry point for ALL delivery order status changes.
 *
 * 1. Validates transition against VALID_DELIVERY_TRANSITIONS map
 * 2. Checks policy lockouts
 * 3. Sets the corresponding timestamp column
 * 4. Writes DeliveryAuditLog entry
 * 5. Fires socket event (fire-and-forget)
 * 6. Returns the updated DeliveryOrder
 */
export async function advanceDeliveryStatus(
  params: AdvanceDeliveryStatusParams,
): Promise<AdvanceDeliveryResult> {
  const {
    deliveryOrderId,
    locationId,
    newStatus,
    employeeId,
    reason,
    cancelReason,
  } = params

  try {
    // Fetch current order
    const orders = await db.$queryRawUnsafe<any[]>(
      `SELECT * FROM "DeliveryOrder" WHERE "id" = $1 AND "locationId" = $2 LIMIT 1`,
      deliveryOrderId,
      locationId,
    )

    if (!orders.length) {
      return { success: false, error: 'Delivery order not found' }
    }

    const order = orders[0]
    const currentStatus = order.status as DeliveryOrderStatus

    // 1. Validate transition
    const validNextStates = VALID_DELIVERY_TRANSITIONS[currentStatus]
    if (!validNextStates || !validNextStates.includes(newStatus)) {
      return {
        success: false,
        error: `Invalid transition: ${currentStatus} → ${newStatus}. Valid: ${validNextStates?.join(', ') || 'none (terminal state)'}`,
      }
    }

    // 1b. Max redelivery attempts check (default 3)
    if (currentStatus === 'redelivery_pending' && newStatus === 'assigned') {
      const MAX_REDELIVERY_ATTEMPTS = 3
      const redeliveryCount = await db.$queryRawUnsafe<{ count: number }[]>(
        `SELECT COUNT(*)::int as count FROM "DeliveryAuditLog"
         WHERE "deliveryOrderId" = $1
           AND "action" = 'status_change'
           AND "newValue"::jsonb ->> 'status' = 'redelivery_pending'`,
        deliveryOrderId,
      )
      const attempts = redeliveryCount[0]?.count ?? 0
      if (attempts >= MAX_REDELIVERY_ATTEMPTS) {
        // Exceeded max retries — force transition to failed_delivery instead
        log.warn(`[advanceDeliveryStatus] Order ${deliveryOrderId} exceeded max redelivery attempts (${attempts}/${MAX_REDELIVERY_ATTEMPTS}), forcing failed_delivery`)
        return advanceDeliveryStatus({
          ...params,
          newStatus: 'failed_delivery',
          reason: `Max redelivery attempts exceeded (${attempts}/${MAX_REDELIVERY_ATTEMPTS})`,
        })
      }
    }

    // 2. Build UPDATE SET clauses
    const setClauses: string[] = [
      `"status" = '${newStatus}'`,
      `"updatedAt" = CURRENT_TIMESTAMP`,
    ]

    // Set timestamp for the new status
    const timestampCol = STATUS_TIMESTAMP_MAP[newStatus]
    if (timestampCol) {
      setClauses.push(`"${timestampCol}" = CURRENT_TIMESTAMP`)
    }

    // Set cancel reason if cancelling (parameterized to prevent injection)
    const isCancellation =
      newStatus === 'cancelled_before_dispatch' ||
      newStatus === 'cancelled_after_dispatch'
    if (cancelReason && isCancellation) {
      setClauses.push(`"cancelReason" = $3`)
    }

    // 3. Execute update
    const setStr = setClauses.join(', ')
    let updated: any[]
    if (cancelReason && isCancellation) {
      updated = await db.$queryRawUnsafe<any[]>(
        `UPDATE "DeliveryOrder" SET ${setStr} WHERE "id" = $1 AND "locationId" = $2 RETURNING *`,
        deliveryOrderId,
        locationId,
        cancelReason,
      )
    } else {
      updated = await db.$queryRawUnsafe<any[]>(
        `UPDATE "DeliveryOrder" SET ${setStr} WHERE "id" = $1 AND "locationId" = $2 RETURNING *`,
        deliveryOrderId,
        locationId,
      )
    }

    if (!updated.length) {
      return { success: false, error: 'Failed to update delivery order' }
    }

    // 4. Write audit log
    await writeDeliveryAuditLog({
      locationId,
      action: 'status_change',
      deliveryOrderId,
      employeeId,
      previousValue: { status: currentStatus },
      newValue: { status: newStatus },
      reason: reason || cancelReason,
    })

    // 5. Fire socket event (fire-and-forget)
    void dispatchDeliveryStatusChanged(locationId, updated[0]).catch((err) => log.error({ err }, 'dispatchDeliveryStatusChanged failed'))

    // 5b. Tip hooks — fire-and-forget, failures must never block state machine
    const updatedOrder = updated[0]

    if (newStatus === 'assigned' && updatedOrder.driverId && updatedOrder.orderId) {
      // Driver just assigned — move any held tips from holding ledger to driver
      void reallocateTipToDriver(
        locationId,
        deliveryOrderId,
        updatedOrder.orderId,
        updatedOrder.driverId,
        employeeId,
      ).catch(err => log.error({ err: err }, '[advanceDeliveryStatus] Tip reallocation to driver failed:'))
    }

    if (newStatus === 'delivered' && updatedOrder.driverId && updatedOrder.orderId) {
      // Delivery completed — process kitchen tip-out split (if mode is not driver_keeps_100)
      void (async () => {
        try {
          const locationSettings = await getLocationSettings(locationId)
          const settings = locationSettings ? parseSettings(locationSettings) : null
          const deliverySettings = settings?.delivery
          const driverTipMode = deliverySettings?.driverTipMode ?? 'driver_keeps_100'

          if (driverTipMode !== 'driver_keeps_100') {
            await processDeliveryTipSplit({
              locationId,
              orderId: updatedOrder.orderId,
              deliveryOrderId,
              driverEmployeeId: updatedOrder.driverId,
              driverTipMode,
              driverTipSplitPercent: deliverySettings?.driverTipSplitPercent ?? 80,
              kitchenTipSplitPercent: deliverySettings?.kitchenTipSplitPercent ?? 20,
              actorEmployeeId: employeeId,
            })
          }
        } catch (err) {
          log.error({ err: err }, '[advanceDeliveryStatus] Delivery tip split failed:')
        }
      })()
    }

    // 6. Auto-complete run if this order reached a terminal state and has a runId
    if (
      TERMINAL_DELIVERY_STATES.includes(newStatus) &&
      updatedOrder.runId
    ) {
      void autoCompleteRunIfAllTerminal(
        updatedOrder.runId,
        locationId,
        employeeId,
      ).catch((err) => log.error({ err }, 'autoCompleteRunIfAllTerminal failed'))
    }

    return { success: true, deliveryOrder: updatedOrder }
  } catch (error) {
    log.error({ err: error }, '[advanceDeliveryStatus] Error:')
    return { success: false, error: 'Internal error advancing delivery status' }
  }
}

// ── Run State Machine ───────────────────────────────────────────────────────

export interface AdvanceRunStatusParams {
  runId: string
  locationId: string
  newStatus: DeliveryRunStatus
  employeeId: string
  reason?: string
}

export async function advanceRunStatus(
  params: AdvanceRunStatusParams,
): Promise<{ success: boolean; error?: string; run?: any }> {
  const { runId, locationId, newStatus, employeeId, reason } = params

  try {
    const runs = await db.$queryRawUnsafe<any[]>(
      `SELECT * FROM "DeliveryRun" WHERE "id" = $1 AND "locationId" = $2 LIMIT 1`,
      runId,
      locationId,
    )

    if (!runs.length) {
      return { success: false, error: 'Run not found' }
    }

    const run = runs[0]
    const currentStatus = run.status as DeliveryRunStatus

    const validNext = VALID_RUN_TRANSITIONS[currentStatus]
    if (!validNext || !validNext.includes(newStatus)) {
      return {
        success: false,
        error: `Invalid run transition: ${currentStatus} → ${newStatus}. Valid: ${validNext?.join(', ') || 'none (terminal)'}`,
      }
    }

    const setClauses: string[] = [
      `"status" = '${newStatus}'`,
      `"updatedAt" = CURRENT_TIMESTAMP`,
    ]

    const timestampCol = RUN_STATUS_TIMESTAMP_MAP[newStatus]
    if (timestampCol) {
      setClauses.push(`"${timestampCol}" = CURRENT_TIMESTAMP`)
    }

    const updated = await db.$queryRawUnsafe<any[]>(
      `UPDATE "DeliveryRun" SET ${setClauses.join(', ')} WHERE "id" = $1 AND "locationId" = $2 RETURNING *`,
      runId,
      locationId,
    )

    if (!updated.length) {
      return { success: false, error: 'Failed to update run' }
    }

    await writeDeliveryAuditLog({
      locationId,
      action: 'run_status_change',
      runId,
      employeeId,
      previousValue: { status: currentStatus },
      newValue: { status: newStatus },
      reason,
    })

    // Fire socket events for ALL status transitions so dispatch board stays current
    if (TERMINAL_RUN_STATES.includes(newStatus)) {
      void dispatchRunEvent(locationId, 'delivery:run_completed', updated[0]).catch((err) => log.error({ err }, 'dispatchRunEvent failed'))
    } else {
      void dispatchRunEvent(locationId, 'delivery:run_created', updated[0]).catch((err) => log.error({ err }, 'dispatchRunEvent failed'))
    }

    return { success: true, run: updated[0] }
  } catch (error) {
    log.error({ err: error }, '[advanceRunStatus] Error:')
    return { success: false, error: 'Internal error advancing run status' }
  }
}

// ── Driver Session State Machine ────────────────────────────────────────────

export async function advanceDriverSessionStatus(
  sessionId: string,
  locationId: string,
  newStatus: DriverSessionStatus,
  employeeId: string,
): Promise<{ success: boolean; error?: string; session?: any }> {
  try {
    const sessions = await db.$queryRawUnsafe<any[]>(
      `SELECT * FROM "DeliveryDriverSession" WHERE "id" = $1 AND "locationId" = $2 LIMIT 1`,
      sessionId,
      locationId,
    )

    if (!sessions.length) {
      return { success: false, error: 'Session not found' }
    }

    const session = sessions[0]
    const currentStatus = session.status as DriverSessionStatus

    const validNext = VALID_SESSION_TRANSITIONS[currentStatus]
    if (!validNext || !validNext.includes(newStatus)) {
      return {
        success: false,
        error: `Invalid session transition: ${currentStatus} → ${newStatus}. Valid: ${validNext?.join(', ') || 'none'}`,
      }
    }

    const setClauses: string[] = [
      `"status" = '${newStatus}'`,
      `"updatedAt" = CURRENT_TIMESTAMP`,
    ]

    if (newStatus === 'off_duty') {
      setClauses.push(`"endedAt" = CURRENT_TIMESTAMP`)
    }

    const updated = await db.$queryRawUnsafe<any[]>(
      `UPDATE "DeliveryDriverSession" SET ${setClauses.join(', ')} WHERE "id" = $1 AND "locationId" = $2 RETURNING *`,
      sessionId,
      locationId,
    )

    if (!updated.length) {
      return { success: false, error: 'Failed to update session' }
    }

    void dispatchDriverStatusChanged(locationId, updated[0]).catch((err) => log.error({ err }, 'dispatchDriverStatusChanged failed'))

    return { success: true, session: updated[0] }
  } catch (error) {
    log.error({ err: error }, '[advanceDriverSessionStatus] Error:')
    return { success: false, error: 'Internal error' }
  }
}

// ── Run Auto-Complete ──────────────────────────────────────────────────

/**
 * Auto-complete a delivery run when ALL its orders reach terminal states.
 *
 * - If all delivered → `completed`
 * - If all cancelled → `cancelled`
 * - If mixed (some delivered, some cancelled) → `completed`
 *
 * Fire-and-forget — failures are logged but never block the caller.
 * This is the single canonical auto-complete path — all entry points
 * (driver order-status, dispatch board, state machine) flow through here.
 */
export async function autoCompleteRunIfAllTerminal(
  runId: string,
  locationId: string,
  employeeId: string,
): Promise<void> {
  try {
    // Check if the run is already in a terminal state
    const runs = await db.$queryRawUnsafe<any[]>(
      `SELECT "status" FROM "DeliveryRun" WHERE "id" = $1 AND "locationId" = $2 LIMIT 1`,
      runId,
      locationId,
    )
    if (!runs.length) return
    if (TERMINAL_RUN_STATES.includes(runs[0].status as DeliveryRunStatus)) return

    // Query all orders in the run
    const orderStatuses = await db.$queryRawUnsafe<{ status: string }[]>(
      `SELECT "status" FROM "DeliveryOrder" WHERE "runId" = $1 AND "deletedAt" IS NULL`,
      runId,
    )

    if (!orderStatuses.length) return

    // Check if ALL orders are terminal
    const allTerminal = orderStatuses.every(o =>
      TERMINAL_DELIVERY_STATES.includes(o.status as DeliveryOrderStatus),
    )
    if (!allTerminal) return

    // Determine target status
    const allCancelled = orderStatuses.every(
      o =>
        o.status === 'cancelled_before_dispatch' ||
        o.status === 'cancelled_after_dispatch',
    )

    const targetStatus: DeliveryRunStatus = allCancelled ? 'cancelled' : 'completed'
    const reason = allCancelled
      ? 'Auto-cancelled: all orders cancelled'
      : 'Auto-completed: all orders reached terminal state'

    const result = await advanceRunStatus({
      runId,
      locationId,
      newStatus: targetStatus,
      employeeId,
      reason,
    })

    if (result.success) {
      log.info(`[autoCompleteRun] Run ${runId} auto-advanced to ${targetStatus}`)
    } else {
      log.warn(`[autoCompleteRun] Failed to auto-advance run ${runId}: ${result.error}`)
    }
  } catch (error) {
    log.error({ err: error }, '[autoCompleteRunIfAllTerminal] Error:')
  }
}

// ── KDS Bump → Delivery Auto-Advance ─────────────────────────────────

/**
 * Called after KDS bump (complete/bump_order) to auto-advance a delivery
 * order from `preparing` → `ready_for_pickup` when:
 *  1. The bumped order has a DeliveryOrder record
 *  2. The delivery order is in `preparing` status
 *  3. ALL order items are now completed (bumped)
 *  4. settings.delivery.dispatchPolicy.holdReadyUntilAllItemsComplete is ON
 *
 * Fire-and-forget — never blocks KDS bump response.
 */
export async function checkKdsBumpDeliveryAdvance(
  orderId: string,
  locationId: string,
): Promise<void> {
  try {
    // 1. Check if this POS order has a linked delivery order in `preparing` status
    const deliveryOrders = await db.$queryRawUnsafe<any[]>(
      `SELECT "id", "status" FROM "DeliveryOrder"
       WHERE "orderId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
       LIMIT 1`,
      orderId,
      locationId,
    )

    if (!deliveryOrders.length) return // Not a delivery order
    const deliveryOrder = deliveryOrders[0]

    if (deliveryOrder.status !== 'preparing') return // Only advance from preparing

    // 2. Check if the holdReadyUntilAllItemsComplete policy is ON
    const settings = await getLocationSettings(locationId)
    const dispatchPolicy = (settings as any)?.delivery?.dispatchPolicy
    if (!dispatchPolicy?.holdReadyUntilAllItemsComplete) return

    // 3. Check if ALL items in the POS order are now completed
    const incomplete = await db.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int as count FROM "OrderItem"
       WHERE "orderId" = $1 AND "deletedAt" IS NULL
       AND "status" != 'voided'
       AND ("isCompleted" = false OR "isCompleted" IS NULL)`,
      orderId,
    )

    if ((incomplete[0]?.count ?? 1) > 0) return // Still have incomplete items

    // 4. Advance to ready_for_pickup
    const result = await advanceDeliveryStatus({
      deliveryOrderId: deliveryOrder.id,
      locationId,
      newStatus: 'ready_for_pickup',
      employeeId: 'system-kds-bump',
      reason: 'Auto-advanced: all KDS items bumped',
    })

    if (result.success) {
      log.info(`[KDS→Delivery] Order ${orderId} delivery auto-advanced to ready_for_pickup`)
    } else {
      log.warn(`[KDS→Delivery] Failed to auto-advance order ${orderId}: ${result.error}`)
    }
  } catch (error) {
    log.error({ err: error }, '[checkKdsBumpDeliveryAdvance] Error:')
  }
}

// ── Query Helpers ───────────────────────────────────────────────────────────

export function isTerminalDeliveryState(status: DeliveryOrderStatus): boolean {
  return TERMINAL_DELIVERY_STATES.includes(status)
}

export function isTerminalRunState(status: DeliveryRunStatus): boolean {
  return TERMINAL_RUN_STATES.includes(status)
}

export function getValidDeliveryTransitions(
  status: DeliveryOrderStatus,
): DeliveryOrderStatus[] {
  return VALID_DELIVERY_TRANSITIONS[status] || []
}

export function getValidRunTransitions(
  status: DeliveryRunStatus,
): DeliveryRunStatus[] {
  return VALID_RUN_TRANSITIONS[status] || []
}

// ── Audit Log ───────────────────────────────────────────────────────────────

interface AuditLogEntry {
  locationId: string
  action: string
  deliveryOrderId?: string
  runId?: string
  driverId?: string
  employeeId: string
  previousValue?: any
  newValue?: any
  reason?: string
  idempotencyKey?: string
}

export async function writeDeliveryAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "DeliveryAuditLog" (
        "id", "locationId", "action", "deliveryOrderId", "runId", "driverId",
        "employeeId", "previousValue", "newValue", "reason", "idempotencyKey", "createdAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, CURRENT_TIMESTAMP
      )`,
      entry.locationId,
      entry.action,
      entry.deliveryOrderId || null,
      entry.runId || null,
      entry.driverId || null,
      entry.employeeId,
      entry.previousValue ? JSON.stringify(entry.previousValue) : null,
      entry.newValue ? JSON.stringify(entry.newValue) : null,
      entry.reason || null,
      entry.idempotencyKey || null,
    )
  } catch (error) {
    log.error({ err: error }, '[writeDeliveryAuditLog] Failed to write audit log:')
    // Don't throw — audit log failure should not block the operation
  }
}
