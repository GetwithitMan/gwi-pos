import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/orders/last-for-table?tableId=X&excludeOrderId=Y
 *
 * Returns the most recent completed/closed/paid order for a given table,
 * excluding the specified current order. Includes items with modifiers,
 * quantities, and special instructions for repeat-order functionality.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tableId = searchParams.get('tableId')
  const excludeOrderId = searchParams.get('excludeOrderId')

  if (!tableId) {
    return NextResponse.json({ error: 'tableId is required' }, { status: 400 })
  }

  // Find the most recent completed order for this table
  const lastOrder = await db.order.findFirst({
    where: {
      tableId,
      status: { in: ['paid', 'closed'] },
      deletedAt: null,
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
    orderBy: { closedAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      closedAt: true,
      items: {
        where: {
          deletedAt: null,
          status: 'active',
        },
        select: {
          id: true,
          menuItemId: true,
          name: true,
          price: true,
          quantity: true,
          pourSize: true,
          pourMultiplier: true,
          specialNotes: true,
          categoryType: true,
          modifiers: {
            select: {
              id: true,
              modifierId: true,
              name: true,
              price: true,
              preModifier: true,
              depth: true,
            },
          },
          menuItem: {
            select: {
              id: true,
              isAvailable: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  })

  if (!lastOrder) {
    return NextResponse.json({ data: null })
  }

  // Map items, flagging any that are now 86'd or deleted
  const items = lastOrder.items.map((item: any) => ({
    menuItemId: item.menuItemId,
    name: item.name,
    price: Number(item.price),
    quantity: item.quantity,
    pourSize: item.pourSize,
    pourMultiplier: item.pourMultiplier ? Number(item.pourMultiplier) : null,
    specialNotes: item.specialNotes,
    categoryType: item.categoryType,
    is86d: !item.menuItem?.isAvailable || item.menuItem?.deletedAt != null,
    modifiers: (item.modifiers || []).map((m: any) => ({
      modifierId: m.modifierId,
      name: m.name,
      price: Number(m.price),
      preModifier: m.preModifier,
      depth: m.depth,
    })),
  }))

  return NextResponse.json({
    data: {
      orderId: lastOrder.id,
      orderNumber: lastOrder.orderNumber,
      closedAt: lastOrder.closedAt,
      items,
      totalItems: items.reduce((sum: number, i: any) => sum + i.quantity, 0),
      unavailableItems: items.filter((i: any) => i.is86d).map((i: any) => i.name),
    },
  })
})
