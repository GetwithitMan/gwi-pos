/**
 * Cake Quote Assembly & Financial Calculations
 *
 * PURE FUNCTIONS: No DB, no side effects, no framework types.
 *
 * Assembles PricingInputsV1 from cake order config + venue settings,
 * and generates line items for customer-facing quotes.
 *
 * Types imported from Zod-inferred schemas in ./schemas.ts.
 * See plan: zesty-forging-hopcroft.md "Fee Formulas" + "PricingInputsV1"
 */

import type {
  CakeConfigV1,
  DesignConfigV1,
  DietaryConfigV1,
  PricingInputsV1,
} from './schemas'

// ─── Input Types ────────────────────────────────────────────────────────────

export interface QuoteAssemblyInput {
  cakeOrder: {
    cakeConfig: CakeConfigV1
    designConfig: DesignConfigV1
    dietaryConfig: DietaryConfigV1
    deliveryType: string
    deliveryMiles: number | null
  }
  settings: {
    rushFeeAmount: number
    rushFeeDays: number
    setupFeeAmount: number
    deliveryFixedFee: number
    deliveryFeePerMile: number
    depositPercent: number
    deliveryFeeTaxable: boolean
  }
  taxRate: number
  taxJurisdiction: string
  eventDate: Date
}

// ─── Quote Line Items ───────────────────────────────────────────────────────

export interface CakeQuoteLineItem {
  category: 'tier' | 'modifier' | 'decoration' | 'message' | 'dietary' | 'rush_fee' | 'setup_fee' | 'delivery_fee' | 'discount' | 'tax'
  label: string
  description?: string
  quantity: number
  unitPrice: number
  total: number
  tierIndex?: number
}

// ─── Quote Assembly ─────────────────────────────────────────────────────────

/**
 * Assemble a complete PricingInputsV1 from cake order config + venue settings.
 *
 * This is the canonical pricing calculation. All financial fields on CakeOrder
 * and CakeQuote are derived from this output.
 *
 * Formula:
 *   tierSubtotal        = SUM(tier.basePrice + tier modifier prices)
 *   decorationSubtotal  = SUM(decoration prices) — cake-level, not per-tier
 *   messageCharge       = fixed charge if messageText exists (from decoration modifiers)
 *   subtotal            = tierSubtotal + decorationSubtotal + messageCharge + dietarySurcharge
 *   rushFee             = settings.rushFeeAmount if eventDate <= now + rushFeeDays
 *   setupFee            = settings.setupFeeAmount
 *   deliveryFee         = fixed or per-mile based on settings
 *   taxableBase         = subtotal + rushFee + setupFee + (deliveryFee if taxable) - discountAmount
 *   taxTotal            = taxableBase * taxRate
 *   totalAfterTax       = subtotal + rushFee + setupFee + deliveryFee - discountAmount + taxTotal
 *   depositRequired     = totalAfterTax * depositPercent / 100
 */
export function assembleQuote(input: QuoteAssemblyInput): PricingInputsV1 {
  const { cakeOrder, settings, taxRate, taxJurisdiction, eventDate } = input
  const { cakeConfig, designConfig, dietaryConfig, deliveryType, deliveryMiles } = cakeOrder

  // 1. Tier costs: base price + per-tier modifier prices
  const tiers = cakeConfig.tiers.map((tier) => {
    const flavorCost = sumModifiersByGroup(tier.modifiers, 'flavor')
    const fillingCost = sumModifiersByGroup(tier.modifiers, 'filling')
    const frostingCost = sumModifiersByGroup(tier.modifiers, 'frosting')

    // Dietary surcharge from dietaryConfig for this tier
    const tierDietary = dietaryConfig.requirements.find(r => r.tierIndex === tier.index)
    const dietarySurcharge = tierDietary
      ? tierDietary.modifiers.reduce((sum, m) => sum + m.price, 0)
      : 0

    return {
      tierIndex: tier.index,
      menuItemId: tier.menuItemId,
      menuItemName: tier.menuItemName,
      basePrice: tier.menuItemPrice,
      flavorCost,
      fillingCost,
      frostingCost,
      dietarySurcharge,
    }
  })

  const tierSubtotal = tiers.reduce(
    (sum, t) => sum + t.basePrice + t.flavorCost + t.fillingCost + t.frostingCost + t.dietarySurcharge,
    0
  )

  // 2. Decoration costs (cake-level, not per-tier)
  const decorations = designConfig.decorations.map((d) => ({
    modifierId: d.modifierId,
    name: d.modifierName,
    price: d.price,
  }))
  const decorationSubtotal = decorations.reduce((sum, d) => sum + d.price, 0)

  // 3. Message charge
  const messageCharge = designConfig.messageText ? getMessageCharge(designConfig) : 0

  // 4. Total dietary surcharge (sum across tiers, already in tier objects)
  const totalDietarySurcharge = tiers.reduce((sum, t) => sum + t.dietarySurcharge, 0)

  // 5. Subtotal
  const subtotal = tierSubtotal + decorationSubtotal + messageCharge

  // 6. Rush fee
  const rushFee = calculateRushFee(eventDate, settings.rushFeeDays, settings.rushFeeAmount)

  // 7. Setup fee
  const setupFee = settings.setupFeeAmount

  // 8. Delivery fee
  const deliveryFee = calculateDeliveryFee(
    deliveryType,
    deliveryMiles,
    settings.deliveryFixedFee,
    settings.deliveryFeePerMile
  )

  // 9. Discount (not passed in QuoteAssemblyInput — defaults to 0, applied via admin edit)
  const discountAmount = 0
  const discountReason: string | null = null

  // 10. Tax
  const deliveryFeeTaxable = settings.deliveryFeeTaxable
  const taxableBase = subtotal + rushFee + setupFee
    + (deliveryFeeTaxable ? deliveryFee : 0)
    - discountAmount
  const taxTotal = round2(Math.max(0, taxableBase) * taxRate)

  // 11. Totals
  const totalBeforeTax = subtotal + rushFee + setupFee + deliveryFee - discountAmount
  const totalAfterTax = round2(totalBeforeTax + taxTotal)

  // 12. Deposit
  const depositRequired = round2(totalAfterTax * settings.depositPercent / 100)

  return {
    schemaVersion: 1,
    tiers,
    tierSubtotal: round2(tierSubtotal),
    decorations,
    decorationSubtotal: round2(decorationSubtotal),
    messageCharge: round2(messageCharge),
    rushFee: round2(rushFee),
    setupFee: round2(setupFee),
    deliveryFee: round2(deliveryFee),
    deliveryFeeTaxable,
    discountAmount: round2(discountAmount),
    discountReason,
    subtotal: round2(subtotal),
    taxRateSnapshot: taxRate,
    taxJurisdictionSnapshot: taxJurisdiction,
    taxableBase: round2(Math.max(0, taxableBase)),
    taxTotal,
    totalBeforeTax: round2(totalBeforeTax),
    totalAfterTax,
    depositPercentSnapshot: settings.depositPercent,
    depositRequired,
  }
}

// ─── Line Item Generation ───────────────────────────────────────────────────

/**
 * Generate customer-facing line items from assembled pricing inputs.
 *
 * Used for quote display (admin + customer portal), PDF generation,
 * and settlement order descriptions.
 */
export function generateQuoteLineItems(
  pricingInputs: PricingInputsV1,
  cakeConfig: CakeConfigV1,
  designConfig: DesignConfigV1
): CakeQuoteLineItem[] {
  const items: CakeQuoteLineItem[] = []

  // Tier base prices
  for (const tier of pricingInputs.tiers) {
    items.push({
      category: 'tier',
      label: tier.menuItemName,
      description: `Tier ${tier.tierIndex + 1}`,
      quantity: 1,
      unitPrice: tier.basePrice,
      total: tier.basePrice,
      tierIndex: tier.tierIndex,
    })

    // Per-tier modifiers (flavor, filling, frosting)
    const configTier = cakeConfig.tiers.find(t => t.index === tier.tierIndex)
    if (configTier) {
      for (const mod of configTier.modifiers) {
        if (mod.price > 0) {
          items.push({
            category: 'modifier',
            label: mod.modifierName,
            description: `${mod.modifierGroupName} - Tier ${tier.tierIndex + 1}`,
            quantity: 1,
            unitPrice: mod.price,
            total: mod.price,
            tierIndex: tier.tierIndex,
          })
        }
      }
    }

    // Per-tier dietary surcharge
    if (tier.dietarySurcharge > 0) {
      items.push({
        category: 'dietary',
        label: 'Dietary Surcharge',
        description: `Tier ${tier.tierIndex + 1}`,
        quantity: 1,
        unitPrice: tier.dietarySurcharge,
        total: tier.dietarySurcharge,
        tierIndex: tier.tierIndex,
      })
    }
  }

  // Cake-level decorations
  for (const dec of pricingInputs.decorations) {
    if (dec.price > 0) {
      items.push({
        category: 'decoration',
        label: dec.name,
        quantity: 1,
        unitPrice: dec.price,
        total: dec.price,
      })
    }
  }

  // Message charge
  if (pricingInputs.messageCharge > 0) {
    items.push({
      category: 'message',
      label: 'Cake Inscription',
      description: designConfig.messageText ?? undefined,
      quantity: 1,
      unitPrice: pricingInputs.messageCharge,
      total: pricingInputs.messageCharge,
    })
  }

  // Rush fee
  if (pricingInputs.rushFee > 0) {
    items.push({
      category: 'rush_fee',
      label: 'Rush Order Fee',
      quantity: 1,
      unitPrice: pricingInputs.rushFee,
      total: pricingInputs.rushFee,
    })
  }

  // Setup fee
  if (pricingInputs.setupFee > 0) {
    items.push({
      category: 'setup_fee',
      label: 'Setup Fee',
      quantity: 1,
      unitPrice: pricingInputs.setupFee,
      total: pricingInputs.setupFee,
    })
  }

  // Delivery fee
  if (pricingInputs.deliveryFee > 0) {
    items.push({
      category: 'delivery_fee',
      label: 'Delivery Fee',
      quantity: 1,
      unitPrice: pricingInputs.deliveryFee,
      total: pricingInputs.deliveryFee,
    })
  }

  // Discount
  if (pricingInputs.discountAmount > 0) {
    items.push({
      category: 'discount',
      label: 'Discount',
      description: pricingInputs.discountReason ?? undefined,
      quantity: 1,
      unitPrice: -pricingInputs.discountAmount,
      total: -pricingInputs.discountAmount,
    })
  }

  // Tax
  if (pricingInputs.taxTotal > 0) {
    items.push({
      category: 'tax',
      label: `Tax (${(pricingInputs.taxRateSnapshot * 100).toFixed(2)}%)`,
      description: pricingInputs.taxJurisdictionSnapshot,
      quantity: 1,
      unitPrice: pricingInputs.taxTotal,
      total: pricingInputs.taxTotal,
    })
  }

  return items
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Sum modifier prices that match a group name pattern (case-insensitive partial match).
 * Modifier groups are identified by name because the modifier group categorization
 * (flavor/filling/frosting) is a naming convention, not a schema field.
 */
function sumModifiersByGroup(
  modifiers: { modifierGroupName: string; price: number }[],
  groupKeyword: string
): number {
  return modifiers
    .filter(m => m.modifierGroupName.toLowerCase().includes(groupKeyword.toLowerCase()))
    .reduce((sum, m) => sum + m.price, 0)
}

/**
 * Calculate rush fee based on event date vs lead time.
 *
 * If eventDate is within rushFeeDays from now, apply rush fee.
 * Hard minimum lead time is enforced upstream (API rejects orders too close).
 */
function calculateRushFee(eventDate: Date, rushFeeDays: number, rushFeeAmount: number): number {
  if (rushFeeDays <= 0 || rushFeeAmount <= 0) return 0

  const now = new Date()
  const msPerDay = 24 * 60 * 60 * 1000
  const daysUntilEvent = (eventDate.getTime() - now.getTime()) / msPerDay

  // Rush fee applies if event is within rushFeeDays
  if (daysUntilEvent <= rushFeeDays) {
    return rushFeeAmount
  }

  return 0
}

/**
 * Calculate delivery fee based on delivery type and settings.
 *
 * - pickup: $0
 * - fixed fee: settings.deliveryFixedFee
 * - per-mile: deliveryMiles * settings.deliveryFeePerMile
 *
 * Max distance enforcement is done upstream (API rejects beyond deliveryMaxMiles).
 */
function calculateDeliveryFee(
  deliveryType: string,
  deliveryMiles: number | null,
  deliveryFixedFee: number,
  deliveryFeePerMile: number
): number {
  if (deliveryType === 'pickup') return 0

  // Fixed fee takes precedence over per-mile
  if (deliveryFixedFee > 0) {
    return deliveryFixedFee
  }

  if (deliveryFeePerMile > 0 && deliveryMiles != null && deliveryMiles > 0) {
    return round2(deliveryMiles * deliveryFeePerMile)
  }

  return 0
}

/**
 * Extract message charge from design config decorations.
 *
 * Message charge comes from a modifier in the decorations array
 * with a group name containing "message" or "inscription".
 * If no such modifier exists, message is free (charge = 0).
 */
function getMessageCharge(designConfig: DesignConfigV1): number {
  const messageModifier = designConfig.decorations.find(
    d => d.modifierGroupName.toLowerCase().includes('message')
      || d.modifierGroupName.toLowerCase().includes('inscription')
  )
  return messageModifier?.price ?? 0
}

/** Round to 2 decimal places (financial rounding) */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
