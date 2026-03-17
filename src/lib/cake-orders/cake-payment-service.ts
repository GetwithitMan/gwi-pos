/**
 * Cake Payment Service
 *
 * Settlement order creation, payment recording, text-to-pay,
 * and financial verification for cake orders.
 *
 * All cake tables are raw SQL (not Prisma-managed).
 * All amounts are in dollars (matching POS convention).
 */

import crypto from 'crypto'
import { type CakeSettlementType } from './schemas'
import { emitToLocation } from '@/lib/socket-server'
import { sendSMS } from '@/lib/twilio'
import { parseSettings, type TextToPaySettings, DEFAULT_TEXT_TO_PAY } from '@/lib/settings'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DbClient {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>
  location: { findFirst: (args: any) => Promise<any> }
  auditLog: { create: (args: any) => Promise<any> }
}

// ─── Settlement Order Creation ──────────────────────────────────────────────

/**
 * Create a settlement POS order for a cake deposit or balance payment.
 * Settlement orders are non-taxable, single-line, immutable.
 *
 * Creates an Order + OrderItem in the POS system so Datacap can process
 * the payment through the standard payment flow. The Order.metadata JSONB
 * stores the link back to the CakeOrder.
 */
export async function createSettlementOrder(
  db: DbClient,
  params: {
    cakeOrderId: string
    cakeOrderNumber: number
    customerId: string
    locationId: string
    employeeId: string
    amount: number // in dollars
    appliedTo: 'deposit' | 'balance'
  }
): Promise<{ orderId: string }> {
  const { cakeOrderId, cakeOrderNumber, customerId, locationId, employeeId, amount, appliedTo } = params

  if (amount <= 0) {
    throw new Error('Settlement order amount must be positive')
  }

  const orderId = crypto.randomUUID()
  const orderItemId = crypto.randomUUID()
  const orderType: CakeSettlementType = appliedTo === 'deposit'
    ? 'cake_deposit_settlement'
    : 'cake_balance_settlement'

  const label = appliedTo === 'deposit'
    ? `Cake #${cakeOrderNumber} - Deposit`
    : `Cake #${cakeOrderNumber} - Balance`

  const metadata = JSON.stringify({
    cakeOrderId,
    appliedTo,
  })

  // Create the settlement Order
  await db.$executeRawUnsafe(`
    INSERT INTO "Order" (
      "id", "locationId", "employeeId", "customerId",
      "orderType", "status", "subtotal", "tax", "total",
      "metadata", "notes",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4,
      $5, 'open', $6, 0, $6,
      $7::jsonb, $8,
      NOW(), NOW()
    )
  `,
    orderId,
    locationId,
    employeeId,
    customerId,
    orderType,
    amount,
    metadata,
    label,
  )

  // Create a single OrderItem for the settlement amount
  await db.$executeRawUnsafe(`
    INSERT INTO "OrderItem" (
      "id", "orderId", "locationId", "name", "quantity", "price", "total",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, 1, $5, $5,
      NOW(), NOW()
    )
  `,
    orderItemId,
    orderId,
    locationId,
    label,
    amount,
  )

  // Audit log
  void db.auditLog.create({
    data: {
      locationId,
      employeeId,
      action: 'cake_settlement_order_created',
      entityType: 'CakeOrder',
      entityId: cakeOrderId,
      details: {
        orderId,
        orderType,
        amount,
        appliedTo,
        cakeOrderNumber,
      },
    },
  }).catch(err => console.error('[cake-payment] Audit log failed:', err))

  return { orderId }
}

// ─── Payment Recording ──────────────────────────────────────────────────────

/**
 * Record a cake payment (POS or external).
 * POS payments link to settlement order + POS payment.
 * External payments have no POS linkage.
 * Triggers PG recalculation trigger on CakePayment.
 */
export async function recordCakePayment(
  db: DbClient,
  params: {
    cakeOrderId: string
    type: 'payment' | 'refund' | 'forfeit'
    appliedTo: 'deposit' | 'balance'
    paymentSource: 'pos' | 'external'
    amount: number
    method: string
    posPaymentId?: string | null
    posOrderId?: string | null
    reversesCakePaymentId?: string | null
    reference?: string | null
    notes?: string | null
    processedBy: string
  }
): Promise<{ cakePaymentId: string }> {
  const {
    cakeOrderId, type, appliedTo, paymentSource, amount, method,
    posPaymentId, posOrderId, reversesCakePaymentId, reference, notes, processedBy,
  } = params

  if (amount <= 0) {
    throw new Error('Payment amount must be positive')
  }

  // Validate the cake order exists
  const rows = await db.$queryRawUnsafe<Array<{ id: string; status: string; locationId: string }>>(
    `SELECT "id", "status", "locationId" FROM "CakeOrder" WHERE "id" = $1`,
    cakeOrderId,
  )
  if (!rows || rows.length === 0) {
    throw new Error(`CakeOrder ${cakeOrderId} not found`)
  }

  const cakeOrder = rows[0]

  // For refunds, validate the reversed payment exists
  if (type === 'refund' && reversesCakePaymentId) {
    const reversedRows = await db.$queryRawUnsafe<Array<{ id: string; type: string }>>(
      `SELECT "id", "type" FROM "CakePayment" WHERE "id" = $1 AND "cakeOrderId" = $2`,
      reversesCakePaymentId,
      cakeOrderId,
    )
    if (!reversedRows || reversedRows.length === 0) {
      throw new Error(`CakePayment ${reversesCakePaymentId} not found for reversal`)
    }
  }

  const cakePaymentId = crypto.randomUUID()

  await db.$executeRawUnsafe(`
    INSERT INTO "CakePayment" (
      "id", "cakeOrderId", "type", "appliedTo",
      "paymentSource", "amount", "method",
      "posPaymentId", "posOrderId",
      "reversesCakePaymentId",
      "reference", "notes", "processedBy",
      "createdAt"
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8, $9,
      $10,
      $11, $12, $13,
      NOW()
    )
  `,
    cakePaymentId,
    cakeOrderId,
    type,
    appliedTo,
    paymentSource,
    amount,
    method,
    posPaymentId || null,
    posOrderId || null,
    reversesCakePaymentId || null,
    reference || null,
    notes || null,
    processedBy,
  )

  // Record change in CakeOrderChange audit trail
  const changeId = crypto.randomUUID()
  const changeType = type === 'payment' ? 'payment_recorded' : 'payment_refunded'
  await db.$executeRawUnsafe(`
    INSERT INTO "CakeOrderChange" (
      "id", "cakeOrderId", "changeType", "changedBy", "source",
      "details", "createdAt"
    ) VALUES (
      $1, $2, $3, $4, 'system',
      $5::jsonb, NOW()
    )
  `,
    changeId,
    cakeOrderId,
    changeType,
    processedBy,
    JSON.stringify({
      cakePaymentId,
      type,
      appliedTo,
      paymentSource,
      amount,
      method,
      posPaymentId: posPaymentId || null,
      posOrderId: posOrderId || null,
      reversesCakePaymentId: reversesCakePaymentId || null,
    }),
  )

  // Emit socket event for real-time updates
  void emitToLocation(cakeOrder.locationId, 'cake:payment-recorded', {
    cakeOrderId,
    cakePaymentId,
    type,
    appliedTo,
    amount,
  }).catch(err => console.error('[cake-payment] Socket emit failed:', err))

  return { cakePaymentId }
}

// ─── Settlement Completion Handler ──────────────────────────────────────────

/**
 * Handle cake settlement payment completion.
 * Called from /api/orders/[id]/pay route when orderType is cake_*_settlement.
 * Creates CakePayment, updates posSettlementOrderIds cache, emits socket event.
 */
export async function handleCakeSettlementCompletion(
  db: DbClient,
  params: {
    orderId: string // POS settlement order ID
    paymentId: string // POS payment ID
    locationId: string
    employeeId: string
  }
): Promise<void> {
  const { orderId, paymentId, locationId, employeeId } = params

  // Fetch the settlement order to extract cake metadata
  const orderRows = await db.$queryRawUnsafe<Array<{
    id: string
    orderType: string
    total: string | number
    metadata: any
  }>>(
    `SELECT "id", "orderType", "total", "metadata"
     FROM "Order"
     WHERE "id" = $1 AND "locationId" = $2`,
    orderId,
    locationId,
  )

  if (!orderRows || orderRows.length === 0) {
    throw new Error(`Settlement order ${orderId} not found`)
  }

  const order = orderRows[0]
  const metadata = typeof order.metadata === 'string'
    ? JSON.parse(order.metadata)
    : order.metadata

  if (!metadata?.cakeOrderId || !metadata?.appliedTo) {
    throw new Error(`Settlement order ${orderId} missing cake metadata`)
  }

  const { cakeOrderId, appliedTo } = metadata
  const amount = Number(order.total)

  if (isNaN(amount) || amount <= 0) {
    throw new Error(`Settlement order ${orderId} has invalid total: ${order.total}`)
  }

  // Determine payment method from the POS payment
  const paymentRows = await db.$queryRawUnsafe<Array<{ paymentMethod: string }>>(
    `SELECT "paymentMethod" FROM "Payment" WHERE "id" = $1`,
    paymentId,
  )
  const method = paymentRows?.[0]?.paymentMethod || 'card'

  // Record the CakePayment
  const { cakePaymentId } = await recordCakePayment(db, {
    cakeOrderId,
    type: 'payment',
    appliedTo,
    paymentSource: 'pos',
    amount,
    method,
    posPaymentId: paymentId,
    posOrderId: orderId,
    processedBy: employeeId,
  })

  // Update posSettlementOrderIds JSONB cache on CakeOrder
  await db.$executeRawUnsafe(`
    UPDATE "CakeOrder"
    SET "posSettlementOrderIds" = COALESCE("posSettlementOrderIds", '[]'::jsonb) || $1::jsonb,
        "updatedAt" = NOW()
    WHERE "id" = $2
  `,
    JSON.stringify([orderId]),
    cakeOrderId,
  )

  // Emit socket event for cake dashboard updates
  void emitToLocation(locationId, 'cake:settlement-completed', {
    cakeOrderId,
    cakePaymentId,
    orderId,
    paymentId,
    appliedTo,
    amount,
  }).catch(err => console.error('[cake-payment] Settlement socket emit failed:', err))

  console.log(
    `[cake-payment] Settlement completed: cake=${cakeOrderId} order=${orderId} ` +
    `payment=${paymentId} appliedTo=${appliedTo} amount=$${amount.toFixed(2)}`
  )
}

// ─── Text-to-Pay ────────────────────────────────────────────────────────────

/**
 * Create a text-to-pay request for a cake deposit/balance.
 * Creates settlement order -> calls existing payment-link system -> sends SMS.
 * Supersedes any existing pending PaymentLinks for the same (cakeOrderId, appliedTo).
 */
export async function requestCakePaymentViaText(
  db: DbClient,
  params: {
    cakeOrderId: string
    amount: number
    appliedTo: 'deposit' | 'balance'
    employeeId: string
    locationId: string
    customerPhone: string
  }
): Promise<{ paymentLinkToken: string; settlementOrderId: string }> {
  const { cakeOrderId, amount, appliedTo, employeeId, locationId, customerPhone } = params

  if (amount <= 0) {
    throw new Error('Payment amount must be positive')
  }

  // Fetch the cake order
  const cakeRows = await db.$queryRawUnsafe<Array<{
    id: string
    orderNumber: number
    customerId: string
    locationId: string
    status: string
  }>>(
    `SELECT "id", "orderNumber", "customerId", "locationId", "status"
     FROM "CakeOrder"
     WHERE "id" = $1 AND "locationId" = $2`,
    cakeOrderId,
    locationId,
  )

  if (!cakeRows || cakeRows.length === 0) {
    throw new Error(`CakeOrder ${cakeOrderId} not found`)
  }

  const cakeOrder = cakeRows[0]

  // Validate order is in a payable status
  const payableStatuses = ['approved', 'deposit_paid', 'in_production', 'ready', 'delivered']
  if (!payableStatuses.includes(cakeOrder.status)) {
    throw new Error(`CakeOrder ${cakeOrderId} is in status '${cakeOrder.status}' which does not accept payments`)
  }

  // Cancel any existing pending PaymentLinks for this cake order + appliedTo
  await db.$executeRawUnsafe(`
    UPDATE "PaymentLink"
    SET "status" = 'cancelled', "updatedAt" = NOW()
    WHERE "orderId" IN (
      SELECT "id" FROM "Order"
      WHERE "metadata"->>'cakeOrderId' = $1
      AND "metadata"->>'appliedTo' = $2
    )
    AND "status" = 'pending'
  `,
    cakeOrderId,
    appliedTo,
  )

  // Create the settlement order
  const { orderId: settlementOrderId } = await createSettlementOrder(db, {
    cakeOrderId,
    cakeOrderNumber: cakeOrder.orderNumber,
    customerId: cakeOrder.customerId,
    locationId,
    employeeId,
    amount,
    appliedTo,
  })

  // Get location settings for text-to-pay config
  const location = await db.location.findFirst({
    where: { id: locationId },
    select: { name: true, settings: true },
  })

  if (!location) {
    throw new Error('Location not found')
  }

  const settings = parseSettings(location.settings)
  const textToPaySettings: TextToPaySettings = settings.textToPay
    ? { ...DEFAULT_TEXT_TO_PAY, ...settings.textToPay }
    : DEFAULT_TEXT_TO_PAY

  // Generate secure token
  const token = crypto.randomUUID()
  const expMinutes = textToPaySettings.defaultExpirationMinutes || 60
  const expiresAt = new Date(Date.now() + expMinutes * 60 * 1000)

  // Create PaymentLink record pointing to the settlement order
  await db.$executeRawUnsafe(`
    INSERT INTO "PaymentLink" (
      "id", "locationId", "orderId", "token", "amount", "status",
      "expiresAt", "phoneNumber", "createdByEmployeeId",
      "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, $1, $2, $3, $4, 'pending',
      $5, $6, $7,
      NOW(), NOW()
    )
  `,
    locationId,
    settlementOrderId,
    token,
    amount,
    expiresAt,
    customerPhone,
    employeeId,
  )

  // Build payment URL and send SMS
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3006'
  const payUrl = `${baseUrl}/pay/${token}`

  const label = appliedTo === 'deposit' ? 'deposit' : 'balance'
  const smsBody = textToPaySettings.smsTemplate
    ? textToPaySettings.smsTemplate
        .replace('{venue}', location.name)
        .replace('{link}', payUrl)
        .replace('{amount}', `$${amount.toFixed(2)}`)
    : `${location.name}: Pay your cake ${label} of $${amount.toFixed(2)} here: ${payUrl}`

  void sendSMS({
    to: customerPhone,
    body: smsBody,
  }).catch(err => console.error('[cake-payment] Text-to-pay SMS failed:', err))

  // Audit log
  void db.auditLog.create({
    data: {
      locationId,
      employeeId,
      action: 'cake_text_to_pay_sent',
      entityType: 'CakeOrder',
      entityId: cakeOrderId,
      details: {
        settlementOrderId,
        token,
        amount,
        appliedTo,
        customerPhone: customerPhone.slice(-4), // last 4 only for PII safety
      },
    },
  }).catch(err => console.error('[cake-payment] Audit log failed:', err))

  // Record change in CakeOrderChange
  const changeId = crypto.randomUUID()
  await db.$executeRawUnsafe(`
    INSERT INTO "CakeOrderChange" (
      "id", "cakeOrderId", "changeType", "changedBy", "source",
      "details", "createdAt"
    ) VALUES (
      $1, $2, 'payment_recorded', $3, 'system',
      $4::jsonb, NOW()
    )
  `,
    changeId,
    cakeOrderId,
    employeeId,
    JSON.stringify({
      action: 'text_to_pay_sent',
      appliedTo,
      amount,
      settlementOrderId,
    }),
  )

  return { paymentLinkToken: token, settlementOrderId }
}

// ─── Financial Verification ─────────────────────────────────────────────────

/**
 * Recalculate and return current financial state from CakePayment ledger.
 * This is for verification only -- the PG trigger handles actual column updates.
 *
 * Sums all payments and refunds grouped by appliedTo bucket.
 * Returns depositPaid, balancePaid, and remaining balanceDue.
 */
export async function verifyCakeFinancials(
  db: DbClient,
  cakeOrderId: string
): Promise<{ depositPaid: number; balancePaid: number; balanceDue: number }> {
  // Validate the cake order exists and fetch the total
  const orderRows = await db.$queryRawUnsafe<Array<{
    id: string
    totalAfterTax: string | number
    depositRequired: string | number
  }>>(
    `SELECT "id",
            ("pricingInputs"->>'totalAfterTax')::numeric AS "totalAfterTax",
            ("pricingInputs"->>'depositRequired')::numeric AS "depositRequired"
     FROM "CakeOrder"
     WHERE "id" = $1`,
    cakeOrderId,
  )

  if (!orderRows || orderRows.length === 0) {
    throw new Error(`CakeOrder ${cakeOrderId} not found`)
  }

  const totalAfterTax = Number(orderRows[0].totalAfterTax) || 0

  // Aggregate all CakePayments by appliedTo
  const paymentRows = await db.$queryRawUnsafe<Array<{
    appliedTo: string
    netAmount: string | number
  }>>(
    `SELECT
       "appliedTo",
       SUM(
         CASE
           WHEN "type" = 'payment' THEN "amount"
           WHEN "type" = 'refund' THEN -"amount"
           WHEN "type" = 'forfeit' THEN "amount"
           ELSE 0
         END
       ) AS "netAmount"
     FROM "CakePayment"
     WHERE "cakeOrderId" = $1
     GROUP BY "appliedTo"`,
    cakeOrderId,
  )

  let depositPaid = 0
  let balancePaid = 0

  for (const row of paymentRows) {
    const net = Number(row.netAmount) || 0
    if (row.appliedTo === 'deposit') {
      depositPaid = Math.round(net * 100) / 100
    } else if (row.appliedTo === 'balance') {
      balancePaid = Math.round(net * 100) / 100
    }
  }

  const totalPaid = depositPaid + balancePaid
  const balanceDue = Math.round((totalAfterTax - totalPaid) * 100) / 100

  return {
    depositPaid,
    balancePaid,
    balanceDue: Math.max(0, balanceDue),
  }
}
