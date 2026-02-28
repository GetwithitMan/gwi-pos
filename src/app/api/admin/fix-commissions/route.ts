import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'

// Helper to calculate commission for an item
function calculateItemCommission(
  itemTotal: number,
  quantity: number,
  commissionType: string | null,
  commissionValue: number | null
): number {
  if (!commissionType || commissionValue === null || commissionValue === undefined) {
    return 0
  }
  if (commissionType === 'percent') {
    return Math.round((itemTotal * commissionValue / 100) * 100) / 100
  } else if (commissionType === 'fixed') {
    return Math.round((commissionValue * quantity) * 100) / 100
  }
  return 0
}

// POST - Retroactively calculate and fix commissions for existing orders
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    // Auth check — require API key or admin permission
    const apiKey = request.headers.get('x-api-key')
    const hasApiKey = apiKey && apiKey === process.env.PROVISION_API_KEY

    const body = await request.json().catch(() => ({}))
    const { locationId, dryRun = true, requestingEmployeeId } = body as { locationId?: string; dryRun?: boolean; requestingEmployeeId?: string }

    if (!hasApiKey) {
      if (!locationId) return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
      const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.ADMIN)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Get all menu items with commission settings
    const menuItemsWithCommission = await db.menuItem.findMany({
      where: {
        commissionType: { not: null },
        ...(locationId ? { locationId } : {}),
      },
      select: {
        id: true,
        name: true,
        commissionType: true,
        commissionValue: true,
      },
    })

    const menuItemMap = new Map(menuItemsWithCommission.map(mi => [mi.id, mi]))
    const menuItemIds = menuItemsWithCommission.map(mi => mi.id)

    if (menuItemIds.length === 0) {
      return NextResponse.json({ data: {
        message: 'No menu items with commission settings found',
        itemsUpdated: 0,
        ordersUpdated: 0,
      } })
    }

    // Find all order items that have commission-enabled menu items
    // but don't have commission calculated yet
    const orderItemsToFix = await db.orderItem.findMany({
      where: {
        menuItemId: { in: menuItemIds },
        OR: [
          { commissionAmount: null },
          { commissionAmount: 0 },
        ],
        ...(locationId ? { locationId } : {}),
      },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            employeeId: true,
          },
        },
      },
    })

    // Group by order to update order totals
    const orderUpdates: Record<string, { items: typeof orderItemsToFix; totalCommission: number }> = {}
    const itemUpdates: { id: string; commissionAmount: number; itemName: string }[] = []

    for (const orderItem of orderItemsToFix) {
      const menuItem = menuItemMap.get(orderItem.menuItemId)
      if (!menuItem) continue

      const commissionAmount = calculateItemCommission(
        Number(orderItem.itemTotal),
        orderItem.quantity,
        menuItem.commissionType,
        menuItem.commissionValue ? Number(menuItem.commissionValue) : null
      )

      if (commissionAmount > 0) {
        itemUpdates.push({
          id: orderItem.id,
          commissionAmount,
          itemName: orderItem.name,
        })

        const orderId = orderItem.order.id
        if (!orderUpdates[orderId]) {
          orderUpdates[orderId] = { items: [], totalCommission: 0 }
        }
        orderUpdates[orderId].items.push(orderItem)
        orderUpdates[orderId].totalCommission += commissionAmount
      }
    }

    if (dryRun) {
      // Return what would be updated without making changes
      return NextResponse.json({ data: {
        dryRun: true,
        message: 'Dry run complete - no changes made',
        menuItemsWithCommission: menuItemsWithCommission.map(mi => ({
          id: mi.id,
          name: mi.name,
          commissionType: mi.commissionType,
          commissionValue: Number(mi.commissionValue),
        })),
        itemsToUpdate: itemUpdates.length,
        ordersToUpdate: Object.keys(orderUpdates).length,
        itemDetails: itemUpdates.slice(0, 20), // Show first 20 for preview
        totalCommissionToAdd: itemUpdates.reduce((sum, i) => sum + i.commissionAmount, 0),
      } })
    }

    // Apply the updates
    let itemsUpdated = 0
    let ordersUpdated = 0

    // Update order items
    for (const item of itemUpdates) {
      await db.orderItem.update({
        where: { id: item.id },
        data: { commissionAmount: item.commissionAmount },
      })
      itemsUpdated++
    }

    // Update order totals
    for (const [orderId, data] of Object.entries(orderUpdates)) {
      // Get current order commission and add to it
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { commissionTotal: true },
      })

      const currentCommission = Number(order?.commissionTotal || 0)
      const newCommission = currentCommission + data.totalCommission

      await db.order.update({
        where: { id: orderId },
        data: { commissionTotal: newCommission },
      })
      ordersUpdated++
    }

    // Event emission note: This is a batch admin tool that may touch hundreds of orders.
    // Commission fields (commissionAmount, commissionTotal) are not part of any existing
    // event payload type, and emitting per-order events for a retroactive batch fix would
    // be excessive. Skipping individual event emission for this admin-only repair tool.

    return NextResponse.json({ data: {
      dryRun: false,
      message: 'Commission fix complete',
      itemsUpdated,
      ordersUpdated,
      totalCommissionAdded: itemUpdates.reduce((sum, i) => sum + i.commissionAmount, 0),
    } })
  } catch (error) {
    console.error('Failed to fix commissions:', error)
    return NextResponse.json(
      { error: 'Failed to fix commissions' },
      { status: 500 }
    )
  }
})

// GET - Preview what would be fixed
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    // Get menu items with commission
    const menuItemsWithCommission = await db.menuItem.findMany({
      where: {
        commissionType: { not: null },
        ...(locationId ? { locationId } : {}),
      },
      select: {
        id: true,
        name: true,
        commissionType: true,
        commissionValue: true,
      },
    })

    // Count order items that need fixing (read from snapshot)
    const orderItemsNeedingFix = await db.orderItemSnapshot.count({
      where: {
        menuItemId: { in: menuItemsWithCommission.map(mi => mi.id) },
        OR: [
          { commissionAmount: null },
          { commissionAmount: 0 },
        ],
        ...(locationId ? { locationId } : {}),
      },
    })

    // Count orders with commission already tracked (read from snapshot)
    const ordersWithCommission = await db.orderSnapshot.count({
      where: {
        commissionTotal: { gt: 0 },
        ...(locationId ? { locationId } : {}),
      },
    })

    return NextResponse.json({ data: {
      menuItemsWithCommission: menuItemsWithCommission.map(mi => ({
        id: mi.id,
        name: mi.name,
        commissionType: mi.commissionType,
        commissionValue: Number(mi.commissionValue),
      })),
      orderItemsNeedingFix,
      ordersWithCommission,
      instructions: {
        dryRun: 'POST with { "dryRun": true } to preview changes',
        apply: 'POST with { "dryRun": false } to apply changes',
        locationId: 'Optionally add "locationId" to filter by location',
      },
    } })
  } catch (error) {
    console.error('Failed to preview commission fix:', error)
    return NextResponse.json(
      { error: 'Failed to preview commission fix' },
      { status: 500 }
    )
  }
})
