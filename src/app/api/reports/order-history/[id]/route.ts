import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings, getPricingProgram } from '@/lib/settings'
import { calculateCardPrice, calculateDebitPrice, roundToCents } from '@/lib/pricing'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'

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
    const order = await db.order.findUnique({
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
      return notFound('Order not found')
    }

    if (!employeeId) {
      return unauthorized('employeeId query param is required')
    }
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_SHIFT_REVIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
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
      db.orderItem.findMany({
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
      db.payment.findMany({
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
      db.voidLog.findMany({
        where: { orderId, deletedAt: null },
        include: {
          employee: { select: employeeSelect },
          approvedBy: { select: employeeSelect },
          item: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),

      // Order-level discounts
      db.orderDiscount.findMany({
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
      db.orderItemDiscount.findMany({
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
      db.tipTransaction.findMany({
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
      db.auditLog.findFirst({
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
      db.auditLog.findMany({
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
      ? await db.employee.findMany({
          where: { id: { in: discountEmployeeIds } },
          select: employeeSelect,
        })
      : []
    const discountEmployeeMap = new Map(discountEmployees.map(e => [e.id, e]))

    // ── Use canonical pricing program + stored order values ──
    const locationSettings = parseSettings(await getLocationSettings(order.locationId))
    const pp = getPricingProgram(locationSettings)
    const taxRateDecimal = (locationSettings.tax?.defaultRate ?? 0) / 100
    const taxRate = taxRateDecimal > 0
      ? Math.round(taxRateDecimal * 10000) / 10000
      : undefined

    const isDualPricing = pp.enabled && (
      pp.model === 'dual_price' || pp.model === 'dual_price_pan_debit' || pp.model === 'cash_discount'
    )

    // Determine the applied tier from the first card payment
    const cardPayment = isDualPricing ? payments.find(p =>
      (p as any).pricingMode === 'card' ||
      (p as any).appliedPricingTier === 'credit' ||
      (p as any).appliedPricingTier === 'debit'
    ) : null
    const appliedTier = (
      (cardPayment as any)?.appliedPricingTier ||
      ((cardPayment as any)?.pricingMode === 'card' ? 'credit' : null)
    ) as 'credit' | 'debit' | null

    const markupPercent = (() => {
      if (!isDualPricing || !appliedTier) return 0
      if (appliedTier === 'debit') return pp.debitMarkupPercent ?? 0
      return pp.creditMarkupPercent ?? pp.cashDiscountPercent ?? 0
    })()

    const hasCardPricing = isDualPricing && !!cardPayment && markupPercent > 0

    const applyMarkup = (amount: number): number =>
      appliedTier === 'debit'
        ? calculateDebitPrice(amount, markupPercent)
        : calculateCardPrice(amount, markupPercent)

    // Use STORED order values (never recalculate from items or settings)
    const cashSubtotal = roundToCents(Number(order.subtotal))
    const storedTax = roundToCents(Number(order.taxTotal))
    const discountTotal = roundToCents(Number(order.discountTotal))

    // Display values: markup applies to subtotal only (pre-tax per DP1 rule)
    const subtotal = hasCardPricing ? applyMarkup(cashSubtotal) : cashSubtotal
    const displayTaxTotal = storedTax

    const formatEmployee = (emp: { id: string; firstName: string; lastName: string } | null) =>
      emp ? { id: emp.id, firstName: emp.firstName, lastName: emp.lastName } : null

    const formatName = (emp: { firstName: string; lastName: string } | null) =>
      emp ? `${emp.firstName} ${emp.lastName}` : null

    return ok({
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

        // Items — use stored cardPrice when present, otherwise apply canonical markup
        items: items.map(item => {
          const cashPrice = Number(item.price)
          const hasDP = hasCardPricing && item.cardPrice != null
          const displayPrice = hasDP ? Number(item.cardPrice)
            : (hasCardPricing ? applyMarkup(cashPrice) : cashPrice)
          const cashItemTotal = Number(item.itemTotal)
          const displayTotal = hasCardPricing ? applyMarkup(cashItemTotal) : cashItemTotal
          return {
          id: item.id,
          name: item.name,
          price: displayPrice,
          cashPrice: hasCardPricing ? cashPrice : undefined,
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
            price: hasCardPricing ? applyMarkup(Number(m.price)) : Number(m.price),
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

        // Financials — stored values, markup on subtotal only (pre-tax per DP1)
        subtotal,
        taxTotal: displayTaxTotal,
        taxRate,
        discountTotal,
        tipTotal: Number(order.tipTotal),
        total: roundToCents(subtotal - discountTotal + displayTaxTotal),
        // Dual pricing breakdown
        cashSubtotal: hasCardPricing ? cashSubtotal : undefined,
        cashTax: hasCardPricing ? storedTax : undefined,
        cashTotal: hasCardPricing
          ? roundToCents(cashSubtotal - discountTotal + storedTax)
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
      })
  } catch (error) {
    console.error('Failed to fetch order detail:', error)
    return err('Failed to fetch order detail', 500)
  }
})
