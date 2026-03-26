import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings, getPricingProgram } from '@/lib/settings'
import { calculateCardPrice, calculateDebitPrice, roundToCents } from '@/lib/pricing'

const DEFAULT_CASH_DISCOUNT_DISCLOSURE =
  'Posted prices reflect a non-cash adjustment. Cash payments receive a discount.'

// GET - Get receipt data for an order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    const order = await db.order.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
            settings: true,
          },
        },
        table: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            loyaltyPoints: true,
          },
        },
        items: {
          include: {
            modifiers: true,
          },
        },
        payments: {
          where: {
            status: 'completed',
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Verify location access if locationId provided
    if (locationId && order.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Order does not belong to this location' },
        { status: 403 }
      )
    }

    const settings = parseSettings(order.location.settings)
    const pp = getPricingProgram(settings)

    // Dual pricing detection — works with both legacy dualPricing and new pricingProgram models
    const isDualPricing = pp.enabled && (
      pp.model === 'dual_price' || pp.model === 'dual_price_pan_debit' || pp.model === 'cash_discount'
    )

    // Determine the applied tier from the first card payment
    const cardPayment = isDualPricing ? order.payments.find(p =>
      (p as any).pricingMode === 'card' ||
      (p as any).appliedPricingTier === 'credit' ||
      (p as any).appliedPricingTier === 'debit'
    ) : null

    const appliedTier = (
      (cardPayment as any)?.appliedPricingTier ||
      ((cardPayment as any)?.pricingMode === 'card' ? 'credit' : null)
    ) as 'credit' | 'debit' | null

    // Resolve markup percent based on which pricing tier was applied
    const markupPercent = (() => {
      if (!isDualPricing || !appliedTier) return 0
      if (appliedTier === 'debit') {
        return pp.debitMarkupPercent ?? 0
      }
      return pp.creditMarkupPercent ?? pp.cashDiscountPercent ?? 0
    })()

    // ─── Use STORED order values (never recalculate from items) ────────────────
    const cashSubtotal = Number(order.subtotal ?? 0)
    const discountTotal = Number(order.discountTotal ?? 0)
    const tipTotal = Number(order.tipTotal ?? 0)
    const convenienceFee = Number((order as any).convenienceFee ?? 0)
    const donationAmount = (order as any).donationAmount != null
      ? Number((order as any).donationAmount) : null

    // Tax: use stored values, respect tax-exempt status
    const isTaxExempt = (order as any).isTaxExempt ?? false
    const storedTaxTotal = Number(order.taxTotal ?? 0)
    const storedTaxFromInclusive = Number((order as any).taxFromInclusive ?? 0)
    const storedTaxFromExclusive = Number((order as any).taxFromExclusive ?? 0)

    const cashTax = isTaxExempt ? 0 : storedTaxTotal
    const taxFromInclusive = isTaxExempt ? 0 : storedTaxFromInclusive
    const taxFromExclusive = isTaxExempt ? 0 : storedTaxFromExclusive

    // Total: use stored value (already includes tax, discounts, etc.)
    const cashTotal = Number(order.total ?? 0)

    // Dual pricing breakdown — apply markup to stored values, same pattern as receipt-builder
    const isDualCard = isDualPricing && cardPayment && markupPercent > 0

    const applyMarkup = (amount: number): number =>
      appliedTier === 'debit'
        ? calculateDebitPrice(amount, markupPercent)
        : calculateCardPrice(amount, markupPercent)

    const dualPricingBreakdown = (() => {
      if (!isDualCard) return {}

      const cardSubtotal = applyMarkup(cashSubtotal)
      const cardTax = applyMarkup(cashTax)
      const cardTotal = applyMarkup(cashTotal)

      return {
        cardSubtotal,
        cardTax,
        cardTotal,
        cashSubtotal,
        cashTax,
        cashTotal: roundToCents(cashSubtotal + cashTax - discountTotal + tipTotal),
      }
    })()

    // Effective totals: use card-adjusted values when dual pricing applies
    const effectiveSubtotal = isDualCard ? applyMarkup(cashSubtotal) : cashSubtotal
    const effectiveTax = isDualCard ? applyMarkup(cashTax) : cashTax
    const effectiveTotal = isDualCard ? applyMarkup(cashTotal) : cashTotal

    // Surcharge disclosure
    const surchargeDisclosure = pp.enabled && pp.model === 'surcharge' && pp.surchargeDisclosure
      ? pp.surchargeDisclosure
      : null

    // Cash discount / dual pricing disclosure
    const cashDiscountDisclosure = isDualPricing
      ? (pp.cashDiscountDisclosure || DEFAULT_CASH_DISCOUNT_DISCLOSURE)
      : null

    // Convenience fee disclosure
    const convenienceFeeDisclosure = (() => {
      const cf = (settings as any).convenienceFees
      return cf?.enabled && cf.disclosureText ? cf.disclosureText : null
    })()

    // Format receipt data
    const receiptData = {
      id: order.id,
      orderNumber: order.orderNumber,
      displayNumber: order.displayNumber,
      orderType: order.orderType,
      tabName: order.tabName,
      tableName: order.table?.name || null,
      guestCount: order.guestCount,
      employee: {
        id: order.employee.id,
        name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
      },
      location: {
        name: order.location.name,
        address: order.location.address,
        phone: order.location.phone,
      },
      items: order.items.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: Number(item.price),
        itemTotal: Number(item.itemTotal),
        specialNotes: item.specialNotes,
        status: item.status,
        modifiers: item.modifiers.map(mod => ({
          id: mod.id,
          name: mod.name,
          price: Number(mod.price),
          preModifier: mod.preModifier,
        })),
      })),
      payments: order.payments.map(payment => ({
        method: payment.paymentMethod,
        amount: Number(payment.amount),
        tipAmount: Number(payment.tipAmount),
        totalAmount: Number(payment.totalAmount),
        cardBrand: payment.cardBrand,
        cardLast4: payment.cardLast4,
        authCode: payment.authCode,
        entryMethod: payment.entryMethod,
        aid: payment.aid,
        amountTendered: payment.amountTendered ? Number(payment.amountTendered) : null,
        changeGiven: payment.changeGiven ? Number(payment.changeGiven) : null,
      })),
      subtotal: effectiveSubtotal,
      discountTotal,
      taxTotal: effectiveTax,
      taxFromInclusive: taxFromInclusive || undefined,
      taxFromExclusive: taxFromExclusive || undefined,
      tipTotal,
      total: effectiveTotal,
      ...dualPricingBreakdown,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() || null,
      // Loyalty data
      customer: order.customer ? {
        name: order.customer.displayName || `${order.customer.firstName} ${order.customer.lastName}`,
        loyaltyPoints: order.customer.loyaltyPoints,
      } : null,
      // Points redeemed from loyalty_points payments
      loyaltyPointsRedeemed: order.payments
        .filter(p => p.paymentMethod === 'loyalty_points')
        .reduce((sum, p) => {
          const match = p.transactionId?.match(/LOYALTY:(\d+)pts/)
          return sum + (match ? parseInt(match[1]) : 0)
        }, 0) || null,
      loyaltyPointsEarned: order.customer?.loyaltyPoints ? Math.floor(Number(order.total)) : null,
      // Pricing disclosures
      surchargeDisclosure,
      cashDiscountDisclosure,
      // Convenience fee
      convenienceFee: convenienceFee > 0 ? convenienceFee : null,
      convenienceFeeDisclosure: convenienceFee > 0 ? convenienceFeeDisclosure : null,
      // Donations
      donationAmount,
      // Tax exemption
      isTaxExempt,
      taxExemptReason: (order as any).taxExemptReason ?? null,
      taxExemptId: (order as any).taxExemptId ?? null,
    }

    return NextResponse.json({ data: receiptData })
  } catch (error) {
    console.error('Failed to fetch receipt:', error)
    return NextResponse.json(
      { error: 'Failed to fetch receipt' },
      { status: 500 }
    )
  }
})
