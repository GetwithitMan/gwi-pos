/**
 * Section 3 — Inventory Deduction Helper Tests
 *
 * Tests the pure helper functions used by both order-deduction and void-waste.
 * Covers: multiplier bug fix (GL-08), removal instructions, prep item explosion,
 * unit conversion, and cost calculations.
 */

import { describe, it, expect } from 'vitest'
import {
  getModifierMultiplier,
  isRemovalInstruction,
  toNumber,
  getEffectiveCost,
  DEFAULT_MULTIPLIERS,
  explodePrepItem,
} from '../helpers'
import type { MultiplierSettings, PrepItemWithIngredients } from '../types'
import { Decimal } from '@prisma/client/runtime/library'

// =============================================================================
// getModifierMultiplier — GL-08 FIX: multiplier 0 fallback
// =============================================================================

describe('getModifierMultiplier', () => {
  // ---- GL-08 BUG FIX: multiplier=0 must not fallback to default ----

  it('CRITICAL: multiplierLite=0 returns 0, not the default 0.5', () => {
    const settings: MultiplierSettings = { multiplierLite: 0 }
    expect(getModifierMultiplier('LITE', settings)).toBe(0)
  })

  it('CRITICAL: multiplierExtra=0 returns 0, not the default 2.0', () => {
    const settings: MultiplierSettings = { multiplierExtra: 0 }
    expect(getModifierMultiplier('EXTRA', settings)).toBe(0)
  })

  it('CRITICAL: multiplierTriple=0 returns 0, not the default 3.0', () => {
    const settings: MultiplierSettings = { multiplierTriple: 0 }
    expect(getModifierMultiplier('TRIPLE', settings)).toBe(0)
  })

  // ---- Custom multiplier values ----

  it('uses custom multiplierExtra=2.0 from settings', () => {
    const settings: MultiplierSettings = { multiplierExtra: 2.0 }
    expect(getModifierMultiplier('EXTRA', settings)).toBe(2.0)
  })

  it('uses custom multiplierLite=0.25 from settings', () => {
    const settings: MultiplierSettings = { multiplierLite: 0.25 }
    expect(getModifierMultiplier('LITE', settings)).toBe(0.25)
  })

  it('uses custom multiplierTriple=4.0 from settings', () => {
    const settings: MultiplierSettings = { multiplierTriple: 4.0 }
    expect(getModifierMultiplier('TRIPLE', settings)).toBe(4.0)
  })

  // ---- Defaults when no settings provided ----

  it('returns default 0.5 for LITE when no settings', () => {
    expect(getModifierMultiplier('LITE')).toBe(DEFAULT_MULTIPLIERS.multiplierLite)
  })

  it('returns default 2.0 for EXTRA when no settings', () => {
    expect(getModifierMultiplier('EXTRA')).toBe(DEFAULT_MULTIPLIERS.multiplierExtra)
  })

  it('returns default 3.0 for TRIPLE when no settings', () => {
    expect(getModifierMultiplier('TRIPLE')).toBe(DEFAULT_MULTIPLIERS.multiplierTriple)
  })

  // ---- Removal instructions return 0 ----

  it('NO returns 0', () => {
    expect(getModifierMultiplier('NO')).toBe(0)
  })

  it('NONE returns 0', () => {
    expect(getModifierMultiplier('NONE')).toBe(0)
  })

  it('REMOVE returns 0', () => {
    expect(getModifierMultiplier('REMOVE')).toBe(0)
  })

  it('WITHOUT returns 0', () => {
    expect(getModifierMultiplier('WITHOUT')).toBe(0)
  })

  it('HOLD returns 0', () => {
    expect(getModifierMultiplier('HOLD')).toBe(0)
  })

  // ---- Normal / standard instructions return 1.0 ----

  it('null returns 1.0', () => {
    expect(getModifierMultiplier(null)).toBe(1.0)
  })

  it('undefined returns 1.0', () => {
    expect(getModifierMultiplier(undefined)).toBe(1.0)
  })

  it('NORMAL returns 1.0', () => {
    expect(getModifierMultiplier('NORMAL')).toBe(1.0)
  })

  it('REGULAR returns 1.0', () => {
    expect(getModifierMultiplier('REGULAR')).toBe(1.0)
  })

  it('ADD returns 1.0', () => {
    expect(getModifierMultiplier('ADD')).toBe(1.0)
  })

  it('SIDE returns 1.0', () => {
    expect(getModifierMultiplier('SIDE')).toBe(1.0)
  })

  // ---- Aliases ----

  it('LIGHT is alias for LITE', () => {
    expect(getModifierMultiplier('LIGHT')).toBe(DEFAULT_MULTIPLIERS.multiplierLite)
  })

  it('EASY is alias for LITE', () => {
    expect(getModifierMultiplier('EASY')).toBe(DEFAULT_MULTIPLIERS.multiplierLite)
  })

  it('HALF is alias for LITE', () => {
    expect(getModifierMultiplier('HALF')).toBe(DEFAULT_MULTIPLIERS.multiplierLite)
  })

  it('DOUBLE is alias for EXTRA', () => {
    expect(getModifierMultiplier('DOUBLE')).toBe(DEFAULT_MULTIPLIERS.multiplierExtra)
  })

  it('HEAVY is alias for EXTRA', () => {
    expect(getModifierMultiplier('HEAVY')).toBe(DEFAULT_MULTIPLIERS.multiplierExtra)
  })

  it('3X is alias for TRIPLE', () => {
    expect(getModifierMultiplier('3X')).toBe(DEFAULT_MULTIPLIERS.multiplierTriple)
  })

  // ---- Case insensitivity ----

  it('handles lowercase input', () => {
    expect(getModifierMultiplier('lite')).toBe(DEFAULT_MULTIPLIERS.multiplierLite)
  })

  it('handles mixed case input', () => {
    expect(getModifierMultiplier('Extra')).toBe(DEFAULT_MULTIPLIERS.multiplierExtra)
  })

  // ---- Decimal settings values ----

  it('handles Decimal settings values', () => {
    const settings: MultiplierSettings = { multiplierLite: new Decimal(0.75) }
    expect(getModifierMultiplier('LITE', settings)).toBe(0.75)
  })

  it('handles Decimal 0 settings values correctly', () => {
    const settings: MultiplierSettings = { multiplierExtra: new Decimal(0) }
    expect(getModifierMultiplier('EXTRA', settings)).toBe(0)
  })
})

// =============================================================================
// isRemovalInstruction
// =============================================================================

describe('isRemovalInstruction', () => {
  it('NO is a removal', () => {
    expect(isRemovalInstruction('NO')).toBe(true)
  })

  it('NONE is a removal', () => {
    expect(isRemovalInstruction('NONE')).toBe(true)
  })

  it('REMOVE is a removal', () => {
    expect(isRemovalInstruction('REMOVE')).toBe(true)
  })

  it('WITHOUT is a removal', () => {
    expect(isRemovalInstruction('WITHOUT')).toBe(true)
  })

  it('HOLD is a removal', () => {
    expect(isRemovalInstruction('HOLD')).toBe(true)
  })

  it('EXTRA is not a removal', () => {
    expect(isRemovalInstruction('EXTRA')).toBe(false)
  })

  it('LITE is not a removal', () => {
    expect(isRemovalInstruction('LITE')).toBe(false)
  })

  it('null is not a removal', () => {
    expect(isRemovalInstruction(null)).toBe(false)
  })

  it('undefined is not a removal', () => {
    expect(isRemovalInstruction(undefined)).toBe(false)
  })

  it('handles lowercase', () => {
    expect(isRemovalInstruction('no')).toBe(true)
  })
})

// =============================================================================
// toNumber
// =============================================================================

describe('toNumber', () => {
  it('converts number to number', () => {
    expect(toNumber(42)).toBe(42)
  })

  it('converts Decimal to number', () => {
    expect(toNumber(new Decimal(3.14))).toBeCloseTo(3.14)
  })

  it('null returns 0', () => {
    expect(toNumber(null)).toBe(0)
  })

  it('undefined returns 0', () => {
    expect(toNumber(undefined)).toBe(0)
  })

  it('zero stays zero', () => {
    expect(toNumber(0)).toBe(0)
  })

  it('Decimal zero stays zero', () => {
    expect(toNumber(new Decimal(0))).toBe(0)
  })
})

// =============================================================================
// getEffectiveCost
// =============================================================================

describe('getEffectiveCost', () => {
  it('returns yieldCostPerUnit when available', () => {
    expect(getEffectiveCost({ costPerUnit: 5.00, yieldCostPerUnit: 7.50 })).toBe(7.50)
  })

  it('falls back to costPerUnit when yieldCost is null', () => {
    expect(getEffectiveCost({ costPerUnit: 5.00, yieldCostPerUnit: null })).toBe(5.00)
  })

  it('falls back to costPerUnit when yieldCost is undefined', () => {
    expect(getEffectiveCost({ costPerUnit: 5.00, yieldCostPerUnit: undefined })).toBe(5.00)
  })

  it('handles Decimal values', () => {
    expect(getEffectiveCost({ costPerUnit: new Decimal(5.00), yieldCostPerUnit: new Decimal(7.50) })).toBe(7.50)
  })

  it('yieldCostPerUnit of 0 is valid (not null)', () => {
    expect(getEffectiveCost({ costPerUnit: 5.00, yieldCostPerUnit: 0 })).toBe(0)
  })
})

// =============================================================================
// explodePrepItem
// =============================================================================

describe('explodePrepItem', () => {
  const makeInventoryItem = (id: string, name: string) => ({
    id,
    name,
    category: 'food',
    department: 'kitchen',
    storageUnit: 'g',
    costPerUnit: 1.00 as number | Decimal,
  })

  it('explodes a simple prep item to raw ingredients', () => {
    const prepItem: PrepItemWithIngredients = {
      id: 'prep-1',
      name: 'BBQ Sauce',
      batchYield: 1000,
      outputUnit: 'g',
      ingredients: [
        { quantity: 500, unit: 'g', inventoryItem: makeInventoryItem('inv-1', 'Tomato Paste') },
        { quantity: 300, unit: 'g', inventoryItem: makeInventoryItem('inv-2', 'Sugar') },
        { quantity: 200, unit: 'g', inventoryItem: makeInventoryItem('inv-3', 'Vinegar') },
      ],
    }

    // Need 100g of BBQ Sauce from a 1000g batch
    const result = explodePrepItem(prepItem, 100, 'g')

    expect(result).toHaveLength(3)
    // scaleFactor = 100 / 1000 = 0.1
    expect(result[0].quantity).toBeCloseTo(50)  // 500 * 0.1
    expect(result[0].inventoryItem.id).toBe('inv-1')
    expect(result[1].quantity).toBeCloseTo(30)  // 300 * 0.1
    expect(result[2].quantity).toBeCloseTo(20)  // 200 * 0.1
  })

  it('handles nested prep items recursively', () => {
    const innerPrep: PrepItemWithIngredients = {
      id: 'prep-inner',
      name: 'Spice Mix',
      batchYield: 100,
      outputUnit: 'g',
      ingredients: [
        { quantity: 50, unit: 'g', inventoryItem: makeInventoryItem('inv-paprika', 'Paprika') },
        { quantity: 50, unit: 'g', inventoryItem: makeInventoryItem('inv-cumin', 'Cumin') },
      ],
    }

    const outerPrep: PrepItemWithIngredients = {
      id: 'prep-outer',
      name: 'BBQ Sauce',
      batchYield: 1000,
      outputUnit: 'g',
      ingredients: [
        { quantity: 100, unit: 'g', prepItem: innerPrep },
        { quantity: 900, unit: 'g', inventoryItem: makeInventoryItem('inv-tomato', 'Tomato') },
      ],
    }

    // Need 500g of BBQ Sauce
    const result = explodePrepItem(outerPrep, 500, 'g')

    expect(result).toHaveLength(3) // 2 from inner prep + 1 from outer
    // scaleFactor for outer = 500/1000 = 0.5
    // innerPrep gets 100 * 0.5 = 50g needed from inner (batchYield 100)
    // scaleFactor for inner = 50/100 = 0.5
    expect(result[0].inventoryItem.id).toBe('inv-paprika')
    expect(result[0].quantity).toBeCloseTo(25) // 50 * 0.5
    expect(result[1].inventoryItem.id).toBe('inv-cumin')
    expect(result[1].quantity).toBeCloseTo(25) // 50 * 0.5
    expect(result[2].inventoryItem.id).toBe('inv-tomato')
    expect(result[2].quantity).toBeCloseTo(450) // 900 * 0.5
  })

  it('handles default batchYield of 1 when null', () => {
    const prepItem: PrepItemWithIngredients = {
      id: 'prep-1',
      name: 'Simple Prep',
      batchYield: null,
      outputUnit: 'ea',
      ingredients: [
        { quantity: 10, unit: 'g', inventoryItem: makeInventoryItem('inv-1', 'Flour') },
      ],
    }

    const result = explodePrepItem(prepItem, 2, 'ea')
    // batchYield defaults to 1, so scaleFactor = 2/1 = 2
    expect(result[0].quantity).toBeCloseTo(20)
  })
})
