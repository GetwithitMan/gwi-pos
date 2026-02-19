/**
 * Unit Conversion System
 *
 * All conversions go through a base unit per category:
 * - Weight: base = grams (g)
 * - Volume: base = milliliters (ml)
 * - Count: base = each (ea)
 */

type UnitCategory = 'weight' | 'volume' | 'count'

interface UnitDefinition {
  category: UnitCategory
  baseUnit: string
  toBase: number // Multiplier to convert to base unit
}

const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {
  // Weight units (base: grams)
  'g': { category: 'weight', baseUnit: 'g', toBase: 1 },
  'gram': { category: 'weight', baseUnit: 'g', toBase: 1 },
  'grams': { category: 'weight', baseUnit: 'g', toBase: 1 },
  'kg': { category: 'weight', baseUnit: 'g', toBase: 1000 },
  'kilogram': { category: 'weight', baseUnit: 'g', toBase: 1000 },
  'kilograms': { category: 'weight', baseUnit: 'g', toBase: 1000 },
  'oz': { category: 'weight', baseUnit: 'g', toBase: 28.3495 },
  'ounce': { category: 'weight', baseUnit: 'g', toBase: 28.3495 },
  'ounces': { category: 'weight', baseUnit: 'g', toBase: 28.3495 },
  'lb': { category: 'weight', baseUnit: 'g', toBase: 453.592 },
  'lbs': { category: 'weight', baseUnit: 'g', toBase: 453.592 },
  'pound': { category: 'weight', baseUnit: 'g', toBase: 453.592 },
  'pounds': { category: 'weight', baseUnit: 'g', toBase: 453.592 },

  // Volume units (base: milliliters)
  'ml': { category: 'volume', baseUnit: 'ml', toBase: 1 },
  'milliliter': { category: 'volume', baseUnit: 'ml', toBase: 1 },
  'milliliters': { category: 'volume', baseUnit: 'ml', toBase: 1 },
  'l': { category: 'volume', baseUnit: 'ml', toBase: 1000 },
  'liter': { category: 'volume', baseUnit: 'ml', toBase: 1000 },
  'liters': { category: 'volume', baseUnit: 'ml', toBase: 1000 },
  'fl oz': { category: 'volume', baseUnit: 'ml', toBase: 29.5735 },
  'floz': { category: 'volume', baseUnit: 'ml', toBase: 29.5735 },
  'fluid oz': { category: 'volume', baseUnit: 'ml', toBase: 29.5735 },
  'cup': { category: 'volume', baseUnit: 'ml', toBase: 236.588 },
  'cups': { category: 'volume', baseUnit: 'ml', toBase: 236.588 },
  'pt': { category: 'volume', baseUnit: 'ml', toBase: 473.176 },
  'pint': { category: 'volume', baseUnit: 'ml', toBase: 473.176 },
  'pints': { category: 'volume', baseUnit: 'ml', toBase: 473.176 },
  'qt': { category: 'volume', baseUnit: 'ml', toBase: 946.353 },
  'quart': { category: 'volume', baseUnit: 'ml', toBase: 946.353 },
  'quarts': { category: 'volume', baseUnit: 'ml', toBase: 946.353 },
  'gal': { category: 'volume', baseUnit: 'ml', toBase: 3785.41 },
  'gallon': { category: 'volume', baseUnit: 'ml', toBase: 3785.41 },
  'gallons': { category: 'volume', baseUnit: 'ml', toBase: 3785.41 },
  'tsp': { category: 'volume', baseUnit: 'ml', toBase: 4.92892 },
  'teaspoon': { category: 'volume', baseUnit: 'ml', toBase: 4.92892 },
  'teaspoons': { category: 'volume', baseUnit: 'ml', toBase: 4.92892 },
  'tbsp': { category: 'volume', baseUnit: 'ml', toBase: 14.7868 },
  'tablespoon': { category: 'volume', baseUnit: 'ml', toBase: 14.7868 },
  'tablespoons': { category: 'volume', baseUnit: 'ml', toBase: 14.7868 },

  // Count units (base: each)
  'ea': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'each': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'pc': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'pcs': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'piece': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'pieces': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'slice': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'slices': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'portion': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'portions': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'serving': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'servings': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'case': { category: 'count', baseUnit: 'ea', toBase: 1 }, // Case requires item-specific conversion
  'cases': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'dozen': { category: 'count', baseUnit: 'ea', toBase: 12 },
  'doz': { category: 'count', baseUnit: 'ea', toBase: 12 },
}

/**
 * Normalize unit string for lookup
 */
export function normalizeUnit(unit: string): string {
  return unit.toLowerCase().trim()
}

/**
 * Get unit definition, returns null if unknown
 */
function getUnitDefinition(unit: string): UnitDefinition | null {
  return UNIT_DEFINITIONS[normalizeUnit(unit)] || null
}

/**
 * Convert quantity from one unit to another
 * Returns null if conversion is not possible (different categories or unknown units)
 */
export function convertUnits(
  quantity: number,
  fromUnit: string,
  toUnit: string
): number | null {
  const fromDef = getUnitDefinition(fromUnit)
  const toDef = getUnitDefinition(toUnit)

  // If either unit is unknown, return null
  if (!fromDef || !toDef) {
    return null
  }

  // If units are in different categories, conversion is not possible
  if (fromDef.category !== toDef.category) {
    return null
  }

  // Same unit, no conversion needed
  if (normalizeUnit(fromUnit) === normalizeUnit(toUnit)) {
    return quantity
  }

  // Convert: source -> base -> target
  const inBase = quantity * fromDef.toBase
  const result = inBase / toDef.toBase

  return result
}

/**
 * Check if two units are compatible (same category)
 */
export function areUnitsCompatible(unit1: string, unit2: string): boolean {
  const def1 = getUnitDefinition(unit1)
  const def2 = getUnitDefinition(unit2)

  if (!def1 || !def2) return false
  return def1.category === def2.category
}

/**
 * Get the category of a unit
 */
export function getUnitCategory(unit: string): UnitCategory | null {
  const def = getUnitDefinition(unit)
  return def?.category || null
}

export const unitConversion = {
  convert: convertUnits,
  areCompatible: areUnitsCompatible,
  getCategory: getUnitCategory,
  normalize: normalizeUnit,
}
