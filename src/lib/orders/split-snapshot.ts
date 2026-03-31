/**
 * Split-ticket snapshot creation helpers.
 *
 * Builds Prisma-ready `create` data for split child order items
 * (both whole copies and fractional entries).
 */
import type { FractionalItemEntry, ParentOrderItem } from './split-calculations'

// ---------------------------------------------------------------------------
// Build item create data for a whole (non-fractional) item copy
// ---------------------------------------------------------------------------

export function buildWholeItemCreateData(
  item: ParentOrderItem,
  locationId: string,
) {
  return {
    locationId,
    menuItemId: item.menuItemId,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    itemTotal: item.itemTotal,
    isTaxInclusive: item.isTaxInclusive,
    specialNotes: item.specialNotes,
    seatNumber: item.seatNumber,
    courseNumber: item.courseNumber,
    courseStatus: item.courseStatus,
    kitchenStatus: item.kitchenStatus,
    pricingRuleApplied: item.pricingRuleApplied ?? undefined,
    modifiers: {
      create: item.modifiers.map(mod => ({
        locationId,
        modifierId: mod.modifierId,
        name: mod.name,
        price: mod.price,
        quantity: mod.quantity,
        preModifier: mod.preModifier,
        depth: mod.depth,
        commissionAmount: mod.commissionAmount,
        linkedMenuItemId: mod.linkedMenuItemId,
        linkedMenuItemName: mod.linkedMenuItemName,
        linkedMenuItemPrice: mod.linkedMenuItemPrice,
        spiritTier: mod.spiritTier,
        linkedBottleProductId: mod.linkedBottleProductId,
        isCustomEntry: mod.isCustomEntry,
        isNoneSelection: mod.isNoneSelection,
        customEntryName: mod.customEntryName,
        customEntryPrice: mod.customEntryPrice,
        swapTargetName: mod.swapTargetName,
        swapTargetItemId: mod.swapTargetItemId,
        swapPricingMode: mod.swapPricingMode,
        swapEffectivePrice: mod.swapEffectivePrice,
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// Build item create data for a fractional item entry
// ---------------------------------------------------------------------------

export function buildFractionalItemCreateData(
  fe: FractionalItemEntry,
  locationId: string,
) {
  // Calculate proportional modifier prices
  const modPrices = fe.originalItem.modifiers.map(mod =>
    Math.round(Number(mod.price) * fe.fraction * 100) / 100
  )
  const totalModCost = fe.originalItem.modifiers.reduce(
    (sum, mod, i) => sum + modPrices[i] * (mod.quantity || 1), 0
  )
  // Base price = fractionalPrice minus modifier costs (ensures exact sum)
  const basePrice = Math.round((fe.fractionalPrice - totalModCost) * 100) / 100

  return {
    locationId,
    menuItemId: fe.originalItem.menuItemId,
    name: `${fe.originalItem.name} (${fe.labelIndex}/${fe.totalFractions})`,
    price: basePrice,
    quantity: 1,
    itemTotal: fe.fractionalPrice,
    isTaxInclusive: fe.originalItem.isTaxInclusive,
    specialNotes: fe.originalItem.specialNotes,
    seatNumber: fe.originalItem.seatNumber,
    courseNumber: fe.originalItem.courseNumber,
    courseStatus: fe.originalItem.courseStatus,
    kitchenStatus: fe.originalItem.kitchenStatus,
    pricingRuleApplied: fe.originalItem.pricingRuleApplied ?? undefined,
    modifiers: {
      create: fe.originalItem.modifiers.map((mod, i) => ({
        locationId,
        modifierId: mod.modifierId,
        name: mod.name,
        price: modPrices[i],
        quantity: mod.quantity,
        preModifier: mod.preModifier,
        depth: mod.depth,
        commissionAmount: mod.commissionAmount
          ? Math.round(Number(mod.commissionAmount) * fe.fraction * 100) / 100
          : null,
        linkedMenuItemId: mod.linkedMenuItemId,
        linkedMenuItemName: mod.linkedMenuItemName,
        linkedMenuItemPrice: mod.linkedMenuItemPrice,
        spiritTier: mod.spiritTier,
        linkedBottleProductId: mod.linkedBottleProductId,
        isCustomEntry: mod.isCustomEntry,
        isNoneSelection: mod.isNoneSelection,
        customEntryName: mod.customEntryName,
        customEntryPrice: mod.customEntryPrice
          ? Math.round(Number(mod.customEntryPrice) * fe.fraction * 100) / 100
          : null,
        swapTargetName: mod.swapTargetName,
        swapTargetItemId: mod.swapTargetItemId,
        swapPricingMode: mod.swapPricingMode,
        swapEffectivePrice: mod.swapEffectivePrice
          ? Math.round(Number(mod.swapEffectivePrice) * fe.fraction * 100) / 100
          : null,
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// Build complete item create list for a single split ticket
// ---------------------------------------------------------------------------

export function buildTicketItemCreateData(
  wholeItems: ParentOrderItem[],
  fractionalEntries: FractionalItemEntry[],
  locationId: string,
) {
  return [
    ...wholeItems.map(item => buildWholeItemCreateData(item, locationId)),
    ...fractionalEntries.map(fe => buildFractionalItemCreateData(fe, locationId)),
  ]
}
