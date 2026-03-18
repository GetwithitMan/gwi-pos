/**
 * Receipt Data Builder
 *
 * PURE function that builds the receipt response object from order and payment data.
 */

import { calculateCardPrice } from '@/lib/pricing'
import { getPricingProgram } from '@/lib/settings'
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
  const dualPricing = (settings as any).dualPricing
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

  // For cash discount (dual pricing) model: order.total IS the cash price.
  // If any payment was charged at the card price, show the card total on the receipt.
  const total = (() => {
    if (dualPricing?.enabled) {
      const hasCardPayment = bridgedPayments.some(p => p.pricingMode === 'card')
      if (hasCardPayment) {
        return calculateCardPrice(Number(order.total ?? 0), dualPricing.cashDiscountPercent)
      }
    }
    return Number(order.total ?? 0)
  })()

  // Surcharge disclosure — include when pricing program is 'surcharge' and disclosure text is set
  const surchargeDisclosure = (() => {
    const pp = getPricingProgram(settings as any)
    return pp.enabled && pp.model === 'surcharge' && pp.surchargeDisclosure
      ? pp.surchargeDisclosure
      : null
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
  }
}
