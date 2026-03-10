/**
 * Combo Auto-Suggest Matcher Engine
 *
 * Pure function — no DB calls. Data is loaded by the API route and passed in.
 * Matches order items against combo templates to find potential savings.
 *
 * Algorithm:
 *   1. For each combo template, check if the order contains items
 *      that satisfy ALL required components.
 *   2. A component matches if orderItem.menuItemId === component.menuItemId
 *      OR orderItem.menuItemId is in component.options[].menuItemId.
 *   3. Calculate savings = sum(individual prices) - combo basePrice.
 *   4. Only return matches where savings > 0.
 *   5. When an item could satisfy multiple combos, pick highest savings first
 *      (greedy allocation — items used by a higher-savings combo are excluded
 *      from lower-savings combos).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface MatcherOrderItem {
  id: string
  menuItemId: string
  name: string
  price: number      // unit price (number, not Decimal)
  quantity: number
  status?: string     // 'active' | 'voided' | 'comped' | 'removed'
}

export interface MatcherComboComponent {
  id: string
  slotName: string
  displayName: string
  isRequired: boolean
  menuItemId: string | null
  options: { menuItemId: string }[]
}

export interface MatcherComboTemplate {
  id: string
  menuItemId: string   // the combo MenuItem.id
  comboName: string
  basePrice: number
  components: MatcherComboComponent[]
}

export interface ComboMatch {
  comboTemplateId: string
  comboName: string
  menuItemId: string   // the combo MenuItem.id to create as OrderItem
  matchedItems: MatcherOrderItem[]
  savings: number
  basePrice: number
}

// ── Matcher ──────────────────────────────────────────────────────────────────

/**
 * Find order items that can be converted into combo meals for savings.
 *
 * @param orderItems   Active order items (not voided/comped/removed)
 * @param comboTemplates  All active combo templates for this location
 * @returns  Array of combo matches sorted by savings descending
 */
export function findMatchingCombos(
  orderItems: MatcherOrderItem[],
  comboTemplates: MatcherComboTemplate[]
): ComboMatch[] {
  // Filter to only active items
  const activeItems = orderItems.filter(
    i => !i.status || i.status === 'active'
  )

  if (activeItems.length < 2 || comboTemplates.length === 0) return []

  // Build all potential matches with savings
  const potentialMatches: (ComboMatch & { _sortKey: number })[] = []

  for (const template of comboTemplates) {
    const requiredComponents = template.components.filter(c => c.isRequired)
    if (requiredComponents.length === 0) continue

    // For each required component, find which order items could satisfy it
    const componentCandidates: Map<string, MatcherOrderItem[]> = new Map()

    for (const comp of requiredComponents) {
      const candidates = activeItems.filter(item => {
        // Direct match on component's menuItemId
        if (comp.menuItemId && item.menuItemId === comp.menuItemId) return true
        // Match via component options (legacy multi-choice components)
        if (comp.options.some(opt => opt.menuItemId === item.menuItemId)) return true
        return false
      })
      componentCandidates.set(comp.id, candidates)
    }

    // Check if every required component has at least one candidate
    const allSatisfied = requiredComponents.every(
      comp => (componentCandidates.get(comp.id)?.length ?? 0) > 0
    )
    if (!allSatisfied) continue

    // Greedy assignment: pick one item per component (no double-use)
    const assignedItems = greedyAssign(requiredComponents, componentCandidates)
    if (!assignedItems) continue

    // Calculate savings
    const individualTotal = assignedItems.reduce((sum, item) => sum + item.price, 0)
    const savings = individualTotal - template.basePrice

    if (savings > 0) {
      potentialMatches.push({
        comboTemplateId: template.id,
        comboName: template.comboName,
        menuItemId: template.menuItemId,
        matchedItems: assignedItems,
        savings,
        basePrice: template.basePrice,
        _sortKey: savings,
      })
    }
  }

  // Sort by savings descending
  potentialMatches.sort((a, b) => b._sortKey - a._sortKey)

  // Greedy de-duplication: if the same order item is used by multiple combos,
  // the higher-savings combo wins and the lower one is excluded.
  const usedItemIds = new Set<string>()
  const result: ComboMatch[] = []

  for (const match of potentialMatches) {
    const conflict = match.matchedItems.some(item => usedItemIds.has(item.id))
    if (conflict) continue

    // Claim these items
    for (const item of match.matchedItems) {
      usedItemIds.add(item.id)
    }

    // Strip internal sort key
    const { _sortKey, ...clean } = match
    result.push(clean)
  }

  return result
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Greedy assignment of order items to combo components.
 * Each order item can only be used once.
 * Returns null if assignment is impossible.
 */
function greedyAssign(
  components: MatcherComboComponent[],
  candidateMap: Map<string, MatcherOrderItem[]>
): MatcherOrderItem[] | null {
  const assigned: MatcherOrderItem[] = []
  const usedIds = new Set<string>()

  // Sort components by number of candidates ascending (most constrained first)
  const sorted = [...components].sort((a, b) => {
    const aCandidates = candidateMap.get(a.id)?.length ?? 0
    const bCandidates = candidateMap.get(b.id)?.length ?? 0
    return aCandidates - bCandidates
  })

  for (const comp of sorted) {
    const candidates = candidateMap.get(comp.id) ?? []
    const available = candidates.filter(c => !usedIds.has(c.id))
    if (available.length === 0) return null

    // Pick the first available candidate (cheapest-item-first would be more optimal
    // but adds complexity; greedy on constrained-first is good enough for typical
    // combo sizes of 2-4 components)
    const pick = available[0]
    assigned.push(pick)
    usedIds.add(pick.id)
  }

  return assigned
}
