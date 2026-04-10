/**
 * Pending Capture Lock Guard
 *
 * DOUBLE-CHARGE PREVENTION: Lock-and-check on _pending_captures table.
 * The FOR UPDATE lock serializes concurrent requests for the SAME order,
 * but a client retry with the same idempotencyKey can slip through the in-memory
 * idempotency check if the first request hasn't committed yet.
 * This INSERT with a unique index on idempotencyKey acts as a durable lock:
 *   - First request: INSERT succeeds -> proceed to payment
 *   - Concurrent retry: INSERT conflicts -> return 409 (or cached result)
 * Uses a savepoint so a missing table (pre-migration NUCs) doesn't abort the transaction.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createChildLogger } from '@/lib/logger'
import type { TxClient } from '../types'

const log = createChildLogger('pending-capture-guard')

export interface PendingCaptureResult {
  /** If non-null, return this response immediately (duplicate/in-progress) */
  earlyReturn: NextResponse | null
  /** Whether a pending capture row was successfully inserted/updated */
  inserted: boolean
}

/**
 * Acquire a durable lock on the _pending_captures table for this payment.
 * Returns earlyReturn if a duplicate is detected, or null to proceed.
 * The `inserted` flag tells the caller whether cleanup is needed on failure.
 */
export async function acquirePendingCaptureLock(
  tx: TxClient,
  idempotencyKey: string,
  orderId: string,
  locationId: string,
): Promise<PendingCaptureResult> {
  let pendingCaptureInserted = false

  try {
    await tx.$executeRaw`SAVEPOINT pending_capture_check`
    const existingPending = await tx.$queryRaw<Array<{ id: string; status: string; response_json: string | null }>>`
      SELECT id, status, response_json FROM "_pending_captures" WHERE "idempotencyKey" = ${idempotencyKey} LIMIT 1
    `
    if (Array.isArray(existingPending) && existingPending.length > 0) {
      const pending = existingPending[0] as any
      if (pending.status === 'processing') {
        await tx.$executeRaw`RELEASE SAVEPOINT pending_capture_check`
        return {
          earlyReturn: NextResponse.json(
            { error: 'Payment is already being processed. Please wait.', code: 'PAYMENT_IN_PROGRESS' },
            { status: 409 }
          ),
          inserted: false,
        }
      }
      if (pending.status === 'completed' && pending.response_json) {
        await tx.$executeRaw`RELEASE SAVEPOINT pending_capture_check`
        // Return cached result — idempotent response
        return {
          earlyReturn: NextResponse.json(
            { error: 'Payment already processed', code: 'DUPLICATE_PAYMENT', existingPayment: JSON.parse(pending.response_json) },
            { status: 409 }
          ),
          inserted: false,
        }
      }
      // status is 'failed' or 'pending' without response — allow retry by updating status
      await tx.$executeRaw`
        UPDATE "_pending_captures" SET "status" = 'processing', "errorMessage" = NULL WHERE "id" = ${pending.id}
      `
      pendingCaptureInserted = true
    } else {
      // No existing record — insert a new one with status='processing'
      const captureId = crypto.randomUUID()
      await tx.$executeRaw`
        INSERT INTO "_pending_captures" ("id", "orderId", "locationId", "cardRecordNo", "purchaseAmount", "totalAmount", "status", "idempotencyKey", "createdAt")
         VALUES (${captureId}, ${orderId}, ${locationId}, '', 0, 0, 'processing', ${idempotencyKey}, NOW())
         ON CONFLICT ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL DO NOTHING
      `
      // Check if our insert won (ON CONFLICT DO NOTHING means 0 rows if conflict)
      const verifyInsert = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "_pending_captures" WHERE "idempotencyKey" = ${idempotencyKey} AND "id" = ${captureId} LIMIT 1
      `
      if (Array.isArray(verifyInsert) && verifyInsert.length > 0) {
        pendingCaptureInserted = true
      } else {
        // Another concurrent request won the insert — this is a duplicate
        await tx.$executeRaw`RELEASE SAVEPOINT pending_capture_check`
        return {
          earlyReturn: NextResponse.json(
            { error: 'Payment is already being processed. Please wait.', code: 'PAYMENT_IN_PROGRESS' },
            { status: 409 }
          ),
          inserted: false,
        }
      }
    }
    await tx.$executeRaw`RELEASE SAVEPOINT pending_capture_check`
  } catch (pcError) {
    // Table may not exist on pre-migration NUCs — roll back savepoint and proceed without protection
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT pending_capture_check`.catch(err => log.warn({ err }, 'savepoint rollback failed'))
    console.warn('[PAY] _pending_captures check failed (table may not exist), proceeding without lock', {
      orderId, error: pcError instanceof Error ? pcError.message : String(pcError),
    })
  }

  return { earlyReturn: null, inserted: pendingCaptureInserted }
}
