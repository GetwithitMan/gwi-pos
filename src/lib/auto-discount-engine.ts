/**
 * Auto-Discount Evaluation Engine
 *
 * Evaluates active DiscountRule records against an order and applies/removes
 * OrderDiscount records automatically. Called fire-and-forget after item adds
 * and order sends.
 *
 * Rule types:
 *   - bogo: Buy X get Y free/discounted
 *   - quantity: Quantity discount (e.g., 3+ items -> 10% off)
 *   - threshold: Spend threshold (e.g., $50+ -> 15% off)
 *   - time_based: Active during configured time windows (Happy Hour)
 *   - mix_match: Combine items from different categories
 *
 * Stacking logic:
 *   - Stackable rules all apply
 *   - Non-stackable rules: best-wins (highest discount amount)
 *   - isAutomatic must be true for the engine to evaluate the rule
 */

import { db } from '@/lib/db'
import { calculateOrderTotals } from '@/lib/order-calculations'
import { roundToCents } from '@/lib/pricing'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchOrderSummaryUpdated } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('auto-discount')

// ============================================================================
// TYPES
// ============================================================================

interface TriggerConfig {
  categoryIds?: string[]
  itemIds?: string[]
  menuItemIds?: string[]     // Alias for itemIds
  minQuantity?: number
  minimumAmount?: number
  quantities?: Record<string, number>  // itemId -> min quantity for mix_match
}

interface DiscountConfig {
  type: 'percent' | 'fixed' | 'fixed_price'
  value: number
  maxAmount?: number
  apply_to?: 'order' | 'cheapest_item' | 'qualifying_items'
}

interface ScheduleConfig {
  days?: number[]             // 0=Sunday, 1=Monday, ... 6=Saturday
  startTime?: string          // "HH:mm" (24h)
  endTime?: string            // "HH:mm" (24h)
  dateRange?: {
    start?: string            // ISO date
    end?: string              // ISO date
  }
}

interface EvaluationResult {
  applied: Array<{
    id: string
    name: string
    amount: number
    percent: number | null
    discountRuleId: string
  }>
  removed: string[]
}

interface OrderItemWithCategory {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  status: string | null
  categoryType: string | null
  menuItem?: {
    categoryId: string | null
  } | null
}

// ============================================================================
// MAIN EVALUATION FUNCTION
// ============================================================================

/**
 * Evaluate all active auto-discount rules against an order.
 * Creates/removes OrderDiscount records in a transaction.
 * Emits socket events for cross-terminal sync.
 */
export async function evaluateAutoDiscounts(
  orderId: string,
  locationId: string
): Promise<EvaluationResult> {
  const result: EvaluationResult = { applied: [], removed: [] }

  try {
    // 1. Load all active automatic discount rules for this location
    const rules = await db.discountRule.findMany({
      where: {
        locationId,
        isActive: true,
        isAutomatic: true,
        deletedAt: null,
      },
      orderBy: { priority: 'desc' },
    })

    if (rules.length === 0) return result

    // 2. Load the order with items + menu item category info
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        location: true,
        items: {
          where: { deletedAt: null, status: 'active' },
          include: {
            menuItem: {
              select: { id: true, categoryId: true },
            },
            modifiers: {
              where: { deletedAt: null },
              select: { price: true },
            },
          },
        },
        discounts: {
          where: { deletedAt: null },
        },
      },
    })

    if (!order) return result
    if (order.status !== 'open' && order.status !== 'draft' && order.status !== 'in_progress') {
      return result
    }

    const orderItems: OrderItemWithCategory[] = order.items.map(item => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      price: Number(item.price),
      quantity: item.quantity,
      status: item.status,
      categoryType: item.categoryType,
      menuItem: item.menuItem ? { categoryId: item.menuItem.categoryId } : null,
    }))

    const subtotal = order.items.reduce((sum, item) => {
      const modTotal = (item.modifiers || []).reduce((ms, m) => ms + Number(m.price), 0)
      return sum + ((Number(item.price) + modTotal) * item.quantity)
    }, 0)

    // Extract location timezone from settings for timezone-aware schedule evaluation
    const locationSettings = order.location.settings as Record<string, any> | null
    const locationTimezone: string | undefined = locationSettings?.timezone || undefined

    // 3. Evaluate each rule
    const matchedRules: Array<{
      rule: typeof rules[number]
      discountAmount: number
      discountPercent: number | null
    }> = []

    for (const rule of rules) {
      const triggerConfig = (rule.triggerConfig || {}) as unknown as TriggerConfig
      const discountConfig = (rule.discountConfig || {}) as unknown as DiscountConfig
      const scheduleConfig = (rule.scheduleConfig || null) as unknown as ScheduleConfig | null

      // Check schedule first (applies to all rule types)
      if (scheduleConfig && !isWithinSchedule(scheduleConfig, locationTimezone)) {
        continue
      }

      let matched = false
      let discountAmount = 0
      let discountPercent: number | null = null

      switch (rule.discountType) {
        case 'bogo':
          matched = evaluateBogo(orderItems, triggerConfig)
          break
        case 'quantity':
          matched = evaluateQuantity(orderItems, triggerConfig)
          break
        case 'threshold':
          matched = evaluateThreshold(subtotal, triggerConfig)
          break
        case 'time_based':
          // time_based rules match if schedule check passed above
          matched = true
          break
        case 'mix_match':
          matched = evaluateMixMatch(orderItems, triggerConfig)
          break
        default:
          continue
      }

      if (!matched) continue

      // Calculate discount amount
      const calculated = calculateDiscountAmount(
        subtotal,
        orderItems,
        discountConfig,
        triggerConfig
      )
      discountAmount = calculated.amount
      discountPercent = calculated.percent

      if (discountAmount <= 0) continue

      // Apply maxPerOrder cap
      if (rule.maxPerOrder) {
        const existingCount = order.discounts.filter(
          d => d.discountRuleId === rule.id && !d.isAutomatic
        ).length
        if (existingCount >= rule.maxPerOrder) continue
      }

      matchedRules.push({ rule, discountAmount, discountPercent })
    }

    // 4. Apply stacking logic
    const { toApply, toRemove } = resolveStacking(matchedRules, order.discounts)

    if (toApply.length === 0 && toRemove.length === 0) return result

    // 5. Execute in a transaction
    await db.$transaction(async (tx) => {
      // Lock the Order row to prevent concurrent auto-discount evaluations from doubling discounts
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      // Remove auto-discounts that no longer match
      for (const discountId of toRemove) {
        await tx.orderDiscount.update({
          where: { id: discountId },
          data: { deletedAt: new Date() },
        })
        result.removed.push(discountId)
      }

      // Create new auto-discounts
      for (const { rule, discountAmount, discountPercent } of toApply) {
        // Cap discount to prevent exceeding subtotal
        const currentDiscounts = order.discounts
          .filter(d => !toRemove.includes(d.id))
          .reduce((sum, d) => sum + Number(d.amount), 0)
        const cappedAmount = Math.min(
          discountAmount,
          Math.max(0, subtotal - currentDiscounts)
        )

        if (cappedAmount <= 0) continue

        const created = await tx.orderDiscount.create({
          data: {
            locationId,
            orderId,
            discountRuleId: rule.id,
            name: rule.displayText,
            amount: cappedAmount,
            percent: discountPercent,
            isAutomatic: true,
            reason: `Auto-applied: ${rule.name}`,
          },
        })

        result.applied.push({
          id: created.id,
          name: created.name,
          amount: Number(created.amount),
          percent: created.percent ? Number(created.percent) : null,
          discountRuleId: rule.id,
        })
      }

      // 6. Recalculate order totals
      const allDiscounts = await tx.orderDiscount.findMany({
        where: { orderId, deletedAt: null },
      })
      const newDiscountTotal = allDiscounts.reduce((sum, d) => sum + Number(d.amount), 0)

      const totals = calculateOrderTotals(
        order.items.filter(i => i.status === 'active' && !i.deletedAt).map(i => ({
          price: Number(i.price),
          quantity: i.quantity,
          isTaxInclusive: i.isTaxInclusive ?? false,
          status: i.status,
          modifiers: (i.modifiers ?? []).map(m => ({ price: Number(m.price) })),
          commissionAmount: Number(i.commissionAmount ?? 0),
        })),
        order.location.settings as { tax?: { defaultRate?: number } },
        newDiscountTotal,
        Number(order.tipTotal ?? 0),
        undefined, // priceRounding
        'card',
        order.isTaxExempt,
        Number(order.inclusiveTaxRate) || undefined
      )

      const autoDonation = Number(order.donationAmount || 0)
      const autoConvFee = Number(order.convenienceFee || 0)
      const autoFinalTotal = autoDonation > 0 || autoConvFee > 0
        ? roundToCents(totals.total + autoDonation + autoConvFee)
        : totals.total

      await tx.order.update({
        where: { id: orderId },
        data: {
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          taxFromInclusive: totals.taxFromInclusive,
          taxFromExclusive: totals.taxFromExclusive,
          total: autoFinalTotal,
          version: { increment: 1 },
        },
      })
    })

    // 7. Socket dispatches (fire-and-forget, outside transaction)
    if (result.applied.length > 0 || result.removed.length > 0) {
      const updatedOrder = await db.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          tableId: true,
          tabName: true,
          guestCount: true,
          employeeId: true,
          subtotal: true,
          taxTotal: true,
          discountTotal: true,
          tipTotal: true,
          total: true,
          commissionTotal: true,
          itemCount: true,
          locationId: true,
        },
      })

      if (updatedOrder) {
        void dispatchOrderTotalsUpdate(locationId, orderId, {
          subtotal: Number(updatedOrder.subtotal),
          taxTotal: Number(updatedOrder.taxTotal),
          tipTotal: Number(updatedOrder.tipTotal),
          discountTotal: Number(updatedOrder.discountTotal),
          total: Number(updatedOrder.total),
          commissionTotal: Number(updatedOrder.commissionTotal || 0),
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in auto-discount-engine'))

        void dispatchOpenOrdersChanged(locationId, {
          trigger: 'item_updated',
          orderId,
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in auto-discount-engine'))

        void dispatchOrderSummaryUpdated(locationId, {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          status: updatedOrder.status,
          tableId: updatedOrder.tableId || null,
          tableName: null,
          tabName: updatedOrder.tabName || null,
          guestCount: updatedOrder.guestCount ?? 0,
          employeeId: updatedOrder.employeeId || null,
          subtotalCents: Math.round(Number(updatedOrder.subtotal) * 100),
          taxTotalCents: Math.round(Number(updatedOrder.taxTotal) * 100),
          discountTotalCents: Math.round(Number(updatedOrder.discountTotal) * 100),
          tipTotalCents: Math.round(Number(updatedOrder.tipTotal) * 100),
          totalCents: Math.round(Number(updatedOrder.total) * 100),
          itemCount: updatedOrder.itemCount ?? 0,
          updatedAt: new Date().toISOString(),
          locationId: updatedOrder.locationId,
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in auto-discount-engine'))
      }
    }

    return result
  } catch (error) {
    log.error({ err: error }, '[AutoDiscountEngine] Evaluation failed:')
    return result
  }
}

// ============================================================================
// RULE EVALUATORS
// ============================================================================

/**
 * BOGO: Buy X get Y free/discounted.
 * Matches if order has enough qualifying items (by category or item ID)
 * to meet the minimum quantity trigger.
 */
function evaluateBogo(
  items: OrderItemWithCategory[],
  config: TriggerConfig
): boolean {
  const minQty = config.minQuantity ?? 2
  const qualifyingQty = getQualifyingQuantity(items, config)
  return qualifyingQty >= minQty
}

/**
 * Quantity discount: matches if total quantity of qualifying items >= threshold.
 */
function evaluateQuantity(
  items: OrderItemWithCategory[],
  config: TriggerConfig
): boolean {
  const minQty = config.minQuantity ?? 1
  const qualifyingQty = getQualifyingQuantity(items, config)
  return qualifyingQty >= minQty
}

/**
 * Threshold: matches if subtotal >= minimumAmount.
 */
function evaluateThreshold(
  subtotal: number,
  config: TriggerConfig
): boolean {
  const minimumAmount = config.minimumAmount ?? 0
  return subtotal >= minimumAmount
}

/**
 * Mix-and-match: matches if the order has items from multiple specified
 * categories or specific items meeting individual quantity thresholds.
 */
function evaluateMixMatch(
  items: OrderItemWithCategory[],
  config: TriggerConfig
): boolean {
  if (config.quantities) {
    // Each key is an itemId/categoryId, value is min quantity needed
    for (const [id, minQty] of Object.entries(config.quantities)) {
      const qty = items
        .filter(i => i.menuItemId === id || i.menuItem?.categoryId === id)
        .reduce((sum, i) => sum + i.quantity, 0)
      if (qty < minQty) return false
    }
    return true
  }

  // Fallback: check if items from all specified categories are present
  if (config.categoryIds && config.categoryIds.length > 0) {
    const presentCategories = new Set(
      items.map(i => i.menuItem?.categoryId).filter(Boolean)
    )
    return config.categoryIds.every(catId => presentCategories.has(catId))
  }

  return false
}

// ============================================================================
// SCHEDULE CHECKER
// ============================================================================

/**
 * Extract local time components in the given IANA timezone using Intl.DateTimeFormat.
 * Falls back to the Date object's local methods when no timezone is provided.
 */
function getLocalTimeParts(date: Date, timezone?: string): {
  dayOfWeek: number
  hour: number
  minute: number
} {
  if (!timezone) {
    return {
      dayOfWeek: date.getDay(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    }
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date)

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }

  return {
    dayOfWeek: weekdayMap[get('weekday')] ?? date.getDay(),
    hour: parseInt(get('hour'), 10) || 0,
    minute: parseInt(get('minute'), 10) || 0,
  }
}

/**
 * Check if the current moment falls within the schedule window.
 * @param timezone Optional IANA timezone (e.g. 'America/New_York') for
 *   location-aware schedule evaluation. Defaults to server local time.
 */
function isWithinSchedule(schedule: ScheduleConfig, timezone?: string): boolean {
  const now = new Date()
  const local = getLocalTimeParts(now, timezone)

  // Check day of week
  if (schedule.days && schedule.days.length > 0) {
    if (!schedule.days.includes(local.dayOfWeek)) return false
  }

  // Check date range
  if (schedule.dateRange) {
    if (schedule.dateRange.start) {
      const rangeStart = new Date(schedule.dateRange.start)
      if (now < rangeStart) return false
    }
    if (schedule.dateRange.end) {
      const rangeEnd = new Date(schedule.dateRange.end)
      if (now > rangeEnd) return false
    }
  }

  // Check time range (HH:mm format)
  if (schedule.startTime && schedule.endTime) {
    const currentMinutes = local.hour * 60 + local.minute
    const [startH, startM] = schedule.startTime.split(':').map(Number)
    const [endH, endM] = schedule.endTime.split(':').map(Number)
    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM

    if (startMinutes <= endMinutes) {
      // Normal range (e.g., 14:00-18:00)
      if (currentMinutes < startMinutes || currentMinutes > endMinutes) return false
    } else {
      // Overnight range (e.g., 22:00-02:00)
      if (currentMinutes < startMinutes && currentMinutes > endMinutes) return false
    }
  }

  return true
}

// ============================================================================
// DISCOUNT CALCULATION
// ============================================================================

/**
 * Calculate the discount dollar amount from a discount config.
 */
function calculateDiscountAmount(
  subtotal: number,
  items: OrderItemWithCategory[],
  config: DiscountConfig,
  triggerConfig: TriggerConfig
): { amount: number; percent: number | null } {
  let amount = 0
  let percent: number | null = null

  switch (config.type) {
    case 'percent': {
      percent = config.value
      if (config.apply_to === 'cheapest_item') {
        // Apply percent off the cheapest qualifying item
        const qualifying = getQualifyingItems(items, triggerConfig)
        if (qualifying.length > 0) {
          const cheapest = qualifying.reduce((min, item) =>
            item.price < min.price ? item : min
          )
          amount = roundToCents(cheapest.price * (config.value / 100))
        }
      } else if (config.apply_to === 'qualifying_items') {
        // Apply percent off all qualifying items
        const qualifying = getQualifyingItems(items, triggerConfig)
        const qualifyingTotal = qualifying.reduce(
          (sum, i) => sum + (i.price * i.quantity), 0
        )
        amount = roundToCents(qualifyingTotal * (config.value / 100))
      } else {
        // Apply to entire order subtotal
        amount = roundToCents(subtotal * (config.value / 100))
      }
      break
    }
    case 'fixed': {
      amount = config.value
      break
    }
    case 'fixed_price': {
      // Set item(s) to a fixed price — discount is the difference
      const qualifying = getQualifyingItems(items, triggerConfig)
      if (qualifying.length > 0) {
        const cheapest = qualifying.reduce((min, item) =>
          item.price < min.price ? item : min
        )
        amount = Math.max(0, cheapest.price - config.value)
      }
      break
    }
  }

  // Apply max amount cap
  if (config.maxAmount && amount > config.maxAmount) {
    amount = config.maxAmount
  }

  return { amount: roundToCents(amount), percent }
}

// ============================================================================
// STACKING RESOLVER
// ============================================================================

/**
 * Resolve stacking conflicts. Returns which rules to apply and which
 * existing auto-discounts to remove.
 */
function resolveStacking(
  matchedRules: Array<{
    rule: { id: string; name: string; isStackable: boolean; displayText: string }
    discountAmount: number
    discountPercent: number | null
  }>,
  existingDiscounts: Array<{
    id: string
    discountRuleId: string | null
    isAutomatic: boolean
    amount: any
    deletedAt: Date | null
  }>
): {
  toApply: typeof matchedRules
  toRemove: string[]
} {
  const activeAutoDiscounts = existingDiscounts.filter(
    d => d.isAutomatic && !d.deletedAt
  )

  // Identify which existing auto-discounts are from rules that no longer match
  const matchedRuleIds = new Set(matchedRules.map(m => m.rule.id))
  const toRemove: string[] = []

  for (const existing of activeAutoDiscounts) {
    if (existing.discountRuleId && !matchedRuleIds.has(existing.discountRuleId)) {
      toRemove.push(existing.id)
    }
  }

  // Determine which matched rules are already applied (skip re-applying)
  const alreadyAppliedRuleIds = new Set(
    activeAutoDiscounts
      .filter(d => d.discountRuleId && matchedRuleIds.has(d.discountRuleId))
      .map(d => d.discountRuleId!)
  )

  const newRules = matchedRules.filter(m => !alreadyAppliedRuleIds.has(m.rule.id))

  // Split into stackable and non-stackable
  const stackable = newRules.filter(m => m.rule.isStackable)
  const nonStackable = newRules.filter(m => !m.rule.isStackable)

  // For non-stackable: pick best-wins (highest discount amount)
  let bestNonStackable: typeof matchedRules = []
  if (nonStackable.length > 0) {
    const sorted = [...nonStackable].sort((a, b) => b.discountAmount - a.discountAmount)
    bestNonStackable = [sorted[0]]
  }

  // If there are existing non-stackable auto-discounts that are still matched,
  // don't add new non-stackable rules unless they're better
  const existingNonStackableAmount = activeAutoDiscounts
    .filter(d => {
      if (!d.discountRuleId) return false
      const matchedRule = matchedRules.find(m => m.rule.id === d.discountRuleId)
      return matchedRule && !matchedRule.rule.isStackable
    })
    .reduce((sum, d) => sum + Number(d.amount), 0)

  if (existingNonStackableAmount > 0 && bestNonStackable.length > 0) {
    if (bestNonStackable[0].discountAmount <= existingNonStackableAmount) {
      bestNonStackable = []
    } else {
      // Remove the existing non-stackable ones since we found a better one
      for (const existing of activeAutoDiscounts) {
        if (!existing.discountRuleId) continue
        const matchedRule = matchedRules.find(m => m.rule.id === existing.discountRuleId)
        if (matchedRule && !matchedRule.rule.isStackable && !toRemove.includes(existing.id)) {
          toRemove.push(existing.id)
        }
      }
    }
  }

  const toApply = [...stackable, ...bestNonStackable]

  return { toApply, toRemove }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get total quantity of items that match the trigger config's category/item filters.
 */
function getQualifyingQuantity(
  items: OrderItemWithCategory[],
  config: TriggerConfig
): number {
  const qualifying = getQualifyingItems(items, config)
  return qualifying.reduce((sum, i) => sum + i.quantity, 0)
}

/**
 * Get items that match the trigger config's category/item filters.
 * If no filters are specified (both categoryIds and itemIds are empty/null),
 * returns an empty array — a rule with no filters should match nothing,
 * not everything.
 */
function getQualifyingItems(
  items: OrderItemWithCategory[],
  config: TriggerConfig
): OrderItemWithCategory[] {
  const categoryIds = config.categoryIds
  const itemIds = config.itemIds || config.menuItemIds

  // No filters = no qualifying items (prevent accidental match-all)
  if ((!categoryIds || categoryIds.length === 0) && (!itemIds || itemIds.length === 0)) {
    return []
  }

  return items.filter(item => {
    if (itemIds && itemIds.includes(item.menuItemId)) return true
    if (categoryIds && item.menuItem?.categoryId && categoryIds.includes(item.menuItem.categoryId)) return true
    return false
  })
}
