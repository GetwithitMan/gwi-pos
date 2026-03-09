/**
 * Inventory Deduction Outbox Processor
 *
 * Atomically claims pending deduction jobs (FOR UPDATE SKIP LOCKED)
 * and runs inventory deductions (food + liquor via unified deductInventoryForOrder).
 *
 * Called:
 *  1. Best-effort from pay route (immediate processing)
 *  2. Cron every 5 min (catch stragglers / retries)
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { deductInventoryForOrder } from '@/lib/inventory'
// NOTE: processLiquorInventory was removed from this processor (2026-03-09).
// deductInventoryForOrder() already handles liquor items via recipeIngredients
// (BottleProduct → InventoryItem) with spirit substitution support. Running both
// caused every liquor item to be deducted TWICE from InventoryItem.currentStock,
// inflating COGS by ~100% for liquor.

interface ClaimedDeduction {
  id: string
  locationId: string
  orderId: string
  paymentId: string | null
  deductionType: string
  status: string
  attempts: number
  maxAttempts: number
  availableAt: Date
  lastError: string | null
  lastAttemptAt: Date | null
  succeededAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Atomically claim and process the next pending deduction.
 */
export async function processNextDeduction(): Promise<{
  processed: boolean
  orderId?: string
  success?: boolean
}> {
  // Atomically claim one row using FOR UPDATE SKIP LOCKED
  const claimed: ClaimedDeduction[] = await db.$queryRaw(Prisma.sql`
    UPDATE "PendingDeduction"
    SET status = 'processing',
        "lastAttemptAt" = NOW(),
        attempts = attempts + 1,
        "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "PendingDeduction"
      WHERE status IN ('pending', 'failed')
        AND "availableAt" <= NOW()
        AND attempts < "maxAttempts"
      ORDER BY "availableAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `)

  if (!claimed.length) {
    return { processed: false }
  }

  const job = claimed[0]
  const startMs = Date.now()

  try {
    // Run inventory deduction (handles both food recipes AND liquor recipeIngredients)
    const foodResult = await deductInventoryForOrder(job.orderId, null)

    const durationMs = Date.now() - startMs

    if (!foodResult.success) {
      // Deduction returned a failure — treat like a retryable error
      const errorMessage = foodResult.errors?.[0] ?? 'deductInventoryForOrder returned success: false'
      const isDead = job.attempts >= job.maxAttempts
      const backoffSeconds = Math.pow(2, job.attempts) * 30
      const nextAvailable = new Date(Date.now() + backoffSeconds * 1000)

      await db.pendingDeduction.update({
        where: { id: job.id },
        data: {
          status: isDead ? 'dead' : 'failed',
          lastError: errorMessage,
          ...(isDead ? {} : { availableAt: nextAvailable }),
        },
      })

      await db.deductionRun.create({
        data: {
          pendingDeductionId: job.id,
          success: false,
          error: errorMessage,
          durationMs,
        },
      })

      console.error(`[deduction-processor] Order ${job.orderId} deduction failed (attempt ${job.attempts}):`, errorMessage)
      return { processed: true, orderId: job.orderId, success: false }
    }

    // Mark succeeded — only when deduction actually succeeded
    await db.pendingDeduction.update({
      where: { id: job.id },
      data: {
        status: 'succeeded',
        succeededAt: new Date(),
      },
    })

    // Record run
    await db.deductionRun.create({
      data: {
        pendingDeductionId: job.id,
        success: true,
        durationMs,
        resultSummary: {
          food: 'ok',
          itemsDeducted: foodResult.itemsDeducted,
          totalCost: foodResult.totalCost,
        } as Prisma.JsonObject,
      },
    })

    return { processed: true, orderId: job.orderId, success: true }
  } catch (err) {
    const durationMs = Date.now() - startMs
    const errorMessage = err instanceof Error ? err.message : String(err)

    // Determine next status
    const isDead = job.attempts >= job.maxAttempts
    const backoffSeconds = Math.pow(2, job.attempts) * 30
    const nextAvailable = new Date(Date.now() + backoffSeconds * 1000)

    await db.pendingDeduction.update({
      where: { id: job.id },
      data: {
        status: isDead ? 'dead' : 'failed',
        lastError: errorMessage,
        ...(isDead ? {} : { availableAt: nextAvailable }),
      },
    })

    // Record run
    await db.deductionRun.create({
      data: {
        pendingDeductionId: job.id,
        success: false,
        error: errorMessage,
        durationMs,
      },
    })

    console.error(`[deduction-processor] Order ${job.orderId} failed (attempt ${job.attempts}):`, errorMessage)
    return { processed: true, orderId: job.orderId, success: false }
  }
}

/**
 * Process all pending deductions in a loop (max 100 iterations).
 * Used by the cron endpoint.
 */
export async function processAllPending(): Promise<{
  processed: number
  succeeded: number
  failed: number
}> {
  let processed = 0
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < 100; i++) {
    const result = await processNextDeduction()
    if (!result.processed) break
    processed++
    if (result.success) succeeded++
    else failed++
  }

  return { processed, succeeded, failed }
}
