/**
 * Payment Failure Compensation Handler
 *
 * Extracted from the pay route's catch block. Handles:
 *  1. Marking pending captures as 'failed' so idempotency keys can be retried
 *  2. Auto-voiding Datacap card transactions when recording fails after approval
 *  3. Critical error logging and venue event capture
 */

import { NextResponse } from 'next/server'
import { PrismaClient } from '@/generated/prisma/client'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { errorCapture } from '@/lib/error-capture'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('payment-failure')

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HandlePaymentFailureParams {
  error: unknown
  orderId: string
  body: Record<string, unknown>
  db: PrismaClient
  pendingCaptureIdempotencyKey: string | undefined
  autoVoidRecords: Record<string, unknown>[]
  autoVoidTerminalId: string | undefined
  autoVoidLocationId: string | undefined
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handlePaymentFailure({
  error,
  orderId,
  body,
  db,
  pendingCaptureIdempotencyKey,
  autoVoidRecords,
  autoVoidTerminalId,
  autoVoidLocationId,
}: HandlePaymentFailureParams): Promise<NextResponse> {
  console.error('Failed to process payment:', error)

  // DOUBLE-CHARGE PREVENTION: Mark pending capture as 'failed' so the idempotency key
  // can be retried. Fire-and-forget — if this fails the record stays 'processing' which
  // will block retries for safety (ops can manually reset via DB).
  if (pendingCaptureIdempotencyKey) {
    const pcErrorMsg = (error instanceof Error ? error.message : String(error)).substring(0, 500)
    void db.$executeRaw`
      UPDATE "_pending_captures" SET "status" = 'failed', "errorMessage" = ${pcErrorMsg}
       WHERE "idempotencyKey" = ${pendingCaptureIdempotencyKey} AND "status" = 'processing'
    `.catch((pcErr) => {
      console.warn('[PAY] Failed to mark pending capture as failed', {
        idempotencyKey: pendingCaptureIdempotencyKey,
        error: pcErr instanceof Error ? pcErr.message : String(pcErr),
      })
    })
  }

  if (autoVoidRecords.length > 0 && autoVoidTerminalId && autoVoidLocationId) {
    const locationId = autoVoidLocationId
    const tid = autoVoidTerminalId
    const records = autoVoidRecords
    void (async () => {
      try {
        const terminal = await db.terminal.findUnique({
          where: { id: tid },
          select: { paymentReaderId: true },
        })
        if (!terminal?.paymentReaderId) {
          console.error('[CRITICAL-PAYMENT] Cannot auto-void: no reader bound to terminal', {
            terminalId: tid, orderId, records: records.map((r: any) => r.datacapRecordNo),
          })
          return
        }
        const client = await getDatacapClient(locationId)
        for (const record of records) {
          const recordNo = (record as any).datacapRecordNo
          try {
            const voidResult = await client.voidSale(terminal.paymentReaderId!, { recordNo })
            const voided = voidResult.cmdStatus === 'Approved'
            console.error(`[CRITICAL-PAYMENT] Auto-void ${voided ? 'SUCCEEDED' : 'FAILED'} for recordNo=${recordNo}`, {
              orderId,
              amount: (record as any).amount,
              voidResult: { cmdStatus: voidResult.cmdStatus, textResponse: voidResult.textResponse },
            })
          } catch (voidErr) {
            console.error(`[CRITICAL-PAYMENT] Auto-void EXCEPTION for recordNo=${recordNo}`, {
              orderId, amount: (record as any).amount, error: voidErr,
            })
          }
        }
      } catch (lookupErr) {
        console.error('[CRITICAL-PAYMENT] Auto-void lookup failed', {
          orderId, terminalId: tid, error: lookupErr,
        })
      }
    })()

    return NextResponse.json(
      {
        error: 'Payment approved but recording failed — automatic reversal attempted. Check Datacap portal to confirm.',
        datacapRecordNos: records.map((r: any) => r.datacapRecordNo),
      },
      { status: 500 }
    )
  }

  console.error(`[PAY-500] Order ${orderId} payment failed:`, error instanceof Error ? error.stack : String(error))
  void errorCapture.critical('PAYMENT', 'Payment processing failed', {
    category: 'payment-processing-error',
    action: `Processing payment for Order ${orderId}`,
    orderId,
    error: error instanceof Error ? error : undefined,
    path: `/api/orders/${orderId}/pay`,
    requestBody: body,
  }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.pay'))
  void import('@/lib/venue-logger').then(({ logVenueEvent }) =>
    logVenueEvent({
      level: 'error',
      source: 'server',
      category: 'payment',
      message: `Payment failed for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
      details: { orderId, method: body?.method },
      stackTrace: error instanceof Error ? error.stack : undefined,
    })
  ).catch(err => log.warn({ err }, 'Background task failed'))

  return NextResponse.json(
    { error: 'Failed to process payment', detail: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  )
}
