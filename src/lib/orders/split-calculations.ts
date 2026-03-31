/**
 * Split-ticket pricing and tax calculations.
 *
 * Extracted from split-tickets/route.ts to keep the route handler lean.
 */
import { getLocationTaxRate, calculateSplitTax } from '@/lib/order-calculations'
import { calculateSplitTicketPricing, type OrderItemInput, type RoundingIncrement } from '@/lib/split-pricing'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An order item from the parent order (Prisma result shape). */
export type ParentOrderItem = {
  id: string
  name: string
  price: any // Prisma Decimal
  quantity: number
  itemTotal: any
  isTaxInclusive: boolean | null
  specialNotes: string | null
  seatNumber: number | null
  courseNumber: number | null
  courseStatus: string | null
  kitchenStatus: string | null
  menuItemId: string | null
  pricingRuleApplied: string | null
  modifiers: Array<{
    modifierId: string | null
    name: string
    price: any
    quantity: number | null
    preModifier: string | null
    depth: number | null
    commissionAmount: any
    linkedMenuItemId: string | null
    linkedMenuItemName: string | null
    linkedMenuItemPrice: any
    spiritTier: string | null
    linkedBottleProductId: string | null
    isCustomEntry: boolean | null
    isNoneSelection: boolean | null
    customEntryName: string | null
    customEntryPrice: any
    swapTargetName: string | null
    swapTargetItemId: string | null
    swapPricingMode: string | null
    swapEffectivePrice: any
  }>
}

export type FractionalItemEntry = {
  originalItem: ParentOrderItem
  fractionalPrice: number
  fraction: number
  labelIndex: number
  totalFractions: number
}

export interface TicketData {
  ticketIndex: number
  items: ParentOrderItem[]
  fractionalEntries: FractionalItemEntry[]
  pricing: ReturnType<typeof calculateSplitTicketPricing>
  taxFromInclusive: number
  taxFromExclusive: number
}

export interface SplitSettings {
  tax?: { defaultRate?: number; inclusiveTaxRate?: number }
  priceRounding?: { enabled?: boolean; increment?: RoundingIncrement }
}

// ---------------------------------------------------------------------------
// Fractional item pre-computation
// ---------------------------------------------------------------------------

export interface SplitItemFraction {
  ticketIndex: number
  fraction: number
}

export interface SplitItemInput {
  originalItemId: string
  fractions: SplitItemFraction[]
}

/**
 * Pre-compute fractional items per ticket from split-item definitions.
 */
export function computeFractionalItemsByTicket(
  splitItems: SplitItemInput[],
  itemMap: Map<string, ParentOrderItem>,
): Map<number, FractionalItemEntry[]> {
  const result = new Map<number, FractionalItemEntry[]>()

  for (const si of splitItems) {
    const originalItem = itemMap.get(si.originalItemId)
    if (!originalItem) continue

    const originalPrice = Number(originalItem.price) * originalItem.quantity
    const modifiersTotal = originalItem.modifiers.reduce(
      (sum, m) => sum + Number(m.price) * (m.quantity || 1), 0
    )
    const totalItemPrice = originalPrice + modifiersTotal
    const N = si.fractions.length

    let allocatedSoFar = 0
    for (let i = 0; i < si.fractions.length; i++) {
      const f = si.fractions[i]
      let fractionalPrice: number

      if (i === si.fractions.length - 1) {
        // Last fraction gets remainder to ensure exact sum
        fractionalPrice = Math.round((totalItemPrice - allocatedSoFar) * 100) / 100
      } else {
        fractionalPrice = Math.floor(totalItemPrice * f.fraction * 100) / 100
      }
      allocatedSoFar += fractionalPrice

      if (!result.has(f.ticketIndex)) {
        result.set(f.ticketIndex, [])
      }
      result.get(f.ticketIndex)!.push({
        originalItem,
        fractionalPrice,
        fraction: f.fraction,
        labelIndex: i + 1,
        totalFractions: N,
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Per-ticket pricing (discount allocation + tax split)
// ---------------------------------------------------------------------------

export interface TicketPricingInput {
  assignment: { ticketIndex: number; itemIds: string[] }
  isLastTicket: boolean
  itemMap: Map<string, ParentOrderItem>
  fractionalItemsByTicket: Map<number, FractionalItemEntry[]>
  orderDiscount: number
  orderSubtotal: number
  originalTotal: number
  previousTicketsTotal: number
  taxRate: number
  inclusiveRate: number | undefined
  roundTo: RoundingIncrement
}

export function computeTicketData(input: TicketPricingInput): TicketData {
  const {
    assignment,
    isLastTicket,
    itemMap,
    fractionalItemsByTicket,
    orderDiscount,
    orderSubtotal,
    previousTicketsTotal,
    originalTotal,
    taxRate,
    inclusiveRate,
    roundTo,
  } = input

  const ticketItems = assignment.itemIds
    .map(itemId => itemMap.get(itemId))
    .filter((item): item is ParentOrderItem => item !== undefined)

  const fractionalEntries = fractionalItemsByTicket.get(assignment.ticketIndex) || []

  // Build OrderItemInput list including both whole items and fractional items
  const orderItemInputs: OrderItemInput[] = [
    ...ticketItems.map(item => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      price: Number(item.price),
      modifiers: item.modifiers.map(mod => ({
        name: mod.name,
        price: Number(mod.price),
      })),
    })),
    // Add fractional items as virtual items for pricing calculation
    ...fractionalEntries.map(fe => ({
      id: `${fe.originalItem.id}-frac-${fe.labelIndex}`,
      name: `${fe.originalItem.name} (${fe.labelIndex}/${fe.totalFractions})`,
      quantity: 1,
      price: fe.fractionalPrice,
      modifiers: [] as { name: string; price: number }[],
    })),
  ]

  // Use calculateSplitTicketPricing for discount allocation only (not last-ticket remainder)
  const pricing = calculateSplitTicketPricing(
    orderItemInputs,
    orderDiscount,
    orderSubtotal,
    taxRate,
    roundTo,
    false,       // never isLastTicket — we handle remainder ourselves after tax override
    undefined,
    undefined
  )

  // Override single-rate tax with split-aware calculation
  let ticketInclSub = 0, ticketExclSub = 0
  for (const ti of ticketItems) {
    const mods = ti.modifiers.reduce((s, m) => s + Number(m.price), 0)
    const t = (Number(ti.price) + mods) * ti.quantity
    if (ti.isTaxInclusive) ticketInclSub += t; else ticketExclSub += t
  }
  for (const fe of fractionalEntries) {
    if (fe.originalItem.isTaxInclusive) ticketInclSub += fe.fractionalPrice
    else ticketExclSub += fe.fractionalPrice
  }

  const ticketSub = ticketInclSub + ticketExclSub
  let discIncl = 0, discExcl = 0
  if (pricing.discountTotal > 0 && ticketSub > 0) {
    discIncl = Math.round(pricing.discountTotal * (ticketInclSub / ticketSub) * 100) / 100
    discExcl = Math.round((pricing.discountTotal - discIncl) * 100) / 100
  }

  const ticketTax = calculateSplitTax(
    Math.max(0, ticketInclSub - discIncl),
    Math.max(0, ticketExclSub - discExcl),
    taxRate,
    inclusiveRate
  )

  // Override tax with split-aware values
  pricing.taxAmount = ticketTax.totalTax
  // Total = subtotal + exclusive_tax_only - discount (inclusive tax NOT added)
  let ticketTotal = Math.round((ticketSub + ticketTax.taxFromExclusive - pricing.discountTotal) * 100) / 100

  // Last ticket gets remainder to match parent total exactly
  if (isLastTicket) {
    const targetTotal = originalTotal - previousTicketsTotal
    pricing.roundingAdjustment = Math.round((targetTotal - ticketTotal) * 100) / 100
    ticketTotal = targetTotal
  } else {
    pricing.roundingAdjustment = 0
  }
  pricing.total = ticketTotal

  return {
    ticketIndex: assignment.ticketIndex,
    items: ticketItems,
    fractionalEntries,
    pricing,
    taxFromInclusive: ticketTax.taxFromInclusive,
    taxFromExclusive: ticketTax.taxFromExclusive,
  }
}

// ---------------------------------------------------------------------------
// Resolve tax settings from a location settings object
// ---------------------------------------------------------------------------

export function resolveTaxSettings(
  settings: SplitSettings | null,
  orderInclusiveTaxRate: number | undefined,
): { taxRate: number; inclusiveRate: number | undefined; roundTo: RoundingIncrement } {
  const taxRate = getLocationTaxRate(settings)
  const inclRateRaw = settings?.tax?.inclusiveTaxRate
  const inclusiveRate = orderInclusiveTaxRate
    ?? (inclRateRaw != null && Number.isFinite(inclRateRaw) && inclRateRaw > 0
      ? inclRateRaw / 100 : undefined)
  const roundTo: RoundingIncrement = settings?.priceRounding?.enabled
    ? (settings.priceRounding.increment || '0.05')
    : 'none'
  return { taxRate, inclusiveRate, roundTo }
}

// ---------------------------------------------------------------------------
// Recalculate split order totals (used by move-item and split-item actions)
// ---------------------------------------------------------------------------

export function recalcSplitTotals(
  items: Array<{ price: any; quantity: number; isTaxInclusive: boolean | null; modifiers?: Array<{ price: any; quantity?: number | null }> }>,
  taxRate: number,
  inclusiveRate: number | undefined,
): { subtotal: number; taxTotal: number; taxFromInclusive: number; taxFromExclusive: number; total: number } {
  let inclSub = 0, exclSub = 0
  for (const item of items) {
    const modTotal = (item.modifiers || []).reduce(
      (s: number, m: any) => s + Number(m.price) * (m.quantity ?? 1), 0,
    )
    const t = (Number(item.price) + modTotal) * item.quantity
    if (item.isTaxInclusive) inclSub += t; else exclSub += t
  }
  const subtotal = inclSub + exclSub
  const { taxFromInclusive, taxFromExclusive, totalTax } = calculateSplitTax(inclSub, exclSub, taxRate, inclusiveRate)
  const total = Math.round((subtotal + taxFromExclusive) * 100) / 100
  return { subtotal, taxTotal: totalTax, taxFromInclusive, taxFromExclusive, total }
}
