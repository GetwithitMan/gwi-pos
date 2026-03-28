import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_UPSELL_PROMPTS } from '@/lib/settings'
import { evaluateUpsells, type UpsellRule, type OrderItemForUpsell, type SuggestableItem } from '@/lib/upsell-engine'
import { err, ok } from '@/lib/api-response'

interface RuleRow {
  id: string
  name: string
  triggerType: string
  triggerItemId: string | null
  triggerCategoryId: string | null
  triggerMinTotal: string | null
  triggerTimeStart: string | null
  triggerTimeEnd: string | null
  triggerDaysOfWeek: number[] | null
  suggestItemId: string | null
  suggestCategoryId: string | null
  message: string
  priority: number
  isActive: boolean
}

interface OrderItemRow {
  menuItemId: string
  categoryId: string
  categoryType: string | null
  itemName: string
  price: string
  quantity: number
}

interface MenuItemRow {
  id: string
  name: string
  basePrice: string
  categoryId: string
}

// GET — Evaluate upsell suggestions for an order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const locationId = await getLocationId()

    if (!locationId) {
      return err('No location found')
    }

    // Load settings
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = mergeWithDefaults(location?.settings as Record<string, unknown> | null)
    const upsellSettings = settings.upsellPrompts ?? DEFAULT_UPSELL_PROMPTS

    if (!upsellSettings.enabled) {
      return ok({ suggestions: [] })
    }

    // Load active rules for this location
    const ruleRows = await db.$queryRawUnsafe<RuleRow[]>(`
      SELECT "id", "name", "triggerType", "triggerItemId", "triggerCategoryId",
             "triggerMinTotal", "triggerTimeStart", "triggerTimeEnd", "triggerDaysOfWeek",
             "suggestItemId", "suggestCategoryId", "message", "priority", "isActive"
      FROM "UpsellRule"
      WHERE "locationId" = $1 AND "isActive" = true AND "deletedAt" IS NULL
      ORDER BY "priority" DESC
    `, locationId)

    if (ruleRows.length === 0) {
      return ok({ suggestions: [] })
    }

    // Load order items with category info
    const orderItemRows = await db.$queryRawUnsafe<OrderItemRow[]>(`
      SELECT oi."menuItemId", mi."categoryId", c."categoryType",
             mi."name" as "itemName", oi."price", oi."quantity"
      FROM "OrderItem" oi
      JOIN "MenuItem" mi ON oi."menuItemId" = mi."id"
      JOIN "Category" c ON mi."categoryId" = c."id"
      WHERE oi."orderId" = $1 AND oi."voidedAt" IS NULL
    `, orderId)

    if (orderItemRows.length === 0) {
      return ok({ suggestions: [] })
    }

    // Calculate order total from items
    const orderTotal = orderItemRows.reduce(
      (sum, r) => sum + Number(r.price) * r.quantity,
      0
    )

    // Convert to engine format
    const orderItems: OrderItemForUpsell[] = orderItemRows.map(r => ({
      menuItemId: r.menuItemId,
      categoryId: r.categoryId,
      categoryType: r.categoryType,
      name: r.itemName,
      price: Number(r.price),
    }))

    // Collect all suggestItemIds and suggestCategoryIds from rules
    const suggestItemIds = ruleRows
      .map(r => r.suggestItemId)
      .filter((id): id is string => id != null)
    const suggestCategoryIds = ruleRows
      .map(r => r.suggestCategoryId)
      .filter((id): id is string => id != null)

    // Load suggested items
    const suggestableItems = new Map<string, SuggestableItem>()
    if (suggestItemIds.length > 0) {
      const itemRows = await db.$queryRawUnsafe<MenuItemRow[]>(`
        SELECT "id", "name", "basePrice", "categoryId"
        FROM "MenuItem"
        WHERE "id" = ANY($1::text[]) AND "deletedAt" IS NULL AND "isActive" = true
      `, suggestItemIds)
      for (const row of itemRows) {
        suggestableItems.set(row.id, {
          id: row.id,
          name: row.name,
          price: Number(row.basePrice),
          categoryId: row.categoryId,
        })
      }
    }

    // Load category items for category-based suggestions
    const categoryItems = new Map<string, SuggestableItem[]>()
    if (suggestCategoryIds.length > 0) {
      const catItemRows = await db.$queryRawUnsafe<MenuItemRow[]>(`
        SELECT "id", "name", "basePrice", "categoryId"
        FROM "MenuItem"
        WHERE "categoryId" = ANY($1::text[]) AND "deletedAt" IS NULL AND "isActive" = true
        ORDER BY "sortOrder" ASC, "name" ASC
        LIMIT 20
      `, suggestCategoryIds)
      for (const row of catItemRows) {
        const item: SuggestableItem = {
          id: row.id,
          name: row.name,
          price: Number(row.basePrice),
          categoryId: row.categoryId,
        }
        if (!categoryItems.has(row.categoryId)) {
          categoryItems.set(row.categoryId, [])
        }
        categoryItems.get(row.categoryId)!.push(item)
      }
    }

    // Convert rules to engine format
    const rules: UpsellRule[] = ruleRows.map(r => ({
      ...r,
      triggerType: r.triggerType as UpsellRule['triggerType'],
      triggerMinTotal: r.triggerMinTotal != null ? Number(r.triggerMinTotal) : null,
    }))

    // Check for recently dismissed rules (within cooldown)
    const dismissedRuleIds = new Set<string>()
    if (upsellSettings.dismissCooldownMinutes > 0) {
      const cooldownRows = await db.$queryRawUnsafe<{ upsellRuleId: string }[]>(`
        SELECT DISTINCT "upsellRuleId"
        FROM "UpsellEvent"
        WHERE "orderId" = $1 AND "action" = 'dismissed'
          AND "createdAt" > NOW() - INTERVAL '1 minute' * $2
      `, orderId, upsellSettings.dismissCooldownMinutes)
      for (const row of cooldownRows) {
        dismissedRuleIds.add(row.upsellRuleId)
      }
    } else {
      // Even without cooldown, skip rules already shown-and-dismissed for this order
      const dismissedRows = await db.$queryRawUnsafe<{ upsellRuleId: string }[]>(`
        SELECT DISTINCT "upsellRuleId"
        FROM "UpsellEvent"
        WHERE "orderId" = $1 AND "action" = 'dismissed'
      `, orderId)
      for (const row of dismissedRows) {
        dismissedRuleIds.add(row.upsellRuleId)
      }
    }

    // Also skip rules already accepted for this order
    const acceptedRows = await db.$queryRawUnsafe<{ upsellRuleId: string }[]>(`
      SELECT DISTINCT "upsellRuleId"
      FROM "UpsellEvent"
      WHERE "orderId" = $1 AND "action" = 'accepted'
    `, orderId)
    for (const row of acceptedRows) {
      dismissedRuleIds.add(row.upsellRuleId)
    }

    const suggestions = evaluateUpsells(
      orderItems,
      orderTotal,
      rules,
      suggestableItems,
      categoryItems,
      { maxPromptsPerOrder: upsellSettings.maxPromptsPerOrder },
      dismissedRuleIds,
    )

    return ok({ suggestions })
  } catch (error) {
    console.error('Failed to evaluate upsell suggestions:', error)
    return err('Failed to evaluate upsell suggestions', 500)
  }
})
