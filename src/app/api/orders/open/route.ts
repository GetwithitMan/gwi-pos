import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'

// Force dynamic rendering - never cache this endpoint
export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET - List all open orders (any type)
export const GET = withVenue(withTiming(async function GET(request: NextRequest) {
  try {
    const timing = getTimingFromRequest(request)
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const orderType = searchParams.get('orderType') // optional filter
    const rolledOver = searchParams.get('rolledOver')
    const minAge = searchParams.get('minAge')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Summary mode: lightweight response for sidebar/list views
    const summary = searchParams.get('summary') === 'true'
    if (summary) {
      timing.start('db')
      const summaryOrders = await db.order.findMany({
        where: {
          locationId,
          status: { in: ['open', 'sent', 'in_progress', 'split'] },
          deletedAt: null,
          ...(employeeId ? { employeeId } : {}),
          ...(orderType ? { orderType } : {}),
          ...(rolledOver === 'true' ? { rolledOverAt: { not: null } } : {}),
          ...(minAge ? { openedAt: { lt: new Date(Date.now() - parseInt(minAge) * 60000) } } : {}),
        },
        select: {
          id: true,
          orderNumber: true,
          displayNumber: true,
          parentOrderId: true,
          splitIndex: true,
          status: true,
          orderType: true,
          tableId: true,
          tabName: true,
          guestCount: true,
          courseMode: true,
          customFields: true,
          subtotal: true,
          taxTotal: true,
          tipTotal: true,
          total: true,
          createdAt: true,
          openedAt: true,
          reopenedAt: true,
          reopenReason: true,
          employeeId: true,
          preAuthId: true,
          preAuthCardBrand: true,
          preAuthLast4: true,
          preAuthAmount: true,
          preAuthExpiresAt: true,
          tabStatus: true,
          rolledOverAt: true,
          rolledOverFrom: true,
          captureDeclinedAt: true,
          captureRetryCount: true,
          table: {
            select: { id: true, name: true, section: { select: { name: true } } },
          },
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
          orderTypeRef: {
            select: { id: true, name: true, color: true, icon: true },
          },
          cards: {
            where: { deletedAt: null, status: 'authorized' },
            select: { cardholderName: true, cardType: true, cardLast4: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
          payments: {
            select: { status: true, totalAmount: true },
          },
          items: {
            select: { isHeld: true, quantity: true },
          },
          splitOrders: {
            where: { deletedAt: null },
            select: {
              id: true,
              splitIndex: true,
              displayNumber: true,
              status: true,
              total: true,
            },
            orderBy: { splitIndex: 'asc' },
          },
          _count: {
            select: { items: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      timing.end('db', 'Summary query')

      return NextResponse.json({
        orders: summaryOrders.map(o => ({
          id: o.id,
          orderNumber: o.orderNumber,
          displayNumber: o.displayNumber || String(o.orderNumber),
          isSplitTicket: !!o.parentOrderId,
          parentOrderId: o.parentOrderId,
          splitIndex: o.splitIndex,
          status: o.status,
          orderType: o.orderType,
          orderTypeConfig: o.orderTypeRef ? {
            name: o.orderTypeRef.name,
            color: o.orderTypeRef.color,
            icon: o.orderTypeRef.icon,
          } : null,
          customFields: o.customFields as Record<string, string> | null,
          tabName: o.tabName,
          tabStatus: o.tabStatus || null,
          ageMinutes: Math.floor((Date.now() - new Date(o.openedAt || o.createdAt).getTime()) / 60000),
          isRolledOver: !!o.rolledOverAt,
          rolledOverAt: o.rolledOverAt?.toISOString?.() || null,
          rolledOverFrom: o.rolledOverFrom || null,
          isCaptureDeclined: o.tabStatus === 'declined_capture',
          captureRetryCount: o.captureRetryCount || 0,
          cardholderName: (o as { cards?: { cardholderName: string | null }[] }).cards?.[0]?.cardholderName || null,
          tableName: o.table?.name || null,
          tableId: o.tableId,
          table: o.table ? {
            id: o.table.id,
            name: o.table.name,
            section: o.table.section?.name || null,
          } : null,
          customer: o.customer ? {
            id: o.customer.id,
            name: `${o.customer.firstName || ''} ${o.customer.lastName || ''}`.trim(),
          } : null,
          guestCount: o.guestCount,
          employee: {
            id: o.employee.id,
            name: o.employee.displayName || `${o.employee.firstName} ${o.employee.lastName}`,
          },
          employeeId: o.employeeId,
          // Status flags for badges
          hasHeldItems: o.items.some((item: { isHeld?: boolean }) => item.isHeld),
          courseMode: (o as Record<string, unknown>).courseMode || null,
          hasCoursingEnabled: (o as Record<string, unknown>).courseMode !== 'off' && !!(o as Record<string, unknown>).courseMode,
          // No items/modifiers in summary - just counts
          itemCount: o.items.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0),
          subtotal: Number(o.subtotal),
          taxTotal: Number(o.taxTotal),
          tipTotal: Number(o.tipTotal),
          total: Number(o.total),
          // Pre-auth info
          hasPreAuth: !!o.preAuthId,
          preAuth: o.preAuthId ? {
            cardBrand: o.preAuthCardBrand,
            last4: o.preAuthLast4,
            amount: o.preAuthAmount ? Number(o.preAuthAmount) : null,
            expiresAt: o.preAuthExpiresAt?.toISOString(),
          } : null,
          createdAt: o.createdAt,
          openedAt: o.openedAt,
          reopenedAt: o.reopenedAt?.toISOString() || null,
          reopenReason: o.reopenReason || null,
          // Payment status
          paidAmount: o.payments
            .filter((p: { status: string }) => p.status === 'completed')
            .reduce((sum: number, p: { totalAmount: unknown }) => sum + Number(p.totalAmount), 0),
          // Defaults for fields not in summary
          waitlist: [],
          isOnWaitlist: false,
          entertainment: [],
          hasActiveEntertainment: false,
          items: [],
          hasSplits: ((o as any).splitOrders?.length ?? 0) > 0,
          splitCount: (o as any).splitOrders?.length ?? 0,
          splits: ((o as any).splitOrders || []).map((s: any) => ({
            id: s.id,
            splitIndex: s.splitIndex,
            displayNumber: s.displayNumber || `${o.orderNumber}-${s.splitIndex}`,
            total: Number(s.total),
            status: s.status,
            isPaid: s.status === 'paid',
          })),
        })),
        count: summaryOrders.length,
        summary: true,
      })
    }

    timing.start('db')
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: { in: ['open', 'sent', 'in_progress', 'split'] },
        ...(employeeId ? { employeeId } : {}),
        ...(orderType ? { orderType } : {}),
        ...(rolledOver === 'true' ? { rolledOverAt: { not: null } } : {}),
        ...(minAge ? { openedAt: { lt: new Date(Date.now() - parseInt(minAge) * 60000) } } : {}),
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
            modifiers: {
              select: {
                id: true,
                modifierId: true,
                name: true,
                price: true,
                depth: true,
                preModifier: true,
              },
            },
          },
        },
        cards: {
          where: { deletedAt: null, status: 'authorized' },
          select: { cardholderName: true, cardType: true, cardLast4: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        payments: {
          select: { status: true, totalAmount: true },
        },
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

    timing.end('db', 'Full orders query')

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
        tabStatus: (order as Record<string, unknown>).tabStatus || null,
        ageMinutes: Math.floor((Date.now() - new Date(order.openedAt || order.createdAt).getTime()) / 60000),
        isRolledOver: !!(order as any).rolledOverAt,
        rolledOverAt: (order as any).rolledOverAt?.toISOString?.() || null,
        rolledOverFrom: (order as any).rolledOverFrom || null,
        isCaptureDeclined: (order as any).tabStatus === 'declined_capture',
        captureRetryCount: (order as any).captureRetryCount || 0,
        cardholderName: (order as { cards?: { cardholderName: string | null }[] }).cards?.[0]?.cardholderName || null,
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
        reopenedAt: order.reopenedAt?.toISOString() || null,
        reopenReason: order.reopenReason || null,
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
}, 'orders-open'))
