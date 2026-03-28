/**
 * POST /api/cake-orders/[id]/quote — Create a quote for a cake order
 *
 * Permission: cake.quote
 *
 * Assembles PricingInputsV1 from the order's adminCurrent snapshot,
 * generates customer-facing line items, auto-voids any existing active quotes,
 * inserts a new CakeQuote with version bump, and transitions order to 'quoted'.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { parseSettings, DEFAULT_CAKE_ORDERING } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { dispatchCakeOrderUpdated } from '@/lib/socket-dispatch'
import { createQuoteSchema, parseCakeConfig, parseDesignConfig, parseDietaryConfig } from '@/lib/cake-orders/schemas'
import { assembleQuote, generateQuoteLineItems } from '@/lib/cake-orders/cake-quote-service'
import type { PricingInputsV1 } from '@/lib/cake-orders/schemas'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'
import { ok } from '@/lib/api-response'

export const POST = withVenue(async function POST(
  request: NextRequest,
  context: any,
) {
  try {
    const { id: cakeOrderId } = (await context.params) as { id: string }
    const body = await request.json()

    // ── Validate input ──────────────────────────────────────────────────
    const parsed = createQuoteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      )
    }
    const input = parsed.data

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
    const auth = await requirePermission(employeeId, locationId, 'cake.quote')
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Feature gate ────────────────────────────────────────────────────
    const gate = await requireCakeFeature(locationId)
    if (gate) return gate

    // ── Fetch the cake order ────────────────────────────────────────────
    const orderRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CakeOrder"
       WHERE "id" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL`,
      cakeOrderId,
      locationId,
    )

    if (!orderRows || orderRows.length === 0) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: `CakeOrder ${cakeOrderId} not found` },
        { status: 404 },
      )
    }

    const cakeOrder = orderRows[0]
    const currentStatus = cakeOrder.status as string

    // Only allow quoting from submitted / under_review / quoted (re-quote)
    const quotableStatuses = ['submitted', 'under_review', 'quoted']
    if (!quotableStatuses.includes(currentStatus)) {
      return NextResponse.json(
        { code: 'INVALID_STATUS', message: `Cannot create a quote when order is in status '${currentStatus}'` },
        { status: 409 },
      )
    }

    // ── Parse order configs ─────────────────────────────────────────────
    const cakeConfig = parseCakeConfig(cakeOrder.cakeConfig)
    const designConfig = parseDesignConfig(cakeOrder.designConfig)
    const dietaryConfig = parseDietaryConfig(cakeOrder.dietaryConfig)

    // ── Load location settings + tax rate ───────────────────────────────
    const locSettings = parseSettings(await getLocationSettings(locationId))
    const cakeSettings = locSettings.cakeOrdering
      ? { ...DEFAULT_CAKE_ORDERING, ...locSettings.cakeOrdering }
      : DEFAULT_CAKE_ORDERING

    // Sum non-inclusive tax rules for tax rate
    const taxRules = await db.taxRule.findMany({
      where: { locationId, isActive: true, isInclusive: false, deletedAt: null },
      select: { rate: true, name: true },
    })
    const taxRate = taxRules.reduce((sum: number, r: { rate: any }) => sum + Number(r.rate), 0)
    const taxJurisdiction = taxRules.map((r: { name: string }) => r.name).join(' + ') || 'Default'

    // ── Assemble pricing ────────────────────────────────────────────────
    let pricingInputs: PricingInputsV1 = assembleQuote({
      cakeOrder: {
        cakeConfig,
        designConfig,
        dietaryConfig,
        deliveryType: (cakeOrder.deliveryType as string) || 'pickup',
        deliveryMiles: cakeOrder.deliveryMiles != null ? Number(cakeOrder.deliveryMiles) : null,
      },
      settings: {
        rushFeeAmount: cakeSettings.rushFeeAmount,
        rushFeeDays: cakeSettings.rushFeeDays,
        setupFeeAmount: cakeSettings.setupFeeAmount,
        deliveryFixedFee: cakeSettings.deliveryFixedFee,
        deliveryFeePerMile: cakeSettings.deliveryFeePerMile,
        depositPercent: cakeSettings.depositPercent,
        deliveryFeeTaxable: cakeSettings.deliveryFeeTaxable,
      },
      taxRate,
      taxJurisdiction,
      eventDate: new Date(cakeOrder.eventDate as string),
    })

    // Apply admin discount override if provided
    if (input.discountAmount && input.discountAmount > 0) {
      const discountAmount = Math.round(input.discountAmount * 100) / 100
      const taxableBase = Math.max(0, pricingInputs.taxableBase - discountAmount)
      const taxTotal = Math.round((taxableBase * taxRate + Number.EPSILON) * 100) / 100
      const totalBeforeTax = pricingInputs.totalBeforeTax - discountAmount
      const totalAfterTax = Math.round((totalBeforeTax + taxTotal + Number.EPSILON) * 100) / 100
      const depositRequired = Math.round((totalAfterTax * cakeSettings.depositPercent / 100 + Number.EPSILON) * 100) / 100

      pricingInputs = {
        ...pricingInputs,
        discountAmount,
        discountReason: input.discountReason ?? null,
        taxableBase,
        taxTotal,
        totalBeforeTax: Math.round((totalBeforeTax + Number.EPSILON) * 100) / 100,
        totalAfterTax,
        depositRequired,
      }
    }

    // ── Generate line items ─────────────────────────────────────────────
    const lineItems = generateQuoteLineItems(pricingInputs, cakeConfig, designConfig)

    // ── Auto-void existing active quotes ────────────────────────────────
    await db.$executeRawUnsafe(
      `UPDATE "CakeQuote"
       SET "status" = 'voided', "voidedAt" = NOW(), "updatedAt" = NOW()
       WHERE "cakeOrderId" = $1
         AND "status" NOT IN ('voided', 'expired')`,
      cakeOrderId,
    )

    // ── Determine next version ──────────────────────────────────────────
    const versionRows = await db.$queryRawUnsafe<[{ max_version: number | null }]>(
      `SELECT MAX("version") as max_version FROM "CakeQuote" WHERE "cakeOrderId" = $1`,
      cakeOrderId,
    )
    const nextVersion = (versionRows[0]?.max_version ?? 0) + 1

    // ── Cancellation policy snapshot ────────────────────────────────────
    const cancellationPolicySnapshot = JSON.stringify({
      forfeitDaysBeforeSnapshot: cakeSettings.forfeitDaysBefore,
      depositForfeitPercentSnapshot: cakeSettings.depositForfeitPercent,
      lateCancelPolicyTextSnapshot: cakeSettings.lateCancelPolicyText,
    })

    // ── Insert CakeQuote ────────────────────────────────────────────────
    const quoteId = crypto.randomUUID()

    await db.$executeRawUnsafe(
      `INSERT INTO "CakeQuote" (
        "id", "cakeOrderId", "version", "status",
        "lineItems", "pricingInputsSnapshot",
        "subtotal", "taxTotal", "totalBeforeTax", "totalAfterTax",
        "depositRequired", "discountAmount", "discountReason",
        "validUntilDate", "cancellationPolicySnapshot",
        "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'sent',
        $4::jsonb, $5::jsonb,
        $6, $7, $8, $9,
        $10, $11, $12,
        $13::date, $14::jsonb,
        $15, NOW(), NOW()
      )`,
      quoteId,
      cakeOrderId,
      nextVersion,
      JSON.stringify(lineItems),
      JSON.stringify(pricingInputs),
      pricingInputs.subtotal,
      pricingInputs.taxTotal,
      pricingInputs.totalBeforeTax,
      pricingInputs.totalAfterTax,
      pricingInputs.depositRequired,
      pricingInputs.discountAmount,
      pricingInputs.discountReason || null,
      input.validUntilDate,
      cancellationPolicySnapshot,
      auth.employee.id,
    )

    // ── Update CakeOrder pricing + status ───────────────────────────────
    const shouldTransition = ['submitted', 'under_review'].includes(currentStatus)

    if (shouldTransition) {
      await db.$executeRawUnsafe(
        `UPDATE "CakeOrder"
         SET "pricingInputs" = $1::jsonb,
             "status" = 'quoted',
             "quotedAt" = NOW(),
             "updatedAt" = NOW()
         WHERE "id" = $2`,
        JSON.stringify(pricingInputs),
        cakeOrderId,
      )
    } else {
      // Re-quoting: update pricing but status is already 'quoted'
      await db.$executeRawUnsafe(
        `UPDATE "CakeOrder"
         SET "pricingInputs" = $1::jsonb,
             "updatedAt" = NOW()
         WHERE "id" = $2`,
        JSON.stringify(pricingInputs),
        cakeOrderId,
      )
    }

    // ── Audit trail ─────────────────────────────────────────────────────
    const changeId = crypto.randomUUID()
    await db.$executeRawUnsafe(
      `INSERT INTO "CakeOrderChange" (
        "id", "cakeOrderId", "changeType", "changedBy", "source",
        "details", "createdAt"
      ) VALUES (
        $1, $2, 'quote_created', $3, 'admin',
        $4::jsonb, NOW()
      )`,
      changeId,
      cakeOrderId,
      auth.employee.id,
      JSON.stringify({
        quoteId,
        version: nextVersion,
        totalAfterTax: pricingInputs.totalAfterTax,
        depositRequired: pricingInputs.depositRequired,
        validUntilDate: input.validUntilDate,
        previousStatus: currentStatus,
        newStatus: shouldTransition ? 'quoted' : currentStatus,
      }),
    )

    pushUpstream()

    // ── Socket event ────────────────────────────────────────────────────
    void dispatchCakeOrderUpdated(locationId, {
      cakeOrderId,
      status: shouldTransition ? 'quoted' : currentStatus,
      changeType: 'quote_created',
    }).catch(err => console.error('[cake-quote] Socket dispatch failed:', err))

    // ── Return created quote ────────────────────────────────────────────
    return ok({
        id: quoteId,
        cakeOrderId,
        version: nextVersion,
        status: 'sent',
        lineItems,
        pricingInputsSnapshot: pricingInputs,
        subtotal: pricingInputs.subtotal,
        taxTotal: pricingInputs.taxTotal,
        totalBeforeTax: pricingInputs.totalBeforeTax,
        totalAfterTax: pricingInputs.totalAfterTax,
        depositRequired: pricingInputs.depositRequired,
        discountAmount: pricingInputs.discountAmount,
        discountReason: pricingInputs.discountReason,
        validUntilDate: input.validUntilDate,
        createdBy: auth.employee.id,
      })
  } catch (error) {
    console.error('[cake-quote] Failed to create quote:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Failed to create quote' },
      { status: 500 },
    )
  }
})
