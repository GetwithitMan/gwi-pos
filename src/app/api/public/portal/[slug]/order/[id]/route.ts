/**
 * GET /api/public/portal/[slug]/order/[id] — View a single cake order
 *
 * Token-authenticated via ?token= query param (HMAC-signed order view link).
 * Returns safe customer-facing fields only (no internal notes, no POS IDs).
 */

import { NextRequest } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { verifyOrderViewToken } from '@/lib/portal-auth'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug, id } = (await context.params) as { slug: string; id: string }

    if (!slug) {
      return err('Venue slug is required')
    }
    if (!id) {
      return err('Order ID is required')
    }

    // ── Validate token ─────────────────────────────────────────────
    const token = request.nextUrl.searchParams.get('token')
    if (!token) {
      return forbidden('Access token is required')
    }

    const tokenResult = verifyOrderViewToken(token)
    if (!tokenResult.valid && tokenResult.expired) {
      return err('This link has expired. Please request a new one.', 410)
    }
    if (!tokenResult.valid) {
      return forbidden('Invalid access token')
    }

    // ── Resolve venue DB ───────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return notFound('Location not found')
    }

    // ── Get location ─────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true },
    })

    if (!location) {
      return notFound('Location not found')
    }

    // ── Fetch CakeOrder ────────────────────────────────────────────
    const orders = await venueDb.$queryRaw<Array<Record<string, unknown>>>`SELECT
        "id", "orderNumber", "status", "eventDate", "eventType", "guestCount",
        "cakeConfig", "designConfig", "deliveryType", "notes",
        "total", "depositRequired", "depositPaid", "balanceDue",
        "createdAt", "cancelledAt", "cancelReason", "customerId"
      FROM "CakeOrder"
      WHERE "id" = ${id}
        AND "customerId" = ${tokenResult.customerId}
        AND "deletedAt" IS NULL
      LIMIT 1`

    if (orders.length === 0) {
      return notFound('Order not found')
    }

    const order = orders[0]

    // ── Cancelled order — return minimal info ──────────────────────
    if (order.status === 'cancelled') {
      return ok({
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
      const quotes = await venueDb.$queryRaw<Array<Record<string, unknown>>>`SELECT
          "id", "version", "status", "lineItems", "total", "depositAmount",
          "validUntilDate", "sentAt", "approvedAt"
        FROM "CakeQuote"
        WHERE "cakeOrderId" = ${id}
          AND "status" IN ('sent', 'approved')
        ORDER BY "version" DESC
        LIMIT 1`

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
    const payments = await venueDb.$queryRaw<Array<Record<string, unknown>>>`SELECT
        "amount", "type", "appliedTo", "processedAt"
      FROM "CakePayment"
      WHERE "cakeOrderId" = ${id}
      ORDER BY "processedAt" ASC`

    const safePayments = payments.map((p) => ({
      amount: Number(p.amount),
      type: p.type,
      appliedTo: p.appliedTo,
      processedAt: p.processedAt,
    }))

    // ── Build response ─────────────────────────────────────────────
    return ok({
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
    return err('Failed to fetch order', 500)
  }
}
