/**
 * Upsell Evaluation Engine
 *
 * Pure function — no DB calls. All data is passed in.
 * Evaluates active upsell rules against order state and returns matching suggestions,
 * sorted by priority and limited to maxPromptsPerOrder.
 */

export interface UpsellRule {
  id: string
  name: string
  triggerType: 'item_added' | 'category_match' | 'order_total' | 'time_of_day' | 'no_drink'
  triggerItemId: string | null
  triggerCategoryId: string | null
  triggerMinTotal: number | null
  triggerTimeStart: string | null     // HH:MM
  triggerTimeEnd: string | null       // HH:MM
  triggerDaysOfWeek: number[] | null  // 0-6 Sun-Sat
  suggestItemId: string | null
  suggestCategoryId: string | null
  message: string
  priority: number
  isActive: boolean
}

export interface OrderItemForUpsell {
  menuItemId: string
  categoryId: string
  categoryType: string | null  // 'food', 'drinks', 'liquor', etc.
  name: string
  price: number
}

export interface SuggestableItem {
  id: string
  name: string
  price: number
  categoryId: string
}

export interface UpsellSuggestion {
  ruleId: string
  ruleName: string
  suggestItemId: string
  suggestItemName: string
  suggestItemPrice: number
  message: string
  priority: number
}

export interface UpsellSettings {
  maxPromptsPerOrder: number
}

/**
 * Evaluate upsell rules against the current order state.
 *
 * @param orderItems  - Items currently in the order
 * @param orderTotal  - Current order subtotal
 * @param rules       - Active upsell rules for this location
 * @param suggestableItems - Map of itemId => item details for suggested items
 * @param categoryItems - Map of categoryId => items in that category (for category suggestions)
 * @param settings    - Upsell settings (maxPromptsPerOrder)
 * @param dismissedRuleIds - Rules dismissed in this session (for cooldown)
 * @returns Matching suggestions, sorted by priority desc, limited to maxPromptsPerOrder
 */
export function evaluateUpsells(
  orderItems: OrderItemForUpsell[],
  orderTotal: number,
  rules: UpsellRule[],
  suggestableItems: Map<string, SuggestableItem>,
  categoryItems: Map<string, SuggestableItem[]>,
  settings: UpsellSettings,
  dismissedRuleIds: Set<string> = new Set()
): UpsellSuggestion[] {
  if (orderItems.length === 0 || rules.length === 0) return []

  const orderItemIds = new Set(orderItems.map(i => i.menuItemId))
  const orderCategoryIds = new Set(orderItems.map(i => i.categoryId))
  const orderCategoryTypes = new Set(orderItems.map(i => i.categoryType).filter((t): t is string => t != null))

  const suggestions: UpsellSuggestion[] = []

  for (const rule of rules) {
    if (!rule.isActive) continue
    if (dismissedRuleIds.has(rule.id)) continue

    // Check trigger condition
    if (!matchesTrigger(rule, orderItems, orderItemIds, orderCategoryIds, orderCategoryTypes, orderTotal)) {
      continue
    }

    // Resolve the suggested item
    const suggestion = resolveSuggestion(rule, suggestableItems, categoryItems, orderItemIds)
    if (!suggestion) continue

    suggestions.push(suggestion)
  }

  // Sort by priority descending (higher priority first), then by name for stable order
  suggestions.sort((a, b) => b.priority - a.priority || a.suggestItemName.localeCompare(b.suggestItemName))

  // Limit to maxPromptsPerOrder
  return suggestions.slice(0, settings.maxPromptsPerOrder)
}

function matchesTrigger(
  rule: UpsellRule,
  orderItems: OrderItemForUpsell[],
  orderItemIds: Set<string>,
  orderCategoryIds: Set<string>,
  orderCategoryTypes: Set<string>,
  orderTotal: number
): boolean {
  switch (rule.triggerType) {
    case 'item_added':
      // Trigger when a specific item is in the order
      return rule.triggerItemId != null && orderItemIds.has(rule.triggerItemId)

    case 'category_match':
      // Trigger when any item from a specific category is in the order
      return rule.triggerCategoryId != null && orderCategoryIds.has(rule.triggerCategoryId)

    case 'order_total':
      // Trigger when order total meets or exceeds a threshold
      return rule.triggerMinTotal != null && orderTotal >= rule.triggerMinTotal

    case 'time_of_day':
      // Trigger during a specific time window
      return matchesTimeOfDay(rule)

    case 'no_drink':
      // Trigger when order has food but no drinks/liquor
      return hasFoodNoDrinks(orderCategoryTypes)

    default:
      return false
  }
}

function matchesTimeOfDay(rule: UpsellRule): boolean {
  if (!rule.triggerTimeStart || !rule.triggerTimeEnd) return false

  const now = new Date()
  const currentDay = now.getDay()

  // Check day-of-week filter if set
  if (rule.triggerDaysOfWeek && rule.triggerDaysOfWeek.length > 0) {
    if (!rule.triggerDaysOfWeek.includes(currentDay)) return false
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [startH, startM] = rule.triggerTimeStart.split(':').map(Number)
  const [endH, endM] = rule.triggerTimeEnd.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  // Handle overnight windows (e.g. 22:00 - 02:00)
  if (endMinutes < startMinutes) {
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes
  }

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes
}

function hasFoodNoDrinks(categoryTypes: Set<string>): boolean {
  const hasFood = categoryTypes.has('food') || categoryTypes.has('combos')
  const hasDrinks = categoryTypes.has('drinks') || categoryTypes.has('liquor')
  return hasFood && !hasDrinks
}

function resolveSuggestion(
  rule: UpsellRule,
  suggestableItems: Map<string, SuggestableItem>,
  categoryItems: Map<string, SuggestableItem[]>,
  orderItemIds: Set<string>
): UpsellSuggestion | null {
  // Direct item suggestion
  if (rule.suggestItemId) {
    // Don't suggest items already in the order
    if (orderItemIds.has(rule.suggestItemId)) return null

    const item = suggestableItems.get(rule.suggestItemId)
    if (!item) return null

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      suggestItemId: item.id,
      suggestItemName: item.name,
      suggestItemPrice: item.price,
      message: rule.message,
      priority: rule.priority,
    }
  }

  // Category suggestion — pick the first item not already in the order
  if (rule.suggestCategoryId) {
    const items = categoryItems.get(rule.suggestCategoryId) || []
    const candidate = items.find(i => !orderItemIds.has(i.id))
    if (!candidate) return null

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      suggestItemId: candidate.id,
      suggestItemName: candidate.name,
      suggestItemPrice: candidate.price,
      message: rule.message,
      priority: rule.priority,
    }
  }

  return null
}
