/**
 * Loyalty Earn Outbox Processor
 *
 * Drains `PendingLoyaltyEarn` rows enqueued atomically inside the payment
 * commit transaction. Writes the canonical `LoyaltyTransaction` (type='earn')
 * and applies the tier promotion, if any.
 *
 * Tickets T2 + T4 of the Loyalty Rewards Cleanup workstream.
 *
 * Idempotency guarantees:
 *   1. Outbox row is `orderId @unique` — re-enqueues are rejected.
 *   2. Partial unique index on `LoyaltyTransaction(locationId, orderId) WHERE type='earn'`
 *      rejects any duplicate insert. The worker treats 23505 / P2002 as a
 *      benign "already processed" signal, logs it, and marks the outbox row
 *      as `succeeded` (ack). This handles worker retry AND the case where
 *      close-tab / pay / pay-all-splits all enqueued before T2 landed.
 *
 * Called:
 *   1. Best-effort from pay / close-tab / pay-all-splits post-commit
 *   2. Cron every 5 min (catch stragglers / retries)
 */

import crypto from 'crypto'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import { dispatchLoyaltyEarnDeadLetter } from '@/lib/socket-dispatch/misc-dispatch'

const log = createChildLogger('loyalty-earn-worker')

/**
 * Emit dead-letter observability signals (T9 — folded into worker per
 * team-lead decision). Mirrors the inventory:deduction-failed pattern in
 * `src/lib/deduction-processor.ts`.
 *
 * Fire-and-forget — observability MUST NOT block payment flow or worker
 * progress. Logs at error level + emits a critical socket event so admin
 * dashboards can alert. Each call corresponds to exactly one transition
 * of an outbox row into the `dead` status — the worker only reaches the
 * dead branch once per row (status=dead is terminal in the SQL claim
 * predicate), so no de-dup flag is required.
 */
function emitDeadLetterAlert(params: {
  locationId: string
  orderId: string
  customerId: string
  attempts: number
  lastError: string
}): void {
  log.error(
    {
      event: 'loyalty.earn_dead_letter',
      locationId: params.locationId,
      orderId: params.orderId,
      customerId: params.customerId,
      attempts: params.attempts,
      lastError: params.lastError,
    },
    '[LOYALTY] CRITICAL: Earn dead-lettered — points NOT credited. Manual adjustment required.'
  )
  void dispatchLoyaltyEarnDeadLetter(params.locationId, {
    orderId: params.orderId,
    customerId: params.customerId,
    attempts: params.attempts,
    lastError: params.lastError,
  }).catch((err) => log.warn({ err }, 'fire-and-forget loyalty:earn_dead_letter dispatch failed'))
}

interface ClaimedEarn {
  id: string
  locationId: string
  orderId: string
  customerId: string
  pointsEarned: number
  loyaltyEarningBase: unknown
  tierMultiplier: unknown
  employeeId: string | null
  orderNumber: number | null
  status: string
  attempts: number
  maxAttempts: number
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const anyErr = err as { code?: string; message?: string }
  if (anyErr.code === 'P2002') return true // Prisma unique constraint
  if (anyErr.code === '23505') return true // Postgres unique_violation
  if (typeof anyErr.message === 'string' && /duplicate key value|unique constraint/i.test(anyErr.message)) return true
  return false
}

/**
 * Atomically claim and process the next pending loyalty earn.
 *
 * Returns `{ processed: false }` when there is nothing to do.
 */
export async function processNextLoyaltyEarn(): Promise<{
  processed: boolean
  orderId?: string
  success?: boolean
  idempotent?: boolean
}> {
  // Atomically claim one row using FOR UPDATE SKIP LOCKED.
  const claimed: ClaimedEarn[] = await db.$queryRaw(Prisma.sql`
    UPDATE "PendingLoyaltyEarn"
    SET "status" = 'processing',
        "lastAttemptAt" = NOW(),
        "attempts" = "attempts" + 1,
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "PendingLoyaltyEarn"
       WHERE "status" IN ('pending', 'failed')
         AND "availableAt" <= NOW()
         AND "attempts" < "maxAttempts"
       ORDER BY "availableAt" ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "locationId", "orderId", "customerId", "pointsEarned",
              "loyaltyEarningBase", "tierMultiplier", "employeeId", "orderNumber",
              "status", "attempts", "maxAttempts"
  `)

  if (!claimed.length) {
    return { processed: false }
  }

  const job = claimed[0]

  try {
    const pointsEarned = Number(job.pointsEarned || 0)
    const tierMultiplier = Number(job.tierMultiplier || 1)
    if (pointsEarned <= 0) {
      // Nothing to write; ack.
      await db.pendingLoyaltyEarn.update({
        where: { id: job.id },
        data: { status: 'succeeded', succeededAt: new Date() },
      })
      return { processed: true, orderId: job.orderId, success: true }
    }

    await db.$transaction(async (tx) => {
      // 1) Lock the customer row, re-read balances (they may have shifted
      //    via concurrent redeem).
      const customers = await tx.$queryRaw<Array<{ loyaltyPoints: number; lifetimePoints: number; loyaltyProgramId: string | null; loyaltyTierId: string | null }>>`
        SELECT "loyaltyPoints", "lifetimePoints", "loyaltyProgramId", "loyaltyTierId"
          FROM "Customer"
         WHERE "id" = ${job.customerId} AND "locationId" = ${job.locationId} AND "deletedAt" IS NULL
         FOR UPDATE
      `
      if (customers.length === 0) {
        // Customer was hard-deleted between enqueue and drain. Ack the
        // outbox row — there is nothing to credit.
        throw new Error('CUSTOMER_NOT_FOUND')
      }
      const customer = customers[0]
      const currentPoints = Number(customer.loyaltyPoints || 0)
      const currentLifetime = Number(customer.lifetimePoints || 0)
      const balanceAfter = currentPoints + pointsEarned

      // 2) Insert the LoyaltyTransaction. Partial unique index will reject
      //    duplicates; we catch outside the tx.
      const txnId = crypto.randomUUID()
      const description = tierMultiplier > 1
        ? `Earned ${pointsEarned} points on order #${job.orderNumber ?? '—'} (${tierMultiplier}x tier)`
        : `Earned ${pointsEarned} points on order #${job.orderNumber ?? '—'}`
      await tx.$executeRaw`
        INSERT INTO "LoyaltyTransaction" (
          "id", "customerId", "locationId", "orderId", "type", "points",
          "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
        ) VALUES (
          ${txnId}, ${job.customerId}, ${job.locationId}, ${job.orderId}, 'earn', ${pointsEarned},
          ${currentPoints}, ${balanceAfter}, ${description}, ${job.employeeId || null}, NOW()
        )
      `

      // 3) Atomic increment of customer balances.
      await tx.$executeRaw`
        UPDATE "Customer"
           SET "loyaltyPoints" = "loyaltyPoints" + ${pointsEarned},
               "lifetimePoints" = "lifetimePoints" + ${pointsEarned},
               "updatedAt" = NOW()
         WHERE "id" = ${job.customerId}
      `

      // 4) Tier promotion — best-effort, skipped silently if LoyaltyTier
      //    table doesn't exist on this NUC yet.
      if (customer.loyaltyProgramId) {
        try {
          const newLifetime = currentLifetime + pointsEarned
          const tiers = await tx.$queryRaw<Array<{ id: string; name: string; minimumPoints: number }>>`
            SELECT "id", "name", "minimumPoints" FROM "LoyaltyTier"
             WHERE "programId" = ${customer.loyaltyProgramId} AND "deletedAt" IS NULL
             ORDER BY "minimumPoints" DESC
          `
          for (const tier of tiers) {
            if (newLifetime >= Number(tier.minimumPoints)) {
              if (tier.id !== customer.loyaltyTierId) {
                await tx.$executeRaw`
                  UPDATE "Customer" SET "loyaltyTierId" = ${tier.id}, "updatedAt" = NOW() WHERE "id" = ${job.customerId}
                `
              }
              break
            }
          }
        } catch (tierErr) {
          // Tier table may not exist on older NUCs — surface but don't fail
          log.warn({ err: tierErr, orderId: job.orderId }, 'Tier promotion check failed (non-fatal)')
        }
      }

      // 5) Mark outbox row succeeded inside the same transaction — commit
      //    or both succeed / both roll back.
      await tx.$executeRaw`
        UPDATE "PendingLoyaltyEarn"
           SET "status" = 'succeeded', "succeededAt" = NOW(), "updatedAt" = NOW()
         WHERE "id" = ${job.id}
      `
    })

    return { processed: true, orderId: job.orderId, success: true }
  } catch (earnErr) {
    // Idempotency backstop: partial unique index rejected this insert — some
    // earlier path already wrote the canonical earn row. Ack and move on.
    if (isUniqueViolation(earnErr)) {
      log.info(
        { orderId: job.orderId, customerId: job.customerId, attempts: job.attempts },
        'Loyalty earn already persisted — acking outbox row (idempotent)'
      )
      await db.pendingLoyaltyEarn.update({
        where: { id: job.id },
        data: {
          status: 'succeeded',
          succeededAt: new Date(),
          lastError: 'already_earned',
        },
      }).catch(err => log.warn({ err }, 'Failed to ack idempotent outbox row'))
      return { processed: true, orderId: job.orderId, success: true, idempotent: true }
    }

    const errorMessage = earnErr instanceof Error ? earnErr.message : String(earnErr)

    // Customer was hard-deleted — treat as terminal, ack.
    if (errorMessage === 'CUSTOMER_NOT_FOUND') {
      await db.pendingLoyaltyEarn.update({
        where: { id: job.id },
        data: {
          status: 'dead',
          lastError: 'customer_not_found',
          succeededAt: new Date(),
        },
      }).catch(err => log.warn({ err }, 'Failed to mark outbox row dead'))
      // T9 alert: dead-letter (terminal — customer gone).
      emitDeadLetterAlert({
        locationId: job.locationId,
        orderId: job.orderId,
        customerId: job.customerId,
        attempts: job.attempts,
        lastError: 'customer_not_found',
      })
      return { processed: true, orderId: job.orderId, success: false }
    }

    // Retryable failure — back off, mark failed (or dead after maxAttempts).
    const isDead = job.attempts >= job.maxAttempts
    const backoffSeconds = Math.pow(2, job.attempts) * 30
    const nextAvailable = new Date(Date.now() + backoffSeconds * 1000)
    await db.pendingLoyaltyEarn.update({
      where: { id: job.id },
      data: {
        status: isDead ? 'dead' : 'failed',
        lastError: errorMessage,
        ...(isDead ? {} : { availableAt: nextAvailable }),
      },
    }).catch(err => log.warn({ err }, 'Failed to update outbox row status after error'))

    if (isDead) {
      // T9 alert: dead-letter (retry exhausted).
      emitDeadLetterAlert({
        locationId: job.locationId,
        orderId: job.orderId,
        customerId: job.customerId,
        attempts: job.attempts,
        lastError: errorMessage,
      })
    } else {
      log.warn({ orderId: job.orderId, attempt: job.attempts, errorMessage }, 'Loyalty earn failed, will retry')
    }
    return { processed: true, orderId: job.orderId, success: false }
  }
}

/**
 * Drain all pending loyalty earns in a loop (max 100 iterations).
 * Used by the cron endpoint and by best-effort triggers.
 */
export async function processAllPendingLoyaltyEarns(): Promise<{
  processed: number
  succeeded: number
  failed: number
  idempotent: number
}> {
  let processed = 0
  let succeeded = 0
  let failed = 0
  let idempotent = 0

  for (let i = 0; i < 100; i++) {
    const result = await processNextLoyaltyEarn()
    if (!result.processed) break
    processed++
    if (result.success) succeeded++
    else failed++
    if (result.idempotent) idempotent++
  }

  return { processed, succeeded, failed, idempotent }
}
