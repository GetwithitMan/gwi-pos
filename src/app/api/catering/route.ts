import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { parseSettings, DEFAULT_CATERING } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'

// Volume discount tiers: quantity threshold -> discount percent
function getVolumeDiscountPercent(quantity: number): number {
  if (quantity >= 50) return 20
  if (quantity >= 25) return 15
  if (quantity >= 10) return 10
  return 0
}

// GET /api/catering — list catering orders
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const customer = searchParams.get('customer')
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Build raw SQL query (CateringOrder is a raw table, not in Prisma schema)
    const conditions: string[] = ['"locationId" = $1', '"deletedAt" IS NULL']
    const params: unknown[] = [locationId]
    let paramIdx = 2

    if (status) {
      conditions.push(`"status" = $${paramIdx}`)
      params.push(status)
      paramIdx++
    }

    if (startDate) {
      conditions.push(`"eventDate" >= $${paramIdx}::date`)
      params.push(startDate)
      paramIdx++
    }

    if (endDate) {
      conditions.push(`"eventDate" <= $${paramIdx}::date`)
      params.push(endDate)
      paramIdx++
    }

    if (customer) {
      conditions.push(`("customerName" ILIKE $${paramIdx} OR "customerEmail" ILIKE $${paramIdx} OR "customerPhone" ILIKE $${paramIdx})`)
      params.push(`%${customer}%`)
      paramIdx++
    }

    const whereClause = conditions.join(' AND ')

    const countResult = await db.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM "CateringOrder" WHERE ${whereClause}`,
      ...params,
    )
    const totalCount = Number(countResult[0]?.count ?? 0)

    params.push(limit, offset)
    const orders = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "CateringOrder" WHERE ${whereClause}
       ORDER BY "eventDate" ASC, "createdAt" DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      ...params,
    )

    // For each order, fetch items
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT * FROM "CateringOrderItem"
           WHERE "cateringOrderId" = $1 AND "deletedAt" IS NULL
           ORDER BY "createdAt" ASC`,
          order.id,
        )
        return { ...order, items }
      }),
    )

    return NextResponse.json({
      data: {
        orders: ordersWithItems,
        pagination: { total: totalCount, limit, offset },
      },
    })
  } catch (error) {
    console.error('Failed to list catering orders:', error)
    return NextResponse.json({ error: 'Failed to list catering orders' }, { status: 500 })
  }
})

// POST /api/catering — create a catering order
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      customerName,
      customerPhone,
      customerEmail,
      customerId,
      eventDate,
      eventTime,
      guestCount,
      deliveryAddress,
      notes,
      items,
    } = body as {
      locationId: string
      customerName: string
      customerPhone?: string
      customerEmail?: string
      customerId?: string
      eventDate: string
      eventTime?: string
      guestCount: number
      deliveryAddress?: string
      notes?: string
      items: Array<{
        menuItemId?: string
        name?: string
        quantity: number
        unitPrice?: number
        specialInstructions?: string
      }>
    }

    if (!locationId || !customerName || !eventDate || !items?.length) {
      return NextResponse.json(
        { error: 'locationId, customerName, eventDate, and items are required' },
        { status: 400 },
      )
    }

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId

    // Load catering settings
    const locSettings = parseSettings(await getLocationSettings(locationId))
    const cateringConfig = locSettings.catering ?? DEFAULT_CATERING

    // Validate advance days
    const eventDateObj = new Date(eventDate)
    const now = new Date()
    const daysDiff = Math.ceil((eventDateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff < cateringConfig.minAdvanceDays) {
      return NextResponse.json(
        { error: `Catering orders require at least ${cateringConfig.minAdvanceDays} days advance notice` },
        { status: 400 },
      )
    }

    // Validate guest count
    if (guestCount > cateringConfig.maxGuestCount) {
      return NextResponse.json(
        { error: `Guest count cannot exceed ${cateringConfig.maxGuestCount}` },
        { status: 400 },
      )
    }

    // Resolve menu item prices if menuItemId provided
    const menuItemIds = items.filter(i => i.menuItemId).map(i => i.menuItemId!)
    const menuItems = menuItemIds.length > 0
      ? await db.menuItem.findMany({
          where: { id: { in: menuItemIds }, locationId, deletedAt: null },
          select: { id: true, name: true, price: true },
        })
      : []
    const menuItemMap = new Map(menuItems.map(m => [m.id, m]))

    // Calculate item totals with volume discount
    let subtotal = 0
    let totalVolumeDiscount = 0
    const resolvedItems = items.map(item => {
      const menuItem = item.menuItemId ? menuItemMap.get(item.menuItemId) : null
      const name = item.name || menuItem?.name || 'Unknown Item'
      const unitPrice = item.unitPrice ?? (menuItem ? Number(menuItem.price) : 0)
      const lineTotal = unitPrice * item.quantity
      const discountPct = getVolumeDiscountPercent(item.quantity)
      const discountAmount = Math.round(lineTotal * discountPct) / 100
      const discountedLineTotal = Math.round((lineTotal - discountAmount) * 100) / 100

      subtotal += lineTotal
      totalVolumeDiscount += discountAmount

      return {
        menuItemId: item.menuItemId || null,
        name,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
        volumeDiscountPct: discountPct,
        discountedLineTotal,
        specialInstructions: item.specialInstructions || null,
      }
    })

    const discountedSubtotal = subtotal - totalVolumeDiscount

    // Validate minimum order amount
    if (discountedSubtotal < cateringConfig.minOrderAmount) {
      return NextResponse.json(
        { error: `Minimum catering order is $${cateringConfig.minOrderAmount.toFixed(2)}` },
        { status: 400 },
      )
    }

    // Calculate service fee, delivery fee, tax
    const serviceFee = Math.round(discountedSubtotal * cateringConfig.serviceFeePercent) / 100
    const deliveryFee = deliveryAddress ? cateringConfig.deliveryFee : 0

    // Fetch tax rate
    // Note: catering orders currently assume all items are tax-exclusive
    const taxRules = await db.taxRule.findMany({
      where: { locationId, isActive: true, isInclusive: false, deletedAt: null },
      select: { rate: true },
    })
    const taxRate = taxRules.reduce((sum, r) => sum + Number(r.rate), 0)
    const taxTotal = Math.round(discountedSubtotal * taxRate * 100) / 100

    const total = Math.round((discountedSubtotal + serviceFee + deliveryFee + taxTotal) * 100) / 100

    // Deposit calculation
    const depositRequired = cateringConfig.requireDeposit
      ? Math.round(total * cateringConfig.depositPercent) / 100
      : 0

    // Create catering order via raw SQL
    const orderId = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

    await db.$executeRawUnsafe(
      `INSERT INTO "CateringOrder" (
        "id", "locationId", "customerName", "customerPhone", "customerEmail", "customerId",
        "eventDate", "eventTime", "guestCount", "deliveryAddress", "notes", "status",
        "subtotal", "volumeDiscount", "serviceFee", "deliveryFee", "taxTotal", "total",
        "depositRequired", "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7::date, $8, $9, $10, $11, 'inquiry',
        $12, $13, $14, $15, $16, $17,
        $18, $19, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )`,
      orderId, locationId, customerName, customerPhone || null, customerEmail || null, customerId || null,
      eventDate, eventTime || null, guestCount, deliveryAddress || null, notes || null,
      discountedSubtotal, totalVolumeDiscount, serviceFee, deliveryFee, taxTotal, total,
      depositRequired, employeeId || null,
    )

    // Insert items
    for (const item of resolvedItems) {
      await db.$executeRawUnsafe(
        `INSERT INTO "CateringOrderItem" (
          "id", "cateringOrderId", "menuItemId", "name", "quantity", "unitPrice",
          "lineTotal", "volumeDiscountPct", "discountedLineTotal", "specialInstructions",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        orderId, item.menuItemId, item.name, item.quantity, item.unitPrice,
        item.lineTotal, item.volumeDiscountPct, item.discountedLineTotal, item.specialInstructions,
      )
    }

    // Audit log (fire-and-forget)
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: employeeId || 'system',
        action: 'catering_order_created',
        entityType: 'catering_order',
        entityId: orderId,
        details: {
          customerName,
          eventDate,
          guestCount,
          total,
          itemCount: items.length,
        },
      },
    }).catch(console.error)

    return NextResponse.json({
      data: {
        id: orderId,
        status: 'inquiry',
        customerName,
        eventDate,
        guestCount,
        subtotal: discountedSubtotal,
        volumeDiscount: totalVolumeDiscount,
        serviceFee,
        deliveryFee,
        taxTotal,
        total,
        depositRequired,
        depositPaid: 0,
        items: resolvedItems,
      },
    })
  } catch (error) {
    console.error('Failed to create catering order:', error)
    return NextResponse.json({ error: 'Failed to create catering order' }, { status: 500 })
  }
})
