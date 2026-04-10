/**
 * Sync & Outage Effects
 *
 * - Total drift socket dispatch
 * - Outage mode payment flagging + cloud sync
 */
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import { dispatchPaymentProcessed } from '@/lib/socket-dispatch'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('payment-effects-sync')

// ─── 1. Total Drift Socket Dispatch ──────────────────────────────────────────

export function emitTotalDriftWarning(
  order: any,
  orderId: string,
  terminalId: string | null,
  totalDriftWarning: any,
): void {
  if (totalDriftWarning) {
    void dispatchPaymentProcessed(order.locationId, {
      orderId,
      status: 'total_drift_warning',
      totalDriftDetected: true,
      capturedTotal: totalDriftWarning.capturedTotal,
      currentTotal: totalDriftWarning.currentTotal,
      drift: totalDriftWarning.drift,
      sourceTerminalId: terminalId || undefined,
    } as any).catch(e => log.warn({ err: e }, 'R3: total drift socket dispatch failed'))
  }
}

// ─── 2. Outage Mode Payment Flagging + Cloud Sync ────────────────────────────

export function handleOutageModeSync(
  order: any,
  orderId: string,
  ingestResult: any,
): void {
  if (!isInOutageMode()) return

  // Flag payments processed during outage for reconciliation visibility
  const paymentIds = ingestResult.bridgedPayments.map((bp: { id: string }) => bp.id)
  if (paymentIds.length > 0) {
    // Batch flag payments for reconciliation (tenant-safe via PaymentRepository)
    for (const pid of paymentIds) {
      void PaymentRepository.updatePayment(pid, order.locationId, { needsReconciliation: true })
        .catch(err => console.error('[CRITICAL-PAYMENT] Failed to flag payment for reconciliation:', err))
    }
  }

  // Read back full Payment rows from local PG — BridgedPayment is missing
  // NOT NULL columns (locationId, createdAt, updatedAt, processedAt) that
  // would cause constraint violations on Neon replay.
  // CRITICAL: Outage queue writes are the ONLY path to Neon during outage.
  // If these fail, payment data is lost from cloud. Retry once.
  void (async () => {
    const fullPayments = await Promise.all(
      (paymentIds as string[]).map(pid => PaymentRepository.getPaymentById(pid, order.locationId))
    ).then(results => results.filter((p): p is NonNullable<typeof p> => p !== null))
    for (const fp of fullPayments) {
      void queueOutageWrite('Payment', fp.id, 'INSERT', fp as unknown as Record<string, unknown>, order.locationId).catch(async (err) => {
        console.error(`[CRITICAL-PAYMENT] Outage queue write failed for Payment ${fp.id}, retrying:`, err)
        try { await queueOutageWrite('Payment', fp.id, 'INSERT', fp as unknown as Record<string, unknown>, order.locationId) } catch (retryErr) {
          console.error(`[CRITICAL-PAYMENT] Outage queue write retry FAILED for Payment ${fp.id}:`, retryErr)
        }
      })
    }
    // Read back full Order for complete payload (updateData is partial)
    const fullOrder = await OrderRepository.getOrderById(orderId, order.locationId)
    if (fullOrder) {
      void queueOutageWrite('Order', orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>, order.locationId).catch(async (err) => {
        console.error(`[CRITICAL-PAYMENT] Outage queue write failed for Order ${orderId}, retrying:`, err)
        try { await queueOutageWrite('Order', orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>, order.locationId) } catch (retryErr) {
          console.error(`[CRITICAL-PAYMENT] Outage queue write retry FAILED for Order ${orderId}:`, retryErr)
        }
      })
    }
  })().catch(err => console.error('[CRITICAL-PAYMENT] Outage sync block failed:', err))
}
