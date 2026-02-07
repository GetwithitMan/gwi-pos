import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Force dynamic rendering - never cache this endpoint
export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET - List all open orders (any type)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const orderType = searchParams.get('orderType') // optional filter

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Try to include split order fields if they exist in schema
    let orders
    try {
      orders = await db.order.findMany({
        where: {
          locationId,
          status: { in: ['open', 'sent', 'in_progress'] },
          // Show both parent orders (no parentOrderId) and split tickets (have parentOrderId)
          // But exclude parent orders that have been split (status = 'split')
          ...(employeeId ? { employeeId } : {}),
          ...(orderType ? { orderType } : {}),
        },
        include: {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
          table: {
            select: { id: true, name: true, section: { select: { name: true } } },
          },
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
          orderTypeRef: {
            select: { id: true, name: true, color: true, icon: true },
          },
          items: {
            include: {
              modifiers: true,
            },
          },
          payments: true,
          splitOrders: {
            select: {
              id: true,
              splitIndex: true,
              status: true,
              total: true,
            },
            orderBy: { splitIndex: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    } catch {
      // Fallback if split fields don't exist in database yet
      orders = await db.order.findMany({
        where: {
          locationId,
          status: { in: ['open', 'sent', 'in_progress'] },
          ...(employeeId ? { employeeId } : {}),
          ...(orderType ? { orderType } : {}),
        },
        include: {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
          table: {
            select: { id: true, name: true, section: { select: { name: true } } },
          },
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
          orderTypeRef: {
            select: { id: true, name: true, color: true, icon: true },
          },
          items: {
            include: {
              modifiers: true,
            },
          },
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
      })
    }

    // Get waitlist entries linked to these orders
    const orderIds = orders.map(o => o.id)
    let waitlistByOrder: Record<string, { position: number; menuItemName: string }[]> = {}

    // Get active entertainment items linked to these orders
    let entertainmentByOrder: Record<string, {
      menuItemId: string
      menuItemName: string
      status: string
      orderItemId: string | null
    }[]> = {}

    try {
      const entertainmentItems = await db.menuItem.findMany({
        where: {
          currentOrderId: { in: orderIds },
          entertainmentStatus: 'in_use',
        },
        select: {
          id: true,
          name: true,
          displayName: true,
          entertainmentStatus: true,
          currentOrderId: true,
          currentOrderItemId: true,
        },
      })

      for (const item of entertainmentItems) {
        if (item.currentOrderId) {
          if (!entertainmentByOrder[item.currentOrderId]) {
            entertainmentByOrder[item.currentOrderId] = []
          }
          entertainmentByOrder[item.currentOrderId].push({
            menuItemId: item.id,
            menuItemName: item.displayName || item.name,
            status: item.entertainmentStatus || 'in_use',
            orderItemId: item.currentOrderItemId,
          })
        }
      }
    } catch {
      // Entertainment fields may not exist
    }

    // Note: Entertainment waitlist is now floor plan element based,
    // not tab/order based. Waitlist entries link to FloorPlanElement via elementId.
    // Tab-linked waitlist functionality has been removed.

    return NextResponse.json({
      orders: orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        displayNumber: order.displayNumber || String(order.orderNumber), // "30-1" for splits, "30" for regular
        isSplitTicket: !!order.parentOrderId,
        parentOrderId: order.parentOrderId,
        splitIndex: order.splitIndex,
        orderType: order.orderType,
        orderTypeConfig: order.orderTypeRef ? {
          name: order.orderTypeRef.name,
          color: order.orderTypeRef.color,
          icon: order.orderTypeRef.icon,
        } : null,
        customFields: order.customFields as Record<string, string> | null,
        tabName: order.tabName,
        tableName: order.table?.name || null,  // Convenience field for display
        tableId: order.tableId,
        table: order.table ? {
          id: order.table.id,
          name: order.table.name,
          section: order.table.section?.name || null,
        } : null,
        customer: order.customer ? {
          id: order.customer.id,
          name: `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim(),
        } : null,
        guestCount: order.guestCount,
        status: order.status,
        employee: {
          id: order.employee.id,
          name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
        },
        // Waitlist info
        waitlist: waitlistByOrder[order.id] || [],
        isOnWaitlist: (waitlistByOrder[order.id]?.length || 0) > 0,
        // Entertainment session info
        entertainment: entertainmentByOrder[order.id] || [],
        hasActiveEntertainment: (entertainmentByOrder[order.id]?.length || 0) > 0,
        // Order status flags for badges
        hasHeldItems: order.items.some((item: { isHeld?: boolean }) => item.isHeld),
        courseMode: (order as Record<string, unknown>).courseMode || null,
        hasCoursingEnabled: (order as Record<string, unknown>).courseMode !== 'off' && !!(order as Record<string, unknown>).courseMode,
        items: order.items.map(item => ({
          id: item.id,
          menuItemId: item.menuItemId,
          name: item.name,
          price: Number(item.price),
          quantity: item.quantity,
          itemTotal: Number(item.itemTotal),
          specialNotes: item.specialNotes,
          isCompleted: item.isCompleted,
          completedAt: item.completedAt?.toISOString() || null,
          resendCount: item.resendCount,
          // Entertainment/block time fields
          blockTimeMinutes: item.blockTimeMinutes,
          blockTimeStartedAt: item.blockTimeStartedAt?.toISOString() || null,
          blockTimeExpiresAt: item.blockTimeExpiresAt?.toISOString() || null,
          modifiers: item.modifiers.map(mod => ({
            id: mod.id,
            modifierId: mod.modifierId,
            name: mod.name,
            price: Number(mod.price),
            preModifier: mod.preModifier,
          })),
        })),
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        total: Number(order.total),
        // Pre-auth info (for bar tabs)
        hasPreAuth: !!order.preAuthId,
        preAuth: order.preAuthId ? {
          cardBrand: order.preAuthCardBrand,
          last4: order.preAuthLast4,
          amount: order.preAuthAmount ? Number(order.preAuthAmount) : null,
          expiresAt: order.preAuthExpiresAt?.toISOString(),
        } : null,
        createdAt: order.createdAt.toISOString(),
        openedAt: order.openedAt.toISOString(),
        // Payment status
        paidAmount: order.payments
          .filter(p => p.status === 'completed')
          .reduce((sum, p) => sum + Number(p.totalAmount), 0),
        // Split info (may not exist if schema not migrated)
        hasSplits: (order as { splitOrders?: unknown[] }).splitOrders?.length ? true : false,
        splitCount: (order as { splitOrders?: unknown[] }).splitOrders?.length || 0,
        splits: ((order as { splitOrders?: { id: string; splitIndex: number | null; status: string; total: unknown }[] }).splitOrders || []).map(s => ({
          id: s.id,
          splitIndex: s.splitIndex,
          displayNumber: `${order.orderNumber}-${s.splitIndex}`,
          total: Number(s.total),
          isPaid: s.status === 'paid',
        })),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch open orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch open orders' },
      { status: 500 }
    )
  }
}
