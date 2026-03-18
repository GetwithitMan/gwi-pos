import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'

const employeeSelect = { id: true, firstName: true, lastName: true } as const

// GET /api/reports/order-history/[id] — Full order detail for history view
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')

    // Fetch order with employee and table
    const order = await adminDb.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        orderNumber: true,
        orderType: true,
        status: true,
        guestCount: true,
        tabName: true,
        subtotal: true,
        taxTotal: true,
        discountTotal: true,
        tipTotal: true,
        total: true,
        isWalkout: true,
        openedAt: true,
        closedAt: true,
        employeeId: true,
        employee: { select: employeeSelect },
        table: { select: { id: true, name: true } },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (!employeeId) {
      return NextResponse.json({ error: 'employeeId query param is required' }, { status: 401 })
    }
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_SHIFT_REVIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Run all independent queries in parallel
    const [
      items,
      payments,
      voidLogs,
      orderDiscounts,
      itemDiscounts,
      tipTransactions,
      closedByLog,
      removedItemLogs,
    ] = await Promise.all([
      // Items with modifiers and addedBy
      adminDb.orderItem.findMany({
        where: { orderId, deletedAt: null },
        select: {
          id: true,
          name: true,
          price: true,
          cardPrice: true,
          quantity: true,
          itemTotal: true,
          status: true,
          voidReason: true,
          pourSize: true,
          seatNumber: true,
          specialNotes: true,
          createdAt: true,
          addedByEmployeeId: true,
          addedByEmployee: { select: employeeSelect },
          modifiers: {
            where: { deletedAt: null },
            select: { name: true, price: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),

      // Payments with refunds
      adminDb.payment.findMany({
        where: { orderId, deletedAt: null },
        select: {
          id: true,
          paymentMethod: true,
          amount: true,
          tipAmount: true,
          totalAmount: true,
          status: true,
          cardBrand: true,
          cardLast4: true,
          authCode: true,
          transactionId: true,
          entryMethod: true,
          datacapRecordNo: true,
          datacapSequenceNo: true,
          datacapRefNumber: true,
          amountRequested: true,
          amountAuthorized: true,
          amountTendered: true,
          changeGiven: true,
          processedAt: true,
          employeeId: true,
          employee: { select: employeeSelect },
          refundLogs: {
            where: { deletedAt: null },
            select: {
              id: true,
              refundAmount: true,
              refundReason: true,
              employeeId: true,
              employee: { select: employeeSelect },
              createdAt: true,
              datacapRefNo: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { processedAt: 'asc' },
      }),

      // Void logs
      adminDb.voidLog.findMany({
        where: { orderId, deletedAt: null },
        include: {
          employee: { select: employeeSelect },
          approvedBy: { select: employeeSelect },
          item: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),

      // Order-level discounts
      adminDb.orderDiscount.findMany({
        where: { orderId, deletedAt: null },
        select: {
          id: true,
          name: true,
          amount: true,
          percent: true,
          reason: true,
          appliedBy: true,
          createdAt: true,
        },
      }),

      // Item-level discounts
      adminDb.orderItemDiscount.findMany({
        where: { orderId, deletedAt: null },
        select: {
          id: true,
          orderItemId: true,
          amount: true,
          percent: true,
          reason: true,
          appliedById: true,
          appliedBy: { select: employeeSelect },
          createdAt: true,
          orderItem: { select: { name: true } },
          discountRule: { select: { name: true } },
        },
      }),

      // Tip transactions
      adminDb.tipTransaction.findMany({
        where: { orderId, deletedAt: null },
        select: {
          id: true,
          amountCents: true,
          sourceType: true,
          kind: true,
          primaryEmployeeId: true,
          primaryEmployee: { select: employeeSelect },
          collectedAt: true,
          tipGroupId: true,
          tipGroup: {
            select: {
              template: { select: { name: true } },
            },
          },
        },
        orderBy: { collectedAt: 'asc' },
      }),

      // Closed-by employee from audit log
      adminDb.auditLog.findFirst({
        where: {
          entityType: 'order',
          entityId: orderId,
          action: 'order_closed',
          deletedAt: null,
        },
        select: {
          employeeId: true,
          employee: { select: employeeSelect },
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),

      // Removed/unsent items from audit log
      adminDb.auditLog.findMany({
        where: {
          entityType: 'order',
          entityId: orderId,
          action: { in: ['item_removed', 'item_deleted', 'unsent_item_removed'] },
          deletedAt: null,
        },
        select: {
          id: true,
          action: true,
          details: true,
          employeeId: true,
          employee: { select: employeeSelect },
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    // Resolve order discount appliedBy employee IDs
    const discountEmployeeIds = orderDiscounts
      .map(d => d.appliedBy)
      .filter((id): id is string => id != null)
    const discountEmployees = discountEmployeeIds.length > 0
      ? await adminDb.employee.findMany({
          where: { id: { in: discountEmployeeIds } },
          select: employeeSelect,
        })
      : []
    const discountEmployeeMap = new Map(discountEmployees.map(e => [e.id, e]))

    // Fetch location tax settings for proper tax computation
    const locationSettings = parseSettings(await getLocationSettings(order.locationId))
    const taxRateDecimal = (locationSettings.tax?.defaultRate ?? 0) / 100
    const calculateAfterDiscount = locationSettings.tax?.calculateAfterDiscount ?? true

    // Compute card-adjusted subtotal for dual pricing
    const activeItems = items.filter(i => i.status === 'active')
    const hasCardPricing = activeItems.some(i => i.cardPrice != null)

    // Derive dual pricing multiplier from any item that has both price and cardPrice
    const dualPricingMultiplier = (() => {
      for (const item of activeItems) {
        if (item.cardPrice != null && Number(item.price) > 0) {
          return Number(item.cardPrice) / Number(item.price)
        }
      }
      return 1
    })()

    // Compute cash subtotal from actual items (not stored order.subtotal which may be stale)
    const computedCashSubtotal = Math.round(
      activeItems.reduce((sum, i) => sum + Number(i.itemTotal), 0) * 100
    ) / 100

    // Card subtotal = computed cash subtotal × multiplier (scales base + modifiers)
    const cardSubtotal = hasCardPricing
      ? Math.round(computedCashSubtotal * dualPricingMultiplier * 100) / 100
      : null
    const subtotal = cardSubtotal ?? computedCashSubtotal
    const discountTotal = Math.round(Number(order.discountTotal) * 100) / 100

    // Tax: compute from location settings (not stored values which may be buggy)
    const cashTaxableAmount = calculateAfterDiscount
      ? Math.max(0, computedCashSubtotal - discountTotal)
      : computedCashSubtotal
    const computedCashTax = Math.round(cashTaxableAmount * taxRateDecimal * 100) / 100
    const cardTaxableAmount = calculateAfterDiscount
      ? Math.max(0, subtotal - discountTotal)
      : subtotal
    const displayTaxTotal = Math.round(cardTaxableAmount * taxRateDecimal * 100) / 100
    const taxRate = taxRateDecimal > 0
      ? Math.round(taxRateDecimal * 10000) / 10000
      : undefined

    const formatEmployee = (emp: { id: string; firstName: string; lastName: string } | null) =>
      emp ? { id: emp.id, firstName: emp.firstName, lastName: emp.lastName } : null

    const formatName = (emp: { firstName: string; lastName: string } | null) =>
      emp ? `${emp.firstName} ${emp.lastName}` : null

    return NextResponse.json({
      data: {
        // Header
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        status: order.status,
        isWalkout: order.isWalkout || undefined,
        tableName: order.table?.name ?? undefined,
        tabName: order.tabName ?? undefined,
        guestCount: order.guestCount,
        assignedEmployee: formatEmployee(order.employee),

        // Open/Close
        openedBy: formatEmployee(order.employee),
        openedAt: order.openedAt.toISOString(),
        closedBy: closedByLog ? formatEmployee(closedByLog.employee) : null,
        closedAt: order.closedAt?.toISOString(),

        // Items — use card price when dual pricing is active
        // Multiplier applies to base price AND modifier prices
        items: items.map(item => {
          const cashPrice = Number(item.price)
          const hasDP = item.cardPrice != null
          const displayPrice = hasDP ? Number(item.cardPrice) : cashPrice
          const cashItemTotal = Number(item.itemTotal)
          // Full card-adjusted item total (base + modifiers, all scaled)
          const displayTotal = hasDP
            ? Math.round(cashItemTotal * dualPricingMultiplier * 100) / 100
            : cashItemTotal
          return {
          id: item.id,
          name: item.name,
          price: displayPrice,
          cashPrice: hasDP ? cashPrice : undefined,
          quantity: item.quantity,
          itemTotal: displayTotal,
          status: item.status,
          voidReason: item.voidReason ?? undefined,
          pourSize: item.pourSize ?? undefined,
          seatNumber: item.seatNumber ?? undefined,
          specialNotes: item.specialNotes ?? undefined,
          addedBy: item.addedByEmployee
            ? formatEmployee(item.addedByEmployee)
            : formatEmployee(order.employee),
          addedAt: item.createdAt.toISOString(),
          modifiers: item.modifiers.map(m => ({
            name: m.name,
            price: hasDP ? Math.round(Number(m.price) * dualPricingMultiplier * 100) / 100 : Number(m.price),
          })),
        }}),

        // Removed items
        removedItems: removedItemLogs.map(log => ({
          id: log.id,
          action: log.action,
          details: (log.details as Record<string, unknown>) ?? {},
          employeeName: log.employee ? formatName(log.employee) : null,
          timestamp: log.createdAt.toISOString(),
        })),

        // Financials (card price when dual pricing active)
        subtotal,
        taxTotal: displayTaxTotal,
        taxRate,
        discountTotal,
        tipTotal: Number(order.tipTotal),
        total: Math.round((subtotal - discountTotal + displayTaxTotal) * 100) / 100,
        // Dual pricing breakdown
        cashSubtotal: hasCardPricing ? computedCashSubtotal : undefined,
        cashTax: hasCardPricing ? computedCashTax : undefined,
        cashTotal: hasCardPricing
          ? Math.round((computedCashSubtotal - discountTotal + computedCashTax) * 100) / 100
          : undefined,
        isDualPricing: hasCardPricing || undefined,

        // Payments
        payments: payments.map(p => ({
          id: p.id,
          method: p.paymentMethod,
          amount: Number(p.amount),
          tipAmount: Number(p.tipAmount),
          totalAmount: Number(p.totalAmount),
          status: p.status,
          cardBrand: p.cardBrand ?? undefined,
          cardLast4: p.cardLast4 ?? undefined,
          authCode: p.authCode ?? undefined,
          transactionId: p.transactionId ?? undefined,
          entryMethod: p.entryMethod ?? undefined,
          datacapRecordNo: p.datacapRecordNo ?? undefined,
          datacapSequenceNo: p.datacapSequenceNo ?? undefined,
          datacapRefNumber: p.datacapRefNumber ?? undefined,
          amountRequested: p.amountRequested != null ? Number(p.amountRequested) : undefined,
          amountAuthorized: p.amountAuthorized != null ? Number(p.amountAuthorized) : undefined,
          amountTendered: p.amountTendered != null ? Number(p.amountTendered) : undefined,
          changeGiven: p.changeGiven != null ? Number(p.changeGiven) : undefined,
          processedBy: formatEmployee(p.employee),
          processedAt: p.processedAt.toISOString(),
          refunds: p.refundLogs.map(r => ({
            id: r.id,
            refundAmount: Number(r.refundAmount),
            refundReason: r.refundReason,
            employeeName: r.employee ? formatName(r.employee) : null,
            createdAt: r.createdAt.toISOString(),
            datacapRefNo: r.datacapRefNo ?? undefined,
          })),
        })),

        // Voids
        voids: voidLogs.map(v => ({
          id: v.id,
          voidType: v.voidType,
          itemId: v.itemId ?? undefined,
          itemName: v.item?.name ?? undefined,
          amount: Number(v.amount),
          reason: v.reason,
          wasMade: v.wasMade,
          employee: formatEmployee(v.employee),
          approvedBy: formatEmployee(v.approvedBy),
          createdAt: v.createdAt.toISOString(),
        })),

        // Discounts
        orderDiscounts: orderDiscounts.map(d => ({
          id: d.id,
          name: d.name,
          amount: Number(d.amount),
          percent: d.percent != null ? Number(d.percent) : undefined,
          reason: d.reason ?? undefined,
          appliedBy: d.appliedBy ? formatEmployee(discountEmployeeMap.get(d.appliedBy) ?? null) ?? { id: d.appliedBy, firstName: '', lastName: '' } : null,
          createdAt: d.createdAt.toISOString(),
        })),
        itemDiscounts: itemDiscounts.map(d => ({
          id: d.id,
          orderItemId: d.orderItemId,
          itemName: d.orderItem?.name ?? undefined,
          amount: Number(d.amount),
          percent: d.percent != null ? Number(d.percent) : undefined,
          reason: d.reason ?? undefined,
          appliedBy: formatEmployee(d.appliedBy),
          createdAt: d.createdAt.toISOString(),
        })),

        // Tips
        tipTransactions: tipTransactions.map(t => ({
          id: t.id,
          amountCents: Number(t.amountCents),
          sourceType: t.sourceType,
          kind: t.kind,
          primaryEmployee: formatEmployee(t.primaryEmployee),
          tipGroupName: t.tipGroup?.template?.name ?? undefined,
          collectedAt: t.collectedAt.toISOString(),
        })),
      },
    })
  } catch (error) {
    console.error('Failed to fetch order detail:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order detail' },
      { status: 500 }
    )
  }
})
