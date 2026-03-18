/**
 * Payment Repository -- Tenant-Safe Payment Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.payment.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { PaymentRepository } from '@/lib/repositories'
 *   const payment = await PaymentRepository.getPaymentById(id, locationId)
 *   const payments = await PaymentRepository.getPaymentsForOrder(orderId, locationId, tx)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma, PaymentMethod, PaymentStatus } from '@/generated/prisma/client'

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get a payment by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted payments.
 */
export async function getPaymentById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Get a payment by ID or throw, scoped to locationId.
 * Use this when the payment MUST exist (e.g., inside a known-good transaction).
 */
export async function getPaymentByIdOrThrow(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const payment = await client.payment.findFirst({
    where: { id, locationId, deletedAt: null },
  })
  if (!payment) throw new Error(`Payment ${id} not found for location ${locationId}`)
  return payment
}

/**
 * Get a payment by ID with a custom include shape.
 * Escape hatch for route handlers that need specific relations
 * without duplicating locationId enforcement.
 */
export async function getPaymentByIdWithInclude<T extends Prisma.PaymentInclude>(
  id: string,
  locationId: string,
  include: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findFirst({
    where: { id, locationId, deletedAt: null },
    include,
  })
}

/**
 * Get a payment by ID with a custom select shape.
 * Useful for lightweight existence checks or single-field reads.
 */
export async function getPaymentByIdWithSelect<T extends Prisma.PaymentSelect>(
  id: string,
  locationId: string,
  select: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findFirst({
    where: { id, locationId, deletedAt: null },
    select,
  })
}

/**
 * Get all non-deleted payments for an order, scoped to locationId.
 * Returns payments ordered by processedAt (oldest first).
 */
export async function getPaymentsForOrder(
  orderId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findMany({
    where: { orderId, locationId, deletedAt: null },
    orderBy: { processedAt: 'asc' },
  })
}

/**
 * Get payments for an order filtered by status.
 */
export async function getPaymentsForOrderByStatus(
  orderId: string,
  locationId: string,
  status: PaymentStatus | PaymentStatus[],
  tx?: TxClient,
) {
  const client = getClient(tx)
  const statusFilter = Array.isArray(status) ? { in: status } : status
  return client.payment.findMany({
    where: { orderId, locationId, status: statusFilter, deletedAt: null },
    orderBy: { processedAt: 'asc' },
  })
}

/**
 * Get payments by method for a location (e.g., all cash payments).
 * Useful for shift close / EOD reporting.
 */
export async function getPaymentsByMethod(
  locationId: string,
  paymentMethod: PaymentMethod,
  where?: Omit<Prisma.PaymentWhereInput, 'locationId' | 'paymentMethod'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findMany({
    where: { locationId, paymentMethod, deletedAt: null, ...where },
    orderBy: { processedAt: 'desc' },
  })
}

/**
 * Get payments for a specific shift (for shift reconciliation).
 */
export async function getPaymentsForShift(
  shiftId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findMany({
    where: { shiftId, locationId, deletedAt: null },
    orderBy: { processedAt: 'asc' },
  })
}

/**
 * Get payments for a specific drawer (for drawer close reconciliation).
 */
export async function getPaymentsForDrawer(
  drawerId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findMany({
    where: { drawerId, locationId, deletedAt: null },
    orderBy: { processedAt: 'asc' },
  })
}

/**
 * Get payments processed by a specific employee.
 */
export async function getPaymentsByEmployee(
  employeeId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findMany({
    where: { employeeId, locationId, deletedAt: null },
    orderBy: { processedAt: 'desc' },
  })
}

/**
 * Find a payment by its idempotency key. Used for duplicate detection.
 */
export async function getPaymentByIdempotencyKey(
  idempotencyKey: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findFirst({
    where: { idempotencyKey, locationId },
  })
}

/**
 * Find a payment by its offline intent ID. Used for SAF deduplication.
 */
export async function getPaymentByOfflineIntentId(
  offlineIntentId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findFirst({
    where: { offlineIntentId, locationId },
  })
}

/**
 * Get payments needing reconciliation for a location.
 */
export async function getPaymentsNeedingReconciliation(
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findMany({
    where: { locationId, needsReconciliation: true, deletedAt: null },
    orderBy: { processedAt: 'desc' },
  })
}

/**
 * Get SAF (Store-and-Forward) payments by status.
 */
export async function getSafPayments(
  locationId: string,
  safStatus: string | string[],
  tx?: TxClient,
) {
  const client = getClient(tx)
  const safFilter = Array.isArray(safStatus) ? { in: safStatus } : safStatus
  return client.payment.findMany({
    where: { locationId, safStatus: safFilter, deletedAt: null },
    orderBy: { processedAt: 'desc' },
  })
}

/**
 * Check if a payment exists and belongs to this location.
 * Returns { id, status, locationId, orderId } or null. Lightweight check.
 */
export async function checkPaymentExists(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.findFirst({
    where: { id, locationId, deletedAt: null },
    select: { id: true, status: true, locationId: true, orderId: true },
  })
}

/**
 * Count payments matching filters for a location.
 */
export async function countPayments(
  locationId: string,
  where?: Omit<Prisma.PaymentWhereInput, 'locationId'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.count({
    where: { locationId, deletedAt: null, ...where },
  })
}

/**
 * Aggregate payment amounts for reporting.
 * Returns sum of amount, tipAmount, totalAmount for matching payments.
 */
export async function getPaymentSummary(
  locationId: string,
  where?: Omit<Prisma.PaymentWhereInput, 'locationId'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.aggregate({
    where: { locationId, deletedAt: null, ...where },
    _sum: {
      amount: true,
      tipAmount: true,
      totalAmount: true,
      refundedAmount: true,
      cashDiscountAmount: true,
    },
    _count: true,
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Create a payment with locationId baked in.
 */
export async function createPayment(
  locationId: string,
  data: Omit<Prisma.PaymentCreateInput, 'location'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.payment.create({
    data: {
      ...data,
      location: { connect: { id: locationId } },
    },
  })
}

/**
 * Update a payment, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * This is safer than update() which only takes { id } in where and has no tenant guard.
 *
 * Throws if no matching payment was found (count === 0).
 */
export async function updatePayment(
  id: string,
  locationId: string,
  data: Prisma.PaymentUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.payment.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`Payment ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}

/**
 * Update a payment and return the updated record with includes.
 *
 * Two-step: updateMany (tenant-safe) then findFirst (tenant-safe)
 * to return the full updated object.
 */
export async function updatePaymentAndReturn<T extends Prisma.PaymentInclude>(
  id: string,
  locationId: string,
  data: Prisma.PaymentUpdateManyMutationInput,
  include?: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.payment.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`Payment ${id} not found for location ${locationId} -- update failed`)
  }
  return client.payment.findFirst({
    where: { id, locationId, deletedAt: null },
    ...(include ? { include } : {}),
  })
}

/**
 * Soft-delete a payment (set deletedAt). Never hard-delete.
 */
export async function softDeletePayment(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updatePayment(id, locationId, { deletedAt: new Date() }, tx)
}

/**
 * Void a payment -- set status to voided + record who/when/why.
 */
export async function voidPayment(
  id: string,
  locationId: string,
  voidedBy: string,
  reason?: string,
  tx?: TxClient,
) {
  return updatePayment(
    id,
    locationId,
    {
      status: 'voided',
      voidedAt: new Date(),
      voidedBy,
      voidReason: reason ?? null,
    },
    tx,
  )
}

/**
 * Record a refund against a payment.
 * Adds to the refundedAmount (supports partial refunds).
 */
export async function recordRefund(
  id: string,
  locationId: string,
  refundAmount: number,
  reason?: string,
  tx?: TxClient,
) {
  return updatePayment(
    id,
    locationId,
    {
      refundedAmount: { increment: refundAmount },
      refundedAt: new Date(),
      refundReason: reason ?? null,
      status: 'refunded',
    },
    tx,
  )
}

/**
 * Update tip amount on a payment (after tip adjustment).
 */
export async function updateTip(
  id: string,
  locationId: string,
  tipAmount: number,
  totalAmount: number,
  tx?: TxClient,
) {
  return updatePayment(
    id,
    locationId,
    { tipAmount, totalAmount },
    tx,
  )
}

/**
 * Mark a payment as settled/batched by the processor.
 */
export async function markSettled(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updatePayment(id, locationId, { settledAt: new Date() }, tx)
}

/**
 * Update SAF status on a payment.
 */
export async function updateSafStatus(
  id: string,
  locationId: string,
  safStatus: string,
  safError?: string | null,
  tx?: TxClient,
) {
  return updatePayment(
    id,
    locationId,
    {
      safStatus,
      ...(safStatus === 'UPLOAD_SUCCESS' ? { safUploadedAt: new Date() } : {}),
      ...(safError !== undefined ? { safError } : {}),
    },
    tx,
  )
}

/**
 * Mark a payment as reconciled.
 */
export async function markReconciled(
  id: string,
  locationId: string,
  reconciledBy: string,
  tx?: TxClient,
) {
  return updatePayment(
    id,
    locationId,
    {
      needsReconciliation: false,
      reconciledAt: new Date(),
      reconciledBy,
    },
    tx,
  )
}
