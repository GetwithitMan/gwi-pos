/**
 * PATCH /api/cake-orders/[id]/quote/[qid]/approve — Approve a cake quote
 *
 * Permission: cake.quote_approve
 *
 * Validates stale-read protection (expectedUpdatedAt), checks quote hasn't
 * expired, approves the quote, transitions the CakeOrder to 'approved',
 * and copies financial columns from the quote to the order.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { dispatchCakeOrderUpdated } from '@/lib/socket-dispatch'
import { approveQuoteSchema } from '@/lib/cake-orders/schemas'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'

export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  context: any,
) {
  try {
    const { id: cakeOrderId, qid: quoteId } = (await context.params) as { id: string; qid: string }
    const body = await request.json()

    // ── Validate input ──────────────────────────────────────────────────
    const parsed = approveQuoteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      )
    }
    const { expectedUpdatedAt } = parsed.data

    // ── Resolve actor ───────────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || (body.employeeId as string | undefined)
    const locationId = actor.locationId || (body.locationId as string | undefined)

    if (!locationId) {
      return NextResponse.json(
        { code: 'MISSING_LOCATION', message: 'locationId is required' },
        { status: 400 },
      )
    }

    // ── Permission check ────────────────────────────────────────────────
    const auth = await requirePermission(employeeId, locationId, 'cake.quote_approve')
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Feature gate ────────────────────────────────────────────────────
    const gate = await requireCakeFeature(locationId)
    if (gate) return gate

    // ── Fetch the quote ─────────────────────────────────────────────────
    const quoteRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT q.*, co."locationId" AS "orderLocationId", co."status" AS "orderStatus"
       FROM "CakeQuote" q
       JOIN "CakeOrder" co ON co."id" = q."cakeOrderId"
       WHERE q."id" = $1 AND q."cakeOrderId" = $2 AND co."locationId" = $3`,
      quoteId,
      cakeOrderId,
      locationId,
    )

    if (!quoteRows || quoteRows.length === 0) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: `CakeQuote ${quoteId} not found for order ${cakeOrderId}` },
        { status: 404 },
      )
    }

    const quote = quoteRows[0]

    // ── Stale-read protection ───────────────────────────────────────────
    const quoteUpdatedAt = quote.updatedAt instanceof Date
      ? quote.updatedAt.toISOString()
      : String(quote.updatedAt)

    if (quoteUpdatedAt !== expectedUpdatedAt) {
      return NextResponse.json(
        {
          code: 'STALE_QUOTE',
          message: 'Quote has been modified since you last loaded it. Refresh and try again.',
          serverUpdatedAt: quoteUpdatedAt,
        },
        { status: 409 },
      )
    }

    // ── Status check ────────────────────────────────────────────────────
    const quoteStatus = quote.status as string
    if (quoteStatus !== 'sent') {
      return NextResponse.json(
        {
          code: 'INVALID_STATUS',
          message: `Cannot approve a quote with status '${quoteStatus}'. Only 'sent' quotes can be approved.`,
        },
        { status: 409 },
      )
    }

    // ── Expiry check ────────────────────────────────────────────────────
    const validUntilDate = quote.validUntilDate
      ? new Date(quote.validUntilDate as string)
      : null

    if (validUntilDate) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (validUntilDate < today) {
        // Auto-expire the quote
        await db.$executeRawUnsafe(
          `UPDATE "CakeQuote"
           SET "status" = 'expired', "updatedAt" = NOW()
           WHERE "id" = $1`,
          quoteId,
        )
        return NextResponse.json(
          {
            code: 'QUOTE_EXPIRED',
            message: `Quote expired on ${validUntilDate.toISOString().split('T')[0]}. Create a new quote.`,
          },
          { status: 410 },
        )
      }
    }

    // ── Parse financial data from quote snapshot ────────────────────────
    const pricingSnapshot = typeof quote.pricingInputsSnapshot === 'string'
      ? JSON.parse(quote.pricingInputsSnapshot as string)
      : quote.pricingInputsSnapshot

    const totalAfterTax = Number(quote.totalAfterTax ?? pricingSnapshot?.totalAfterTax ?? 0)
    const depositRequired = Number(quote.depositRequired ?? pricingSnapshot?.depositRequired ?? 0)
    const taxTotal = Number(quote.taxTotal ?? pricingSnapshot?.taxTotal ?? 0)
    const subtotal = Number(quote.subtotal ?? pricingSnapshot?.subtotal ?? 0)

    // ── Approve the quote ───────────────────────────────────────────────
    await db.$executeRawUnsafe(
      `UPDATE "CakeQuote"
       SET "status" = 'approved', "approvedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = $1`,
      quoteId,
    )

    // ── Transition CakeOrder to approved ────────────────────────────────
    await db.$executeRawUnsafe(
      `UPDATE "CakeOrder"
       SET "status" = 'approved',
           "approvedAt" = NOW(),
           "totalAfterTax" = $1,
           "depositRequired" = $2,
           "taxTotal" = $3,
           "subtotal" = $4,
           "pricingInputs" = COALESCE($5::jsonb, "pricingInputs"),
           "updatedAt" = NOW()
       WHERE "id" = $6`,
      totalAfterTax,
      depositRequired,
      taxTotal,
      subtotal,
      pricingSnapshot ? JSON.stringify(pricingSnapshot) : null,
      cakeOrderId,
    )

    // ── Audit trail ─────────────────────────────────────────────────────
    const changeId = crypto.randomUUID()
    await db.$executeRawUnsafe(
      `INSERT INTO "CakeOrderChange" (
        "id", "cakeOrderId", "changeType", "changedBy", "source",
        "details", "createdAt"
      ) VALUES (
        $1, $2, 'quote_approved', $3, 'admin',
        $4::jsonb, NOW()
      )`,
      changeId,
      cakeOrderId,
      auth.employee.id,
      JSON.stringify({
        quoteId,
        version: Number(quote.version),
        totalAfterTax,
        depositRequired,
        taxTotal,
        previousOrderStatus: quote.orderStatus,
      }),
    )

    pushUpstream()

    // ── Socket event ────────────────────────────────────────────────────
    void dispatchCakeOrderUpdated(locationId, {
      cakeOrderId,
      status: 'approved',
      changeType: 'quote_approved',
    }).catch(err => console.error('[cake-quote-approve] Socket dispatch failed:', err))

    // ── Return approved quote ───────────────────────────────────────────
    return NextResponse.json({
      data: {
        id: quoteId,
        cakeOrderId,
        version: Number(quote.version),
        status: 'approved',
        approvedAt: new Date().toISOString(),
        totalAfterTax,
        depositRequired,
        taxTotal,
        subtotal,
      },
    })
  } catch (error) {
    console.error('[cake-quote-approve] Failed to approve quote:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to approve quote' },
      { status: 500 },
    )
  }
})
