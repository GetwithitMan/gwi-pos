/**
 * Receipt Data Builder
 *
 * PURE function that builds the receipt response object from order and payment data.
 */

import { calculateCardPrice, calculateDebitPrice, roundToCents } from '@/lib/pricing'
import { getPricingProgram } from '@/lib/settings'
import type { PricingProgram } from '@/lib/settings'
import type { ReceiptData, ReceiptPayment } from './types'

interface ReceiptOrder {
  id: string
  orderNumber: number | null
  displayNumber: string | null
  orderType: string | null
  tabName: string | null
  guestCount: number
  subtotal: unknown
  discountTotal: unknown
  taxTotal: unknown
  taxFromInclusive?: unknown
  taxFromExclusive?: unknown
  tipTotal: unknown
  total: unknown
  convenienceFee?: unknown
  pagerNumber?: string | null
  fulfillmentMode?: string | null
  createdAt: Date
  table?: { name: string } | null
  employee?: {
    id: string
    displayName?: string | null
    firstName?: string | null
    lastName?: string | null
  } | null
  location: {
    name: string
    address: string | null
    phone: string | null
  }
  items: Array<{
    id: string
    name: string
    quantity: number
    price: unknown
    itemTotal: unknown
    specialNotes: string | null
    status: string
    modifiers?: Array<{
      id: string
      name: string
      price: unknown
      preModifier: string | null
      isCustomEntry?: boolean
      isNoneSelection?: boolean
      noneShowOnReceipt?: boolean
      customEntryName?: string | null
      customEntryPrice?: unknown
      swapTargetName?: string | null
    }>
  }>
  customer?: {
    displayName?: string | null
    firstName?: string | null
    lastName?: string | null
    loyaltyPoints?: number
    phone?: string | null
    email?: string | null
  } | null
}

interface BridgedPayment {
  paymentMethod: string
  amount: number
  tipAmount: number
  totalAmount: number
  cardBrand?: string | null
  cardLast4?: string | null
  authCode?: string | null
  amountTendered?: unknown
  changeGiven?: unknown
  pricingMode?: string
  appliedPricingTier?: string | null // 'cash' | 'debit' | 'credit'
  pricingProgramSnapshot?: string | Record<string, unknown> | null
}

/**
 * Build receipt data from order and payment records.
 */
export function buildReceiptData(
  order: ReceiptOrder,
  bridgedPayments: BridgedPayment[],
  pointsEarned: number,
  settings: Record<string, unknown>,
): ReceiptData {
  // Use historical pricing snapshot from payment time if available (Invariant #9:
  // receipts render persisted fields, never re-derive from current settings)
  const snapshotPayment = bridgedPayments.find(p => p.pricingProgramSnapshot)
  const pp: PricingProgram = snapshotPayment?.pricingProgramSnapshot
    ? (typeof snapshotPayment.pricingProgramSnapshot === 'string'
      ? JSON.parse(snapshotPayment.pricingProgramSnapshot)
      : snapshotPayment.pricingProgramSnapshot) as PricingProgram
    : getPricingProgram(settings as any)
  const employeeName = order.employee?.displayName ||
    (order.employee ? `${order.employee.firstName} ${order.employee.lastName}` : 'Unknown')

  const receiptPayments: ReceiptPayment[] = bridgedPayments.map(p => ({
    method: p.paymentMethod,
    amount: p.amount,
    tipAmount: p.tipAmount,
    totalAmount: p.totalAmount,
    cardBrand: p.cardBrand,
    cardLast4: p.cardLast4,
    authCode: p.authCode,
    amountTendered: p.amountTendered ? Number(p.amountTendered) : null,
    changeGiven: p.changeGiven ? Number(p.changeGiven) : null,
  }))

  // Dual pricing breakdown — works with both legacy dualPricing and new pricingProgram models.
  // order.total IS the cash price. Card/debit payments use a markup.
  const isDualPricing = pp.enabled && (
    pp.model === 'dual_price' || pp.model === 'dual_price_pan_debit' || pp.model === 'cash_discount'
  )

  // Determine the applied tier from the first card payment (for receipt display)
  const cardPayment = bridgedPayments.find(p =>
    p.pricingMode === 'card' || p.appliedPricingTier === 'credit' || p.appliedPricingTier === 'debit'
  )
  // Fall back to 'credit' when legacy pricingMode='card' is present but no explicit tier
  const appliedTier = (cardPayment?.appliedPricingTier
    || (cardPayment?.pricingMode === 'card' ? 'credit' : null)) as 'credit' | 'debit' | null

  // Resolve the markup percent based on which pricing tier was actually applied
  const markupPercent = (() => {
    if (!isDualPricing || !appliedTier) return 0
    if (appliedTier === 'debit') {
      return pp.debitMarkupPercent ?? 0
    }
    // credit tier (or legacy fallback)
    return pp.creditMarkupPercent ?? pp.cashDiscountPercent ?? 0
  })()

  // Calculate totals — markup applies to subtotal only, NOT tax (pre-tax per DP1 rule)
  const cashTotal = Number(order.total ?? 0)
  const total = (() => {
    if (!isDualPricing || !cardPayment || markupPercent <= 0) return cashTotal
    const cashSub = Number(order.subtotal ?? 0)
    const cardSub = appliedTier === 'debit'
      ? calculateDebitPrice(cashSub, markupPercent)
      : calculateCardPrice(cashSub, markupPercent)
    const cashTax = Number(order.taxTotal ?? 0)
    return roundToCents(cardSub + cashTax - Number(order.discountTotal ?? 0) + Number(order.tipTotal ?? 0))
  })()

  // Build dual pricing breakdown fields for the receipt template
  const dualPricingBreakdown = (() => {
    if (!isDualPricing || !cardPayment || markupPercent <= 0) return {}

    const cashSubtotal = Number(order.subtotal ?? 0)
    const cashTax = Number(order.taxTotal ?? 0)
    const cardSubtotal = appliedTier === 'debit'
      ? calculateDebitPrice(cashSubtotal, markupPercent)
      : calculateCardPrice(cashSubtotal, markupPercent)
    // Tax is NOT marked up — surcharge/markup is pre-tax per DP1 rule
    const cardTotal = roundToCents(cardSubtotal + cashTax - Number(order.discountTotal ?? 0) + Number(order.tipTotal ?? 0))

    return {
      cardSubtotal,
      cardTax: cashTax,
      cardTotal,
      cashSubtotal,
      cashTax,
      cashTotal: roundToCents(cashSubtotal + cashTax - Number(order.discountTotal ?? 0) + Number(order.tipTotal ?? 0)),
    }
  })()

  // Surcharge disclosure — include when pricing program is 'surcharge' and disclosure text is set
  const surchargeDisclosure = pp.enabled && pp.model === 'surcharge' && pp.surchargeDisclosure
    ? pp.surchargeDisclosure
    : null

  // Cash discount / dual pricing disclosure — include for cash_discount, dual_price, dual_price_pan_debit models
  const DEFAULT_CASH_DISCOUNT_DISCLOSURE =
    'Posted prices reflect a non-cash adjustment. Cash payments receive a discount.'
  const cashDiscountDisclosure = (() => {
    if (!isDualPricing) return null
    return pp.cashDiscountDisclosure || DEFAULT_CASH_DISCOUNT_DISCLOSURE
  })()

  // Convenience fee — include when order has a non-zero fee
  const convenienceFeeAmount = Number(order.convenienceFee ?? 0)
  const convenienceFeeDisclosure = (() => {
    const cf = (settings as any).convenienceFees
    return cf?.enabled && cf.disclosureText ? cf.disclosureText : null
  })()

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    displayNumber: order.displayNumber,
    orderType: order.orderType,
    tabName: order.tabName,
    tableName: order.table?.name || null,
    guestCount: order.guestCount,
    employee: {
      id: order.employee?.id ?? 'unknown',
      name: employeeName,
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
      modifiers: (item.modifiers || []).map(mod => ({
        id: mod.id,
        name: mod.name,
        price: Number(mod.price),
        preModifier: mod.preModifier,
        isCustomEntry: mod.isCustomEntry ?? false,
        isNoneSelection: mod.isNoneSelection ?? false,
        noneShowOnReceipt: mod.noneShowOnReceipt ?? false,
        customEntryName: mod.customEntryName ?? null,
        customEntryPrice: mod.customEntryPrice != null ? Number(mod.customEntryPrice) : null,
        swapTargetName: mod.swapTargetName ?? null,
      })),
    })),
    payments: receiptPayments,
    subtotal: Number(order.subtotal ?? 0),
    discountTotal: Number(order.discountTotal ?? 0),
    taxTotal: Number(order.taxTotal ?? 0),
    taxFromInclusive: Number(order.taxFromInclusive ?? 0) || undefined,
    taxFromExclusive: Number(order.taxFromExclusive ?? 0) || undefined,
    tipTotal: Number(order.tipTotal ?? 0),
    total,
    ...dualPricingBreakdown,
    createdAt: order.createdAt.toISOString(),
    paidAt: new Date().toISOString(),
    customer: order.customer ? {
      name: order.customer.displayName || `${order.customer.firstName} ${order.customer.lastName}`,
      loyaltyPoints: order.customer.loyaltyPoints ?? 0,
      phone: order.customer.phone || null,
      email: order.customer.email || null,
    } : null,
    loyaltyPointsRedeemed: null,
    loyaltyPointsEarned: pointsEarned || null,
    surchargeDisclosure,
    cashDiscountDisclosure,
    convenienceFee: convenienceFeeAmount > 0 ? convenienceFeeAmount : null,
    convenienceFeeDisclosure: convenienceFeeAmount > 0 ? convenienceFeeDisclosure : null,
    // Notification pager info
    pagerNumber: order.pagerNumber ?? null,
    fulfillmentMode: order.fulfillmentMode ?? null,
    // Donations
    donationAmount: (order as any).donationAmount != null ? Number((order as any).donationAmount) : null,
    // Tax exemption
    isTaxExempt: (order as any).isTaxExempt ?? false,
    taxExemptReason: (order as any).taxExemptReason ?? null,
    taxExemptId: (order as any).taxExemptId ?? null,
  }
}
