/**
 * Build Payment Events — constructs PAYMENT_APPLIED and ORDER_CLOSED events
 * for the event ingestion pipeline (ingestAndProject).
 */

import crypto from 'crypto'
import { toNumber } from '@/lib/pricing'
import type { IngestEvent } from '@/lib/order-events/ingester'

interface PaymentRecord {
  id?: string
  amount: unknown
  tipAmount?: unknown
  totalAmount: unknown
  paymentMethod: string
  cardBrand?: string | null
  cardLast4?: string | null
  [key: string]: unknown
}

interface BuildResult {
  events: IngestEvent[]
  bridgeOverrides: Record<string, Record<string, unknown>>
}

/**
 * Build PAYMENT_APPLIED events and bridge overrides for each pending payment record.
 * Optionally appends ORDER_CLOSED if the order is fully paid.
 */
export function buildPaymentEvents(
  allPendingPayments: PaymentRecord[],
  orderId: string,
  paymentMutationOrigin: string,
  orderIsPaid: boolean,
): BuildResult {
  const events: IngestEvent[] = []
  const bridgeOverrides: Record<string, Record<string, unknown>> = {}

  for (const record of allPendingPayments) {
    const rec = record as any
    const paymentId = rec.id || crypto.randomUUID()

    // Ensure the record has an ID for bridge override keying
    rec.id = paymentId

    events.push({
      type: 'PAYMENT_APPLIED',
      payload: {
        paymentId,
        method: rec.paymentMethod,
        amountCents: Math.round(toNumber(rec.amount) * 100),
        tipCents: Math.round(toNumber(rec.tipAmount ?? 0) * 100),
        totalCents: Math.round(toNumber(rec.totalAmount) * 100),
        cardBrand: rec.cardBrand ?? null,
        cardLast4: rec.cardLast4 ?? null,
        status: 'approved',
      },
    })

    // All the extra Payment fields that aren't in the domain event
    bridgeOverrides[paymentId] = { ...rec, lastMutatedBy: paymentMutationOrigin }
    // Remove fields already in the event payload to avoid conflicts
    delete bridgeOverrides[paymentId].amount
    delete bridgeOverrides[paymentId].tipAmount
    delete bridgeOverrides[paymentId].totalAmount
    delete bridgeOverrides[paymentId].paymentMethod
    delete bridgeOverrides[paymentId].cardBrand
    delete bridgeOverrides[paymentId].cardLast4
    delete bridgeOverrides[paymentId].status
    delete bridgeOverrides[paymentId].orderId
    delete bridgeOverrides[paymentId].locationId
  }

  // Add ORDER_CLOSED if fully paid
  if (orderIsPaid) {
    events.push({
      type: 'ORDER_CLOSED',
      payload: { closedStatus: 'paid' },
    })
  }

  return { events, bridgeOverrides }
}
