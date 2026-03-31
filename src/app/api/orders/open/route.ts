import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { err, ok } from '@/lib/api-response'
// TODO: Migrate to OrderRepository once it supports getOpenOrdersSummary(), getOpenOrdersFull(),
// business day batching, empty-shell exclusion, rich includes, multi-filter, and pagination

// ---------------------------------------------------------------------------
// Lightweight in-memory response cache for summary queries
// Android registers poll every 60s + on socket events. Most calls return
// identical data. A 5s TTL eliminates redundant DB work while socket-driven
// invalidation keeps the cache fresh on mutations.
// ---------------------------------------------------------------------------
const openOrdersCache = new Map<string, { data: any; timestamp: number }>()
const OPEN_ORDERS_CACHE_TTL = 5_000 // 5 seconds

/** Clear cached open-orders responses for a given location (called on mutations). */
export function invalidateOpenOrdersCache(locationId: string) {
  for (const key of openOrdersCache.keys()) {
    if (key.startsWith(locationId + ':')) {
      openOrdersCache.delete(key)
    }
  }
}

// Force dynamic rendering - never cache this endpoint
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Cache whether the scheduledFor column exists on the Order table.
// Checked once per process lifetime to avoid repeated raw SQL errors in logs.
let _scheduledForExists: boolean | null = null
async function hasScheduledForColumn(): Promise<boolean> {
  if (_scheduledForExists !== null) return _scheduledForExists
  try {
    const rows = await db.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Order' AND column_name = 'scheduledFor'
      ) AS "exists"
    `
    _scheduledForExists = rows[0]?.exists === true
  } catch {
    _scheduledForExists = false
  }
  return _scheduledForExists
}

// GET - List all open orders (any type)
// TODO: OrderRepository.getOpenOrders() exists but is too simple for this route —
// needs business day batching, empty-shell exclusion, rich includes, and multi-filter support.
// Add repository methods: getOpenOrdersSummary(), getOpenOrdersFull(), countOpenOrders()
export const GET = withVenue(withTiming(async function GET(request: NextRequest) {
  try {
    const timing = getTimingFromRequest(request)
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const orderType = searchParams.get('orderType') // optional filter
    const rolledOver = searchParams.get('rolledOver')
    const previousDay = searchParams.get('previousDay') === 'true'
    const minAge = searchParams.get('minAge')

    if (!locationId) {
      return err('Location ID is required')
    }

    // Compute business day boundary for filtering
    // TODO: Add LocationRepository once that repository exists
    const location = await db.location.findFirst({
      where: { id: locationId },
      select: { settings: true, timezone: true },
    })
    const settings = location?.settings as Record<string, unknown> | null
    const dayStartTime = (settings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
    const venueTimezone = location?.timezone || 'America/New_York'
    const businessDayStart = getCurrentBusinessDay(dayStartTime, venueTimezone).start

    // Business day filter: split OR into parallel indexed queries for ~30% speedup
    // Instead of OR: [{businessDayDate: {gte}}, {businessDayDate: null, createdAt: {gte}}]
    // which forces bitmap OR scans, we run two parallel queries each hitting indexes directly
    const businessDayMode = previousDay ? 'previous' as const : (rolledOver === 'true' ? 'none' as const : 'current' as const)
     
    async function batchBusinessDayQuery(findManyArgs: any, mode = businessDayMode): Promise<any[]> {
      if (mode === 'none') {
        return db.order.findMany(findManyArgs)
      }
      const op = mode === 'previous' ? 'lt' : 'gte'
      const { where, take: outerTake, ...rest } = findManyArgs
      const [primary, legacy] = await Promise.all([
        // Each sub-query gets the full take limit — we'll trim after merge
        db.order.findMany({ where: { ...where, businessDayDate: { [op]: businessDayStart } }, ...(outerTake ? { take: outerTake } : {}), ...rest }),
        db.order.findMany({ where: { ...where, businessDayDate: null, createdAt: { [op]: businessDayStart } }, ...(outerTake ? { take: outerTake } : {}), ...rest }),
      ])
      // Merge and re-sort (both sub-queries are individually sorted, merge maintains order)
      const merged = [...primary, ...legacy]
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      // Apply limit after merge (each sub-query may return up to `take` rows)
      return outerTake ? merged.slice(0, outerTake) : merged
    }

    // Count-only mode: returns just the count, no data (for badge counts)
    const countOnly = searchParams.get('count') === 'true'
    if (countOnly) {
      timing.start('db')
      const baseWhere = {
        locationId,
        status: { in: ['draft', 'open', 'sent', 'in_progress', 'split'] },
        deletedAt: null,
        NOT: [
          { status: 'draft', itemCount: 0, orderType: { not: 'bar_tab' } },
          { status: { in: ['open', 'sent', 'in_progress'] }, itemCount: 0, total: { lte: 0 } },
          { splitResolution: { not: null } },
        ],
        ...(employeeId ? { employeeId } : {}),
        ...(orderType ? { orderType } : {}),
        ...(rolledOver === 'true' ? { rolledOverAt: { not: null } } : {}),
        ...(minAge ? { openedAt: { lt: new Date(Date.now() - parseInt(minAge) * 60000) } } : {}),
      } as any

      let count: number
      if (businessDayMode === 'none') {
        count = await db.order.count({ where: baseWhere })
      } else {
        const op = businessDayMode === 'previous' ? 'lt' : 'gte'
        const [primary, legacy] = await Promise.all([
          db.order.count({ where: { ...baseWhere, businessDayDate: { [op]: businessDayStart } } }),
          db.order.count({ where: { ...baseWhere, businessDayDate: null, createdAt: { [op]: businessDayStart } } }),
        ])
        count = primary + legacy
      }
      timing.end('db', 'Count query')
      return ok({ count })
    }

    // Summary mode: lightweight response for sidebar/list views
    const summary = searchParams.get('summary') === 'true'
    if (summary) {
      // Pagination: default 100, max 200
      const limitParam = searchParams.get('limit')
      const summaryLimit = Math.min(Math.max(parseInt(limitParam || '100', 10) || 100, 1), 200)

      // Check response cache (summary-only, keyed by location + params)
      const cacheKey = `${locationId}:${summaryLimit}:${employeeId || ''}:${orderType || ''}:${rolledOver || ''}:${minAge || ''}:${previousDay}`
      const cached = openOrdersCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < OPEN_ORDERS_CACHE_TTL) {
        return NextResponse.json(cached.data)
      }

      timing.start('db')
      const summaryOrders = await batchBusinessDayQuery({
        where: {
          locationId,
          status: { in: ['draft', 'open', 'sent', 'in_progress', 'split'] },
          deletedAt: null,
          // Exclude empty shells: abandoned drafts and zombie orders (all items transferred away)
          // But keep draft bar_tabs — opening a tab is intentional, not an abandoned draft
          NOT: [
            { status: 'draft', itemCount: 0, orderType: { not: 'bar_tab' } },
            { status: { in: ['open', 'sent', 'in_progress'] }, itemCount: 0, total: { lte: 0 } },
            { splitResolution: { not: null } },
          ],
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
          splitClass: true,
          splitMode: true,
          splitResolution: true,
          splitFamilyRootId: true,
          splitFamilyTotal: true,
          status: true,
          orderType: true,
          tableId: true,
          tabName: true,
          guestCount: true,
          courseMode: true,
          customFields: true,
          itemCount: true,
          subtotal: true,
          taxTotal: true,
          tipTotal: true,
          discountTotal: true,
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
          claimedByEmployeeId: true,
          claimedByTerminalId: true,
          claimedAt: true,
          claimedByEmployee: {
            select: { displayName: true, firstName: true, lastName: true },
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
        take: summaryLimit,
      })

      timing.end('db', 'Summary query')

      // Fetch scheduledFor for these orders (raw column added by migration 027)
      const summaryOrderIds = summaryOrders.map(o => o.id)
      let scheduledMap = new Map<string, string | null>()
      if (summaryOrderIds.length > 0 && await hasScheduledForColumn()) {
        try {
          const scheduledRows = await db.$queryRaw<{ id: string; scheduledFor: Date | null }[]>`SELECT id, "scheduledFor" FROM "Order" WHERE id = ANY(${summaryOrderIds}) AND "scheduledFor" IS NOT NULL`
          scheduledMap = new Map(scheduledRows.map(r => [r.id, r.scheduledFor?.toISOString?.() || null]))
        } catch (_) { /* query failed — skip */ }
      }

      const summaryResponseData = {
        orders: summaryOrders.map(o => ({
          id: o.id,
          orderNumber: o.orderNumber,
          displayNumber: o.displayNumber || String(o.orderNumber),
          isSplitTicket: !!o.parentOrderId,
          parentOrderId: o.parentOrderId,
          splitIndex: o.splitIndex,
          splitClass: o.splitClass || null,
          splitMode: o.splitMode || null,
          splitResolution: o.splitResolution || null,
          splitFamilyRootId: o.splitFamilyRootId || null,
          splitFamilyTotal: o.splitFamilyTotal ? Number(o.splitFamilyTotal) : null,
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
          // Use live item count from _count relation (DB itemCount field can be stale on splits)
          itemCount: (o as any)._count?.items ?? o.itemCount,
          subtotal: Number(o.subtotal),
          taxTotal: Number(o.taxTotal),
          tipTotal: Number(o.tipTotal),
          discountTotal: Number(o.discountTotal),
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
          // Pre-order / scheduled
          scheduledFor: scheduledMap.get(o.id) || null,
          // Claim info
          claimedByEmployeeId: (o as any).claimedByEmployeeId || null,
          claimedByTerminalId: (o as any).claimedByTerminalId || null,
          claimedAt: (o as any).claimedAt?.toISOString?.() || (o as any).claimedAt || null,
          claimedByEmployee: (o as any).claimedByEmployee ? {
            displayName: (o as any).claimedByEmployee.displayName ||
              `${(o as any).claimedByEmployee.firstName || ''} ${(o as any).claimedByEmployee.lastName || ''}`.trim() || null,
          } : null,
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
        limit: summaryLimit,
        summary: true,
      }

      // Store in cache for subsequent requests within the TTL window
      openOrdersCache.set(cacheKey, { data: { data: summaryResponseData }, timestamp: Date.now() })

      return ok(summaryResponseData)
    }

    timing.start('db')
    const orders = await batchBusinessDayQuery({
      where: {
        locationId,
        status: { in: ['draft', 'open', 'sent', 'in_progress', 'split'] },
        deletedAt: null,
        // Exclude empty shells: abandoned drafts and zombie orders (all items transferred away)
        // But keep draft bar_tabs — opening a tab is intentional, not an abandoned draft
        NOT: [
          { status: 'draft', itemCount: 0, orderType: { not: 'bar_tab' } },
          { status: { in: ['open', 'sent', 'in_progress'] }, itemCount: 0, total: { lte: 0 } },
          { splitResolution: { not: null } },
        ],
        ...(employeeId ? { employeeId } : {}),
        ...(orderType ? { orderType } : {}),
        ...(rolledOver === 'true' ? { rolledOverAt: { not: null } } : {}),
        ...(minAge ? { openedAt: { lt: new Date(Date.now() - parseInt(minAge) * 60000) } } : {}),
      },
      take: 200,
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
        claimedByEmployee: {
          select: { displayName: true, firstName: true, lastName: true },
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
    const waitlistByOrder: Record<string, { position: number; menuItemName: string }[]> = {}

    // Get active entertainment items linked to these orders
    const entertainmentByOrder: Record<string, {
      menuItemId: string
      menuItemName: string
      status: string
      orderItemId: string | null
    }[]> = {}

    try {
      // TODO: Add MenuItemRepository.findByCurrentOrderIds() once that repository exists
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

    // Fetch scheduledFor for these orders (raw column added by migration 027)
    let scheduledFullMap = new Map<string, string | null>()
    if (orderIds.length > 0 && await hasScheduledForColumn()) {
      try {
        const scheduledFullRows = await db.$queryRaw<{ id: string; scheduledFor: Date | null }[]>`SELECT id, "scheduledFor" FROM "Order" WHERE id = ANY(${orderIds}) AND "scheduledFor" IS NOT NULL`
        scheduledFullMap = new Map(scheduledFullRows.map(r => [r.id, r.scheduledFor?.toISOString?.() || null]))
      } catch (_) { /* query failed — skip */ }
    }

    return ok({
      orders: orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        displayNumber: order.displayNumber || String(order.orderNumber), // "30-1" for splits, "30" for regular
        isSplitTicket: !!order.parentOrderId,
        parentOrderId: order.parentOrderId,
        splitIndex: order.splitIndex,
        splitClass: (order as any).splitClass || null,
        splitMode: (order as any).splitMode || null,
        splitResolution: (order as any).splitResolution || null,
        splitFamilyRootId: (order as any).splitFamilyRootId || null,
        splitFamilyTotal: (order as any).splitFamilyTotal ? Number((order as any).splitFamilyTotal) : null,
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
        items: order.items.map((item: any) => ({
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
          modifiers: item.modifiers.map((mod: any) => ({
            id: mod.id,
            modifierId: mod.modifierId,
            name: mod.name,
            price: Number(mod.price),
            preModifier: mod.preModifier,
          })),
        })),
        itemCount: order.items?.length ?? order.itemCount,
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
        // Pre-order / scheduled
        scheduledFor: scheduledFullMap.get(order.id) || null,
        // Claim info
        claimedByEmployeeId: (order as any).claimedByEmployeeId || null,
        claimedByTerminalId: (order as any).claimedByTerminalId || null,
        claimedAt: (order as any).claimedAt?.toISOString?.() || null,
        claimedByEmployee: (order as any).claimedByEmployee ? {
          displayName: (order as any).claimedByEmployee.displayName ||
            `${(order as any).claimedByEmployee.firstName || ''} ${(order as any).claimedByEmployee.lastName || ''}`.trim() || null,
        } : null,
        // Payment status
        paidAmount: order.payments
          .filter((p: any) => p.status === 'completed')
          .reduce((sum: number, p: any) => sum + Number(p.totalAmount), 0),
        // Split info (may not exist if schema not migrated)
        hasSplits: (order as { splitOrders?: unknown[] }).splitOrders?.length ? true : false,
        splitCount: (order as { splitOrders?: unknown[] }).splitOrders?.length || 0,
        splits: ((order as { splitOrders?: { id: string; splitIndex: number | null; status: string; total: unknown }[] }).splitOrders || []).map((s: any) => ({
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
    return err('Failed to fetch open orders', 500)
  }
}, 'orders-open'))
