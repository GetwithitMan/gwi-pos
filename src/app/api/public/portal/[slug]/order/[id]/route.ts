/**
 * GET /api/public/portal/[slug]/order/[id] — View a single cake order
 *
 * Token-authenticated via ?token= query param (HMAC-signed order view link).
 * Returns safe customer-facing fields only (no internal notes, no POS IDs).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { verifyOrderViewToken } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug, id } = (await context.params) as { slug: string; id: string }

    if (!slug) {
      return NextResponse.json({ error: 'Venue slug is required' }, { status: 400 })
    }
    if (!id) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
    }

    // ── Validate token ─────────────────────────────────────────────
    const token = request.nextUrl.searchParams.get('token')
    if (!token) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 403 })
    }

    const tokenResult = verifyOrderViewToken(token)
    if (!tokenResult.valid && tokenResult.expired) {
      return NextResponse.json(
        { error: 'This link has expired. Please request a new one.' },
        { status: 410 },
      )
    }
    if (!tokenResult.valid) {
      return NextResponse.json({ error: 'Invalid access token' }, { status: 403 })
    }

    // ── Resolve venue DB ───────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── Get location ─────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── Fetch CakeOrder ────────────────────────────────────────────
    const orders = await venueDb.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
        "id", "orderNumber", "status", "eventDate", "eventType", "guestCount",
        "cakeConfig", "designConfig", "deliveryType", "notes",
        "total", "depositRequired", "depositPaid", "balanceDue",
        "createdAt", "cancelledAt", "cancelReason", "customerId"
      FROM "CakeOrder"
      WHERE "id" = $1
        AND "customerId" = $2
        AND "deletedAt" IS NULL
      LIMIT 1`,
      id,
      tokenResult.customerId,
    )

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const order = orders[0]

    // ── Cancelled order — return minimal info ──────────────────────
    if (order.status === 'cancelled') {
      return NextResponse.json({
        id: order.id,
        orderNumber: Number(order.orderNumber),
        status: 'cancelled',
        cancelledAt: order.cancelledAt,
        cancelReason: order.cancelReason,
        message: 'This order has been cancelled.',
      })
    }

    // ── Build tiers summary from cakeConfig ────────────────────────
    const cakeConfig = order.cakeConfig as Record<string, unknown> | null
    let tiersSummary: Array<Record<string, unknown>> | null = null
    if (cakeConfig && Array.isArray(cakeConfig.tiers)) {
      tiersSummary = (cakeConfig.tiers as Array<Record<string, unknown>>).map((tier) => ({
        shape: tier.shape,
        size: tier.size,
        servings: tier.servings,
        flavor: tier.flavor,
        filling: tier.filling,
        frosting: tier.frosting,
      }))
    }

    // ── Build design summary from designConfig ─────────────────────
    const designConfig = order.designConfig as Record<string, unknown> | null
    let designSummary: Record<string, unknown> | null = null
    if (designConfig) {
      designSummary = {
        decorations: designConfig.decorations ?? null,
        message: designConfig.message ?? designConfig.inscriptionText ?? null,
        theme: designConfig.theme ?? null,
        colors: designConfig.colors ?? null,
      }
    }

    // ── Fetch latest CakeQuote if status warrants ──────────────────
    let quote: Record<string, unknown> | null = null
    const quoteStatuses = ['quoted', 'approved', 'deposit_paid', 'in_production', 'ready', 'delivered', 'completed']
    if (quoteStatuses.includes(order.status as string)) {
      const quotes = await venueDb.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT
          "id", "version", "status", "lineItems", "total", "depositAmount",
          "validUntilDate", "sentAt", "approvedAt"
        FROM "CakeQuote"
        WHERE "cakeOrderId" = $1
          AND "status" IN ('sent', 'approved')
        ORDER BY "version" DESC
        LIMIT 1`,
        id,
      )

      if (quotes.length > 0) {
        const q = quotes[0]
        quote = {
          id: q.id,
          version: Number(q.version),
          status: q.status,
          lineItems: q.lineItems,
          total: Number(q.total),
          depositRequired: Number(q.depositAmount),
          validUntilDate: q.validUntilDate,
          sentAt: q.sentAt,
          approvedAt: q.approvedAt,
        }
      }
    }

    // ── Fetch CakePayments (safe fields only) ──────────────────────
    const payments = await venueDb.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
        "amount", "type", "appliedTo", "processedAt"
      FROM "CakePayment"
      WHERE "cakeOrderId" = $1
      ORDER BY "processedAt" ASC`,
      id,
    )

    const safePayments = payments.map((p) => ({
      amount: Number(p.amount),
      type: p.type,
      appliedTo: p.appliedTo,
      processedAt: p.processedAt,
    }))

    // ── Build response ─────────────────────────────────────────────
    return NextResponse.json({
      id: order.id,
      orderNumber: Number(order.orderNumber),
      status: order.status,
      eventDate: order.eventDate,
      eventType: order.eventType,
      guestCount: order.guestCount ? Number(order.guestCount) : null,
      cakeConfig: tiersSummary ? { tiers: tiersSummary } : null,
      designConfig: designSummary,
      deliveryType: order.deliveryType,
      notes: order.notes,
      createdAt: order.createdAt,
      quote,
      payments: safePayments,
      depositPaid: Number(order.depositPaid),
      balanceDue: Number(order.balanceDue),
    })
  } catch (error) {
    console.error('[GET /api/public/portal/[slug]/order/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 })
  }
}
