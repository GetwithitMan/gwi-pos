/**
 * View-specific order query shapes.
 *
 * Each function returns a targeted Prisma select for its view,
 * minimising data transfer and serialisation overhead.
 */
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { mapOrderForResponse } from '@/lib/api/order-response-mapper'
import { ORDER_ITEM_FULL_INCLUDE, mapOrderItemForWire } from '@/lib/domain/order-items'
import { roundToCents } from '@/lib/pricing'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings, getPricingProgram } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { apiError, ERROR_CODES } from '@/lib/api/error-responses'
import { getRequestLocationId } from '@/lib/request-context'
import { ok, err } from '@/lib/api-response'

// ---------------------------------------------------------------------------
// Shared dual-pricing helper (used by panel + full views)
// ---------------------------------------------------------------------------

interface DualPricingResult {
  cashTotal: number
  cardTotal: number
  debitTotal: number
  creditMarkupPercent: number
  debitMarkupPercent: number
  /** @deprecated Use creditMarkupPercent */
  cashDiscountPercent: number
}

export async function computeDualPricing(
  locationId: string,
  orderTotal: number,
  orderSubtotal: number,
  orderDiscountTotal: number,
  taxFromInclusive: number,
  taxFromExclusive: number,
  tipTotal: number = 0,
): Promise<DualPricingResult> {
  let cashTotal = orderTotal
  let cardTotal = orderTotal
  let debitTotal = orderTotal
  let creditMarkupPercent = 0
  let debitMarkupPercent = 0

  try {
    const locSettings = await getLocationSettings(locationId)
    const parsed = parseSettings(locSettings as Record<string, unknown>)
    const pp = getPricingProgram(parsed)
    if (pp.enabled) {
      creditMarkupPercent = pp.creditMarkupPercent ?? pp.cashDiscountPercent ?? 4.0
      debitMarkupPercent = pp.debitMarkupPercent ?? 0
      const sub = orderSubtotal
      const disc = orderDiscountTotal
      const discountedCashSub = Math.max(0, sub - disc)
      // Surcharge on full subtotal (pre-discount, pre-tax) per CANONICAL-MONEY-SPEC
      const creditSurcharge = roundToCents(sub * creditMarkupPercent / 100)
      const debitSurcharge = debitMarkupPercent > 0 ? roundToCents(sub * debitMarkupPercent / 100) : 0
      // Tax is NOT marked up (DP1 rule) — use stored tax values directly
      const storedTax = taxFromInclusive + taxFromExclusive
      cashTotal = roundToCents(discountedCashSub + storedTax + tipTotal)
      cardTotal = roundToCents(discountedCashSub + creditSurcharge + storedTax + tipTotal)
      debitTotal = debitMarkupPercent > 0
        ? roundToCents(discountedCashSub + debitSurcharge + storedTax + tipTotal)
        : cashTotal
    }
  } catch {
    // Settings unavailable — fall back to order.total for all tiers
  }

  return { cashTotal, cardTotal, debitTotal, creditMarkupPercent, debitMarkupPercent, cashDiscountPercent: creditMarkupPercent }
}

// ---------------------------------------------------------------------------
// Resolve locationId — fast path from request context, fallback from DB
// ---------------------------------------------------------------------------

async function resolveLocationId(orderId: string): Promise<string | null> {
  const fromCtx = getRequestLocationId()
  if (fromCtx) return fromCtx

  // eslint-disable-next-line no-restricted-syntax
  const row = await db.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { locationId: true },
  })
  return row?.locationId ?? null
}

// ---------------------------------------------------------------------------
// view=split  (items + modifiers + totals — no payments, tips, entertainment)
// ---------------------------------------------------------------------------

export async function getOrderForSplit(orderId: string) {
  // eslint-disable-next-line no-restricted-syntax
  const order = await db.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true, orderNumber: true, status: true, orderType: true,
      subtotal: true, taxTotal: true, total: true, discountTotal: true,
      tabName: true, tableId: true, employeeId: true, locationId: true, guestCount: true,
      baseSeatCount: true, extraSeatCount: true, notes: true,
      parentOrderId: true,
      createdAt: true, updatedAt: true,
      employee: { select: { id: true, displayName: true } },
      table: { select: { id: true, name: true } },
      items: {
        where: { deletedAt: null },
        include: {
          modifiers: {
            where: { deletedAt: null },
            select: {
              id: true, modifierId: true, name: true, price: true,
              depth: true, preModifier: true, linkedMenuItemId: true,
            },
          },
          ingredientModifications: true,
        },
      },
    },
  })

  if (!order) {
    return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
  }

  const response = mapOrderForResponse(order)
  return ok({ ...response, paidAmount: 0 })
}

// ---------------------------------------------------------------------------
// view=panel  (items + modifiers + discounts — no payments, pizzaData, ingredientModifications)
// ---------------------------------------------------------------------------

export async function getOrderForPanel(orderId: string) {
  // eslint-disable-next-line no-restricted-syntax
  const order = await db.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      guestCount: true,
      subtotal: true,
      taxTotal: true,
      taxFromInclusive: true,
      taxFromExclusive: true,
      total: true,
      tipTotal: true,
      discountTotal: true,
      tableId: true,
      locationId: true,
      orderType: true,
      createdAt: true,
      updatedAt: true,
      version: true,
      itemCount: true,
      baseSeatCount: true,
      extraSeatCount: true,
      employeeId: true,
      splitClass: true,
      splitMode: true,
      splitResolution: true,
      splitFamilyRootId: true,
      splitFamilyTotal: true,
      employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
      table: { select: { id: true, name: true } },
      items: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          price: true,
          quantity: true,
          specialNotes: true,
          seatNumber: true,
          courseNumber: true,
          courseStatus: true,
          isHeld: true,
          kitchenStatus: true,
          status: true,
          itemTotal: true,
          menuItemId: true,
          pricingOptionLabel: true,
          blockTimeMinutes: true,
          blockTimeStartedAt: true,
          blockTimeExpiresAt: true,
          menuItem: { select: { itemType: true } },
          createdAt: true,
          modifiers: {
            where: { deletedAt: null },
            select: {
              id: true,
              name: true,
              price: true,
              depth: true,
              preModifier: true,
              quantity: true,
              modifierId: true,
            },
          },
          itemDiscounts: {
            where: { deletedAt: null },
            select: { id: true, amount: true, percent: true, reason: true },
          },
        },
      },
    },
  })

  if (!order) {
    return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
  }

  // Compute server-authoritative cash/card totals
  const { cashTotal, cardTotal, cashDiscountPercent } = await computeDualPricing(
    order.locationId,
    Number(order.total),
    Number(order.subtotal),
    Number(order.discountTotal || 0),
    Number(order.taxFromInclusive) || 0,
    Number(order.taxFromExclusive) || 0,
    Number(order.tipTotal) || 0,
  )

  return ok({
    ...order,
    subtotal: Number(order.subtotal),
    taxTotal: Number(order.taxTotal),
    total: Number(order.total),
    tipTotal: Number(order.tipTotal),
    discountTotal: Number(order.discountTotal),
    splitClass: order.splitClass || null,
    splitMode: order.splitMode || null,
    splitResolution: order.splitResolution || null,
    splitFamilyRootId: order.splitFamilyRootId || null,
    splitFamilyTotal: order.splitFamilyTotal ? Number(order.splitFamilyTotal) : null,
    cashTotal,
    cardTotal,
    cashDiscountPercent,
    items: order.items.map(item => ({
      ...item,
      price: Number(item.price),
      itemTotal: Number(item.itemTotal),
      itemDiscounts: item.itemDiscounts.map(d => ({
        id: d.id,
        amount: Number(d.amount),
        percent: d.percent ? Number(d.percent) : null,
        reason: d.reason,
      })),
      modifiers: item.modifiers.map(mod => ({
        ...mod,
        price: Number(mod.price),
      })),
    })),
  })
}

// ---------------------------------------------------------------------------
// view=full  (default — complete order with payments, pizza data, etc.)
// ---------------------------------------------------------------------------

export async function getOrderFull(
  orderId: string,
  requestingEmployeeId: string | null,
) {
  const locationId = await resolveLocationId(orderId)
  if (!locationId) {
    return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
  }

  const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
    employee: {
      select: { id: true, displayName: true, firstName: true, lastName: true },
    },
    table: {
      select: { id: true, name: true },
    },
    items: {
      where: { deletedAt: null },
      include: ORDER_ITEM_FULL_INCLUDE,
    },
    payments: {
      where: { deletedAt: null },
      select: {
        id: true,
        paymentMethod: true,
        amount: true,
        tipAmount: true,
        totalAmount: true,
        status: true,
        cardLast4: true,
        cardBrand: true,
        roundingAdjustment: true,
        appliedPricingTier: true,
        detectedCardType: true,
        walletType: true,
        pricingProgramSnapshot: true,
      },
    },
  })

  if (!order) {
    return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
  }

  // Auth check — deferred to after fetch to eliminate double-fetch
  if (requestingEmployeeId) {
    const auth = await requirePermission(requestingEmployeeId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)
  }

  const response = mapOrderForResponse(order)
  // Ensure combo selections are always included on full-order reads.
  response.items = ((order as any).items || []).map((it: any) => mapOrderItemForWire(it)) as any

  const paidAmount = (order.payments as { status: string; totalAmount: unknown }[])
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + Number(p.totalAmount), 0)

  // Compute server-authoritative cash/card totals
  const { cashTotal, cardTotal, cashDiscountPercent } = await computeDualPricing(
    order.locationId,
    Number(order.total),
    Number(order.subtotal),
    Number(order.discountTotal || 0),
    Number((order as any).taxFromInclusive) || 0,
    Number((order as any).taxFromExclusive) || 0,
    Number((order as any).tipTotal) || 0,
  )

  return ok({
    ...response,
    paidAmount,
    version: order.version,
    splitClass: (order as any).splitClass || null,
    splitMode: (order as any).splitMode || null,
    splitResolution: (order as any).splitResolution || null,
    splitFamilyRootId: (order as any).splitFamilyRootId || null,
    splitFamilyTotal: (order as any).splitFamilyTotal ? Number((order as any).splitFamilyTotal) : null,
    cashTotal,
    cardTotal,
    cashDiscountPercent,
  })
}
// CI trigger 1774974150
