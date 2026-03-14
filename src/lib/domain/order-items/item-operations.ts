/**
 * Order Item Operations — ORCHESTRATION
 *
 * DB-accessing functions for creating, updating, and removing order items.
 * Takes TxClient — runs inside caller's transaction.
 */

import type { TxClient, AddItemInput, ItemPrepData } from './types'
import { isValidModifierId, calculateItemCardPrice } from './item-calculations'
import { getBestPricingRuleForItem } from '@/lib/settings'
import type { PricingRule, PricingAdjustment } from '@/lib/settings'

// ─── Create Order Item ──────────────────────────────────────────────────────

export interface CreateOrderItemParams {
  orderId: string
  locationId: string
  prepData: ItemPrepData
  dualPricingEnabled: boolean
  cashDiscountPct: number
  requestingEmployeeId: string | null
  hasSentItems: boolean
  idempotencyKey: string | null
  pricingRules?: PricingRule[]
}

/**
 * Create a single order item with its modifiers, ingredient modifications,
 * and pizza data within a transaction.
 *
 * Returns the created item with includes.
 */
export async function createOrderItem(
  tx: TxClient,
  params: CreateOrderItemParams
): Promise<any> {
  const {
    orderId,
    locationId,
    prepData,
    dualPricingEnabled,
    cashDiscountPct,
    requestingEmployeeId,
    hasSentItems,
    idempotencyKey,
    pricingRules,
  } = params
  const { item, effectivePrice, fullItemTotal, itemCommission, menuItem, catType, itemTaxInclusive } = prepData

  // Apply pricing rule (catalog-priced items only, skip manual/open price overrides)
  let finalPrice = effectivePrice
  let pricingRuleApplied: PricingAdjustment | null = null
  const isManualPrice = item.pricingOptionId || item.soldByWeight || item.blockTimeMinutes || item.pizzaConfig
  if (!isManualPrice && pricingRules?.length) {
    const catId = menuItem?.categoryId || ''
    pricingRuleApplied = getBestPricingRuleForItem(
      pricingRules, item.menuItemId, catId, effectivePrice
    )
    if (pricingRuleApplied) {
      finalPrice = pricingRuleApplied.adjustedPrice
    }
  }

  const createdItem = await tx.orderItem.create({
    data: {
      orderId,
      locationId,
      menuItemId: item.menuItemId,
      name: item.name || menuItem?.name || item.menuItemId,
      price: finalPrice,
      cardPrice: calculateItemCardPrice(finalPrice, dualPricingEnabled, cashDiscountPct),
      isTaxInclusive: itemTaxInclusive,
      categoryType: catType,
      quantity: item.quantity,
      pourSize: item.pourSize ?? null,
      pourMultiplier: item.pourMultiplier ?? null,
      itemTotal: fullItemTotal,
      commissionAmount: itemCommission,
      addedByEmployeeId: requestingEmployeeId || null,
      specialNotes: item.specialNotes || null,
      seatNumber: item.seatNumber || null,
      courseNumber: item.courseNumber || null,
      isHeld: item.isHeld || false,
      delayMinutes: item.delayMinutes || null,
      kitchenStatus: hasSentItems ? 'pending' : undefined,
      blockTimeMinutes: item.blockTimeMinutes || null,
      idempotencyKey: idempotencyKey || null,
      soldByWeight: item.soldByWeight || false,
      weight: item.weight ?? null,
      weightUnit: item.weightUnit ?? null,
      unitPrice: item.unitPrice ?? null,
      grossWeight: item.grossWeight ?? null,
      tareWeight: item.tareWeight ?? null,
      pricingOptionId: item.pricingOptionId ?? null,
      pricingOptionLabel: item.pricingOptionLabel ?? null,
      ...(pricingRuleApplied ? { pricingRuleApplied: pricingRuleApplied as object } : {}),
      lastMutatedBy: 'local',
      // Modifiers
      modifiers: item.modifiers?.length ? {
        create: item.modifiers.map(mod => ({
          locationId,
          modifierId: isValidModifierId(mod.modifierId) ? mod.modifierId : null,
          name: mod.name,
          price: mod.price,
          quantity: 1,
          preModifier: mod.preModifier || null,
          depth: mod.depth || 0,
          spiritTier: mod.spiritTier || null,
          linkedBottleProductId: mod.linkedBottleProductId || null,
        })),
      } : undefined,
      // Ingredient modifications
      ingredientModifications: item.ingredientModifications && item.ingredientModifications.length > 0
        ? {
            create: item.ingredientModifications.map(ing => ({
              locationId,
              ingredientId: ing.ingredientId,
              ingredientName: ing.name,
              modificationType: ing.modificationType,
              priceAdjustment: ing.priceAdjustment || 0,
              swappedToModifierId: ing.swappedTo?.modifierId || null,
              swappedToModifierName: ing.swappedTo?.name || null,
            })),
          }
        : undefined,
      // Pizza data — resolve modifier IDs to Pizza* table IDs
      pizzaData: item.pizzaConfig
        ? await resolvePizzaData(tx, item.pizzaConfig, locationId)
        : undefined,
    },
    include: {
      modifiers: true,
      ingredientModifications: true,
      pizzaData: true,
    },
  })

  return { ...createdItem, correlationId: item.correlationId }
}

// ─── Pizza Data Resolution ──────────────────────────────────────────────────

/**
 * Resolve pizza config modifier IDs to Pizza* table IDs.
 * Android sends modifier IDs (e.g. "mod-mg-size-pizza-custom-medium")
 * but OrderItemPizza FK requires PizzaSize/PizzaCrust/etc. table IDs.
 */
async function resolvePizzaData(
  tx: TxClient,
  pizzaConfig: NonNullable<AddItemInput['pizzaConfig']>,
  locationId: string
): Promise<{ create: any } | undefined> {
  const pc = pizzaConfig
  const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

  const resolvePizzaId = async (
    clientId: string | undefined | null,
    table: 'pizzaSize' | 'pizzaCrust' | 'pizzaSauce' | 'pizzaCheese'
  ): Promise<string | null> => {
    if (!clientId) return null
    // Try direct match first (client sent a Pizza* table ID)
    const direct = await (tx[table] as any).findUnique({ where: { id: clientId }, select: { id: true } })
    if (direct) return direct.id
    // Fall back: resolve via Modifier name -> Pizza* name match
    const mod = await tx.modifier.findUnique({ where: { id: clientId }, select: { name: true } })
    if (!mod?.name) return null
    // Get all records for this location and fuzzy-match
    const allRecords = await (tx[table] as any).findMany({
      where: { locationId },
      select: { id: true, name: true },
    })
    const modNorm = normalize(mod.name)
    const modBase = modNorm.replace(/\s*\(.*\)$/, '').replace(/\s+(crust|sauce|cheese)$/, '')
    for (const rec of allRecords) {
      const recNorm = normalize(rec.name)
      if (modNorm === recNorm || modBase === recNorm) return rec.id
      if (modNorm.includes(recNorm) || modBase.includes(recNorm)) return rec.id
      if (recNorm.includes(modBase) && modBase.length >= 3) return rec.id
    }
    return null
  }

  const resolvedSizeId = await resolvePizzaId(pc.sizeId, 'pizzaSize')
  const resolvedCrustId = await resolvePizzaId(pc.crustId, 'pizzaCrust')
  const resolvedSauceId = await resolvePizzaId(pc.sauceId, 'pizzaSauce')
  const resolvedCheeseId = await resolvePizzaId(pc.cheeseId, 'pizzaCheese')

  if (!resolvedSizeId || !resolvedCrustId) {
    console.warn(`[Pizza] Could not resolve size(${pc.sizeId}->${resolvedSizeId}) or crust(${pc.crustId}->${resolvedCrustId}) — skipping pizzaData`)
    return undefined
  }

  return {
    create: {
      location: { connect: { id: locationId } },
      size: { connect: { id: resolvedSizeId } },
      crust: { connect: { id: resolvedCrustId } },
      sauce: resolvedSauceId ? { connect: { id: resolvedSauceId } } : undefined,
      cheese: resolvedCheeseId ? { connect: { id: resolvedCheeseId } } : undefined,
      sauceAmount: pc.sauceAmount || 'regular',
      cheeseAmount: pc.cheeseAmount || 'regular',
      toppingsData: {
        toppings: pc.toppings,
        sauces: pc.sauces,
        cheeses: pc.cheeses,
      } as object,
      cookingInstructions: pc.cookingInstructions || null,
      cutStyle: pc.cutStyle || null,
      totalPrice: pc.totalPrice,
      sizePrice: pc.priceBreakdown.sizePrice,
      crustPrice: pc.priceBreakdown.crustPrice,
      saucePrice: pc.priceBreakdown.saucePrice,
      cheesePrice: pc.priceBreakdown.cheesePrice,
      toppingsPrice: pc.priceBreakdown.toppingsPrice,
    },
  }
}

// ─── Soft Delete Item ───────────────────────────────────────────────────────

/**
 * Soft-delete an order item and its modifiers (preserve audit trail).
 */
export async function softDeleteOrderItem(
  tx: TxClient,
  itemId: string
): Promise<void> {
  const now = new Date()
  await tx.orderItemModifier.updateMany({
    where: { orderItemId: itemId },
    data: { deletedAt: now },
  })
  await tx.orderItem.update({
    where: { id: itemId },
    data: { deletedAt: now, status: 'removed' },
  })
}

// ─── Fetch Active Modifier Total ────────────────────────────────────────────

/**
 * Fetch active modifiers for an item and calculate their total price.
 * Used when quantity changes to avoid stale modifierTotal.
 */
export async function fetchLiveModifierTotal(
  tx: TxClient,
  itemId: string
): Promise<number> {
  const activeModifiers = await tx.orderItemModifier.findMany({
    where: { orderItemId: itemId, deletedAt: null },
  })
  return activeModifiers.reduce(
    (sum, m) => sum + Number(m.price) * (m.quantity ?? 1), 0
  )
}

// ─── Validate Combo Components ──────────────────────────────────────────────

export interface ComboValidationError {
  type: 'COMBO_COMPONENT_86D' | 'COMBO_COMPONENT_INACTIVE'
  name: string
}

/**
 * Validate combo component availability within a transaction.
 * Returns null if valid, or the error details if a component is unavailable.
 */
export async function validateComboComponents(
  tx: TxClient,
  comboMenuItemIds: string[]
): Promise<ComboValidationError | null> {
  if (comboMenuItemIds.length === 0) return null

  const comboTemplates = await tx.comboTemplate.findMany({
    where: {
      menuItemId: { in: comboMenuItemIds },
      deletedAt: null,
    },
    include: {
      components: {
        where: { deletedAt: null },
        include: {
          menuItem: {
            select: { id: true, name: true, isAvailable: true, isActive: true },
          },
        },
      },
    },
  })

  for (const template of comboTemplates) {
    for (const comp of template.components) {
      if (comp.menuItem && !comp.menuItem.isAvailable) {
        return { type: 'COMBO_COMPONENT_86D', name: comp.menuItem.name }
      }
      if (comp.menuItem && !comp.menuItem.isActive) {
        return { type: 'COMBO_COMPONENT_INACTIVE', name: comp.menuItem.name }
      }
    }
  }

  return null
}

// ─── Server-Side Modifier Price Fetch ───────────────────────────────────────

/**
 * Fetch authoritative modifier prices from the database.
 * Returns a map of modifierId -> price for server-side price override.
 */
export async function fetchModifierPrices(
  tx: TxClient,
  items: AddItemInput[]
): Promise<Map<string, number>> {
  const nonPizzaItems = items.filter(item => !item.pizzaConfig)
  const allModifierIds = nonPizzaItems
    .flatMap(item => (item.modifiers || []).map(m => m.modifierId))
    .filter(id => id && isValidModifierId(id))

  if (allModifierIds.length === 0) return new Map()

  const dbModifiers = await tx.modifier.findMany({
    where: { id: { in: allModifierIds } },
    select: { id: true, price: true, name: true },
  })

  return new Map(dbModifiers.map(m => [m.id, Number(m.price ?? 0)]))
}
