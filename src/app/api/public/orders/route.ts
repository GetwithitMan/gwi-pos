/**
 * Public Order Submission for QR Dine-In Ordering
 *
 * POST /api/public/orders — submit a QR order from a customer's phone
 *
 * No authentication required. Order is tied to a table via qrOrderCode.
 * Rate limited: 5 orders per minute per IP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { emitToLocation } from '@/lib/socket-server'
import { isItemTaxInclusive, calculateSplitTax } from '@/lib/order-calculations'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('public-orders')

// ── Rate limiter (5 orders/min/IP) ──────────────────────────────────────────
const limiter = createRateLimiter({ maxAttempts: 5, windowMs: 60_000 })

interface OrderItemInput {
  menuItemId: string
  quantity: number
  modifiers?: { modifierId: string; quantity?: number }[]
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit
    const ip = getClientIp(request)

    if (!limiter.check(ip).allowed) {
      return NextResponse.json(
        { error: 'Too many orders. Please wait a minute before trying again.' },
        { status: 429 }
      )
    }

    const body = await request.json()
    const {
      slug,
      orderCode,
      items,
      customerName,
      customerPhone,
      notes,
    } = body as {
      slug?: string
      orderCode?: string
      items?: OrderItemInput[]
      customerName?: string
      customerPhone?: string
      notes?: string
    }

    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 })
    }
    if (!orderCode) {
      return NextResponse.json({ error: 'orderCode is required' }, { status: 400 })
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }

    // Resolve venue DB
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // Get location + settings
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, settings: true, timezone: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const settings = parseSettings(location.settings as Record<string, unknown>)
    const qrSettings = settings.qrOrdering

    // Check QR ordering enabled (default to allowed if not explicitly configured)
    if (qrSettings?.enabled === false) {
      return NextResponse.json({ error: 'QR ordering is not available' }, { status: 403 })
    }

    // Max items check
    const maxItems = qrSettings?.maxItemsPerOrder || 50
    const totalItems = items.reduce((sum: number, i: OrderItemInput) => sum + (i.quantity || 1), 0)
    if (totalItems > maxItems) {
      return NextResponse.json(
        { error: `Order exceeds maximum of ${maxItems} items` },
        { status: 400 }
      )
    }

    // Resolve table via qrOrderCode
    const tableRows = await venueDb.$queryRawUnsafe<{ id: string; name: string; sectionId: string | null }[]>(
      `SELECT "id", "name", "sectionId" FROM "Table"
       WHERE "qrOrderCode" = $1 AND "locationId" = $2 AND "isActive" = true AND "deletedAt" IS NULL
       LIMIT 1`,
      orderCode,
      location.id
    )

    if (tableRows.length === 0) {
      return NextResponse.json({ error: 'Invalid order code' }, { status: 400 })
    }

    const table = tableRows[0]

    // Validate all menu items exist and are active
    const menuItemIds = [...new Set(items.map((i: OrderItemInput) => i.menuItemId))]
    const menuItems = await venueDb.menuItem.findMany({
      where: {
        id: { in: menuItemIds },
        locationId: location.id,
        isActive: true,
        showOnline: true,
        deletedAt: null,
        isAvailable: true,
      },
      select: {
        id: true,
        name: true,
        price: true,
        onlinePrice: true,
        taxRate: true,
        isTaxExempt: true,
        categoryId: true,
        category: { select: { categoryType: true } },
      },
    })

    const menuItemMap = new Map(menuItems.map(mi => [mi.id, mi]))

    // Validate every requested item exists
    for (const item of items) {
      if (!menuItemMap.has(item.menuItemId)) {
        return NextResponse.json(
          { error: `Menu item not found or unavailable: ${item.menuItemId}` },
          { status: 400 }
        )
      }
    }

    // Get next order number atomically
    const locationId = location.id
    const dayStartTime = settings.businessDay.dayStartTime
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
    const { start: businessDayStart } = getCurrentBusinessDay(dayStartTime, location.timezone || 'America/New_York')

    const lastOrderRows = await venueDb.$queryRawUnsafe<{ orderNumber: number }[]>(
      `SELECT "orderNumber" FROM "Order" WHERE "locationId" = $1 AND "parentOrderId" IS NULL ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE`,
      locationId
    )
    const orderNumber = ((lastOrderRows as { orderNumber: number }[])[0]?.orderNumber ?? 0) + 1

    // Calculate totals
    const defaultTaxRate = settings.tax.defaultRate || 0
    const taxIncSettings = {
      taxInclusiveLiquor: settings.tax.taxInclusiveLiquor,
      taxInclusiveFood: settings.tax.taxInclusiveFood,
    }
    let subtotal = 0
    const orderItemsData: {
      locationId: string
      menuItemId: string
      name: string
      quantity: number
      price: number
      total: number
      taxRate: number
      taxAmount: number
      isTaxExempt: boolean
      isTaxInclusive: boolean
      categoryId: string
      seatNumber: number
      sortOrder: number
    }[] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const mi = menuItemMap.get(item.menuItemId)!
      const price = Number(mi.onlinePrice ?? mi.price)
      const qty = item.quantity || 1
      const itemTotal = price * qty
      const taxRate = mi.isTaxExempt ? 0 : (Number(mi.taxRate) || defaultTaxRate)
      const taxAmount = Math.round(itemTotal * (taxRate / 100) * 100) / 100
      const itemTaxInclusive = isItemTaxInclusive(mi.category?.categoryType, taxIncSettings)

      subtotal += itemTotal

      orderItemsData.push({
        locationId,
        menuItemId: mi.id,
        name: mi.name,
        quantity: qty,
        price,
        total: itemTotal,
        taxRate,
        taxAmount,
        isTaxExempt: mi.isTaxExempt,
        isTaxInclusive: itemTaxInclusive,
        categoryId: mi.categoryId,
        seatNumber: 1,
        sortOrder: i,
      })
    }

    // Split subtotals by tax-inclusive status
    let inclusiveSubtotal = 0
    let exclusiveSubtotal = 0
    for (const oi of orderItemsData) {
      if (oi.isTaxInclusive) {
        inclusiveSubtotal += oi.total
      } else {
        exclusiveSubtotal += oi.total
      }
    }

    // Use split-aware tax calculation
    const inclusiveTaxRateRaw = settings.tax.inclusiveTaxRate
    const inclusiveTaxRate = inclusiveTaxRateRaw != null && Number.isFinite(inclusiveTaxRateRaw) && inclusiveTaxRateRaw > 0
      ? inclusiveTaxRateRaw / 100 : undefined
    const { taxFromInclusive, taxFromExclusive, totalTax: taxTotal } = calculateSplitTax(
      inclusiveSubtotal, exclusiveSubtotal, defaultTaxRate / 100, inclusiveTaxRate
    )
    // Inclusive items already contain tax; only exclusive tax is added on top
    const total = Math.round((subtotal + taxFromExclusive) * 100) / 100

    // Resolve a fallback employee (QR orders have no employee — use first active employee)
    const fallbackEmployee = await venueDb.employee.findFirst({
      where: { locationId, isActive: true, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    const employeeId = fallbackEmployee?.id || ''

    // Create order with items in a transaction
     
    const order = await venueDb.$transaction(async (tx: any) => {
      // TX-KEEP: CREATE — QR dine-in order with computed totals; no repo create method
      const newOrder = await tx.order.create({
        data: {
          locationId,
          employeeId,
          orderNumber,
          orderType: 'dine_in',
          tableId: table.id,
          guestCount: 1,
          baseSeatCount: 1,
          extraSeatCount: 0,
          seatVersion: 0,
          seatTimestamps: { '1': new Date().toISOString() },
          status: 'sent', // Auto-send to kitchen
          subtotal,
          discountTotal: 0,
          taxTotal,
          taxFromInclusive,
          taxFromExclusive,
          inclusiveTaxRate: inclusiveTaxRate || 0,
          tipTotal: 0,
          total,
          commissionTotal: 0,
          businessDayDate: businessDayStart,
          notes: [
            notes ? `Guest note: ${notes.trim()}` : null,
            customerName ? `Customer: ${customerName}` : null,
            customerPhone ? `Phone: ${customerPhone}` : null,
            'QR Order',
          ].filter(Boolean).join(' | '),
        },
      })

      // Create order items
      for (const oi of orderItemsData) {
        // TX-KEEP: CREATE — QR order items created individually with orderId FK; no batch repo create method
        await tx.orderItem.create({
          data: {
            orderId: newOrder.id,
            locationId: oi.locationId,
            menuItemId: oi.menuItemId,
            name: oi.name,
            quantity: oi.quantity,
            price: oi.price,
            total: oi.total,
            taxRate: oi.taxRate,
            taxAmount: oi.taxAmount,
            isTaxExempt: oi.isTaxExempt,
            isTaxInclusive: oi.isTaxInclusive,
            categoryId: oi.categoryId,
            seatNumber: oi.seatNumber,
            sortOrder: oi.sortOrder,
            status: 'active',
            kitchenStatus: 'sent',
          },
        })
      }

      // Update table status to occupied
      await tx.$executeRawUnsafe(
        `UPDATE "Table" SET "status" = 'occupied', "updatedAt" = NOW() WHERE "id" = $1`,
        table.id
      )

      return newOrder
    })

    // Emit socket events for real-time KDS + terminal updates (fire-and-forget)
    void emitToLocation(locationId, 'orders:list-changed', {
      trigger: 'created',
      orderId: order.id,
      tableId: table.id,
      orderNumber,
      status: 'sent',
    }).catch(err => log.warn({ err }, 'Background task failed'))

    void emitToLocation(locationId, 'kds:order-received', {
      orderId: order.id,
      orderNumber,
      orderType: 'dine_in',
      tableName: table.name,
      source: 'qr_order',
    }).catch(err => log.warn({ err }, 'Background task failed'))

    void emitToLocation(locationId, 'floor-plan:updated', { locationId }).catch(err => log.warn({ err }, 'Background task failed'))

    // Estimated wait time (rough: 15 minutes base + 2 min per item beyond 3)
    const estimatedWaitMinutes = Math.max(10, 15 + Math.max(0, totalItems - 3) * 2)

    return NextResponse.json({
      data: {
        orderId: order.id,
        orderNumber,
        tableName: table.name,
        itemCount: totalItems,
        total,
        estimatedWaitMinutes,
        status: 'sent',
        message: 'Your order has been sent to the kitchen!',
      },
    })
  } catch (error) {
    console.error('[POST /api/public/orders] Error:', error)
    return NextResponse.json({ error: 'Failed to submit order' }, { status: 500 })
  }
}
