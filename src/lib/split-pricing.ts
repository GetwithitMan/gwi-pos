// Split Ticket Pricing - Skill 93
// Hybrid pricing strategy: proportional discounts, nickel rounding, remainder bucket

import { roundPrice } from './pricing'

// ============================================
// Types
// ============================================

export interface SplitItem {
  id: string
  name: string
  quantity: number
  basePrice: number           // Original item price
  modifierTotal: number       // Sum of modifier prices
  itemDiscountAmount: number  // Per-item discount (comps, etc.)
  proportionalDiscount: number // Share of order-level discount
  adjustedPrice: number       // Final price after all discounts
}

export interface SplitPricingResult {
  items: SplitItem[]
  subtotal: number           // Sum of base prices + modifiers
  itemDiscounts: number      // Sum of per-item discounts
  proportionalDiscount: number // Order-level discount allocated
  discountTotal: number      // Total discounts
  taxAmount: number
  total: number
  roundingAdjustment: number // Adjustment applied (for last ticket)
}

export interface OrderItemInput {
  id: string
  name: string
  quantity: number
  price: number              // Unit price
  modifiers?: Array<{
    name: string
    price: number
  }>
  itemDiscount?: number      // Per-item discount amount
}

export type RoundingIncrement = 'none' | '0.05' | '0.10' | '0.25' | '0.50' | '1.00'

// ============================================
// Proportional Discount Calculation
// ============================================

/**
 * Calculate each item's share of an order-level discount
 *
 * @param items - Order items with prices
 * @param orderDiscount - Total order-level discount to distribute
 * @param orderSubtotal - Total subtotal of order (for ratio calculation)
 * @returns Map of itemId -> proportional discount amount
 */
export function calculateProportionalDiscount(
  items: OrderItemInput[],
  orderDiscount: number,
  orderSubtotal: number
): Map<string, number> {
  const discountMap = new Map<string, number>()

  if (orderDiscount <= 0 || orderSubtotal <= 0) {
    items.forEach(item => discountMap.set(item.id, 0))
    return discountMap
  }

  items.forEach(item => {
    const itemTotal = getItemTotal(item)
    const ratio = itemTotal / orderSubtotal
    const proportionalAmount = orderDiscount * ratio
    discountMap.set(item.id, proportionalAmount)
  })

  return discountMap
}

/**
 * Get total price for an item including modifiers
 */
function getItemTotal(item: OrderItemInput): number {
  const modifierTotal = item.modifiers?.reduce((sum, m) => sum + m.price, 0) || 0
  return (item.price + modifierTotal) * item.quantity
}

// ============================================
// Split Ticket Pricing
// ============================================

/**
 * Calculate pricing for a single split ticket
 *
 * @param items - Items assigned to this ticket
 * @param orderDiscount - Total order-level discount
 * @param orderSubtotal - Original order subtotal (for proportional calculation)
 * @param taxRate - Tax rate as decimal (e.g., 0.08 for 8%)
 * @param roundTo - Rounding increment
 * @param isLastTicket - Whether this is the last ticket (receives remainder)
 * @param expectedTotal - Total of all tickets (for remainder calculation on last ticket)
 * @param previousTicketsTotal - Sum of all previous tickets' totals
 */
export function calculateSplitTicketPricing(
  items: OrderItemInput[],
  orderDiscount: number,
  orderSubtotal: number,
  taxRate: number,
  roundTo: RoundingIncrement = '0.05',
  isLastTicket: boolean = false,
  expectedTotal?: number,
  previousTicketsTotal?: number
): SplitPricingResult {
  // Calculate proportional discounts for each item
  const proportionalDiscounts = calculateProportionalDiscount(items, orderDiscount, orderSubtotal)

  // Build split items with pricing
  const splitItems: SplitItem[] = items.map(item => {
    const modifierTotal = item.modifiers?.reduce((sum, m) => sum + m.price, 0) || 0
    const basePrice = (item.price + modifierTotal) * item.quantity
    const itemDiscountAmount = item.itemDiscount || 0
    const proportionalDiscount = proportionalDiscounts.get(item.id) || 0

    // Apply rounding to the adjusted price
    const rawAdjustedPrice = basePrice - itemDiscountAmount - proportionalDiscount
    const adjustedPrice = roundPrice(rawAdjustedPrice, roundTo, 'nearest')

    return {
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      basePrice,
      modifierTotal,
      itemDiscountAmount,
      proportionalDiscount,
      adjustedPrice: Math.max(0, adjustedPrice), // Ensure non-negative
    }
  })

  // Calculate totals
  const subtotal = splitItems.reduce((sum, item) => sum + item.basePrice, 0)
  const itemDiscounts = splitItems.reduce((sum, item) => sum + item.itemDiscountAmount, 0)
  const proportionalDiscountTotal = splitItems.reduce((sum, item) => sum + item.proportionalDiscount, 0)
  const discountTotal = itemDiscounts + proportionalDiscountTotal

  // Calculate adjusted subtotal (after discounts)
  const adjustedSubtotal = splitItems.reduce((sum, item) => sum + item.adjustedPrice, 0)

  // Calculate tax
  const rawTax = adjustedSubtotal * taxRate
  const taxAmount = roundPrice(rawTax, roundTo, 'nearest')

  // Calculate total before remainder adjustment
  let total = roundPrice(adjustedSubtotal + taxAmount, roundTo, 'nearest')
  let roundingAdjustment = 0

  // If this is the last ticket and we have expected total, apply remainder
  if (isLastTicket && expectedTotal !== undefined && previousTicketsTotal !== undefined) {
    const targetTotal = expectedTotal - previousTicketsTotal
    roundingAdjustment = targetTotal - total
    total = targetTotal
  }

  return {
    items: splitItems,
    subtotal,
    itemDiscounts,
    proportionalDiscount: proportionalDiscountTotal,
    discountTotal,
    taxAmount,
    total,
    roundingAdjustment,
  }
}

// ============================================
// Multi-Ticket Split Calculation
// ============================================

export interface TicketAssignment {
  ticketIndex: number
  items: OrderItemInput[]
}

export interface MultiSplitResult {
  tickets: Array<{
    ticketIndex: number
    displayNumber: string
    pricing: SplitPricingResult
  }>
  originalSubtotal: number
  originalDiscount: number
  originalTax: number
  originalTotal: number
  totalAfterSplit: number
  balanceCorrect: boolean
}

/**
 * Calculate pricing for all split tickets from an order
 *
 * @param baseOrderNumber - Original order number (e.g., "30")
 * @param assignments - Items assigned to each ticket
 * @param orderDiscount - Total order-level discount
 * @param taxRate - Tax rate as decimal
 * @param roundTo - Rounding increment
 */
export function calculateMultiSplitPricing(
  baseOrderNumber: string,
  assignments: TicketAssignment[],
  orderDiscount: number,
  taxRate: number,
  roundTo: RoundingIncrement = '0.05'
): MultiSplitResult {
  // Calculate original order totals
  const allItems = assignments.flatMap(a => a.items)
  const originalSubtotal = allItems.reduce((sum, item) => sum + getItemTotal(item), 0)
  const itemDiscounts = allItems.reduce((sum, item) => sum + (item.itemDiscount || 0), 0)
  const adjustedSubtotal = originalSubtotal - itemDiscounts - orderDiscount
  const originalTax = roundPrice(adjustedSubtotal * taxRate, roundTo, 'nearest')
  const originalTotal = roundPrice(adjustedSubtotal + originalTax, roundTo, 'nearest')

  // Sort assignments by ticket index
  const sortedAssignments = [...assignments].sort((a, b) => a.ticketIndex - b.ticketIndex)

  // Calculate each ticket's pricing
  const tickets: MultiSplitResult['tickets'] = []
  let previousTicketsTotal = 0

  sortedAssignments.forEach((assignment, idx) => {
    const isLastTicket = idx === sortedAssignments.length - 1

    const pricing = calculateSplitTicketPricing(
      assignment.items,
      orderDiscount,
      originalSubtotal,
      taxRate,
      roundTo,
      isLastTicket,
      originalTotal,
      previousTicketsTotal
    )

    tickets.push({
      ticketIndex: assignment.ticketIndex,
      displayNumber: `${baseOrderNumber}-${assignment.ticketIndex}`,
      pricing,
    })

    previousTicketsTotal += pricing.total
  })

  // Verify balance
  const totalAfterSplit = tickets.reduce((sum, t) => sum + t.pricing.total, 0)
  const balanceCorrect = Math.abs(totalAfterSplit - originalTotal) < 0.01

  return {
    tickets,
    originalSubtotal,
    originalDiscount: orderDiscount,
    originalTax,
    originalTotal,
    totalAfterSplit,
    balanceCorrect,
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Split an amount evenly across N parts with remainder to last part
 *
 * @param total - Amount to split
 * @param parts - Number of parts
 * @param roundTo - Rounding increment
 * @returns Array of amounts (last includes remainder)
 */
export function splitAmountEvenly(
  total: number,
  parts: number,
  roundTo: RoundingIncrement = '0.05'
): number[] {
  if (parts <= 0) return []
  if (parts === 1) return [total]

  const baseAmount = roundPrice(total / parts, roundTo, 'down')
  const amounts = Array(parts - 1).fill(baseAmount)

  // Last part gets the remainder
  const usedAmount = baseAmount * (parts - 1)
  const lastAmount = roundPrice(total - usedAmount, roundTo, 'nearest')
  amounts.push(lastAmount)

  return amounts
}

/**
 * Validate that split assignments include all order items
 */
export function validateSplitAssignments(
  allItemIds: string[],
  assignments: TicketAssignment[]
): { valid: boolean; missingItems: string[]; duplicateItems: string[] } {
  const assignedIds = new Set<string>()
  const duplicates: string[] = []

  assignments.forEach(assignment => {
    assignment.items.forEach(item => {
      if (assignedIds.has(item.id)) {
        duplicates.push(item.id)
      }
      assignedIds.add(item.id)
    })
  })

  const missingItems = allItemIds.filter(id => !assignedIds.has(id))

  return {
    valid: missingItems.length === 0 && duplicates.length === 0,
    missingItems,
    duplicateItems: duplicates,
  }
}
