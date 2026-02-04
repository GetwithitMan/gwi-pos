/**
 * Unit Conversion System for GWI POS Inventory
 *
 * Provides conversions between units within the same category
 * for accurate yield and cost calculations.
 */

// ============================================
// CONVERSION FACTORS (to base unit)
// ============================================

// Weight conversions (base: grams)
export const WEIGHT_TO_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
}

// Volume conversions (base: milliliters)
export const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  liters: 1000,
  tsp: 4.92892,
  tbsp: 14.7868,
  fl_oz: 29.5735,
  cups: 236.588,
  pints: 473.176,
  quarts: 946.353,
  gallons: 3785.41,
}

// Combined lookup for all convertible units
const CONVERSION_FACTORS: Record<string, { toBase: number; baseUnit: string }> = {
  // Weight
  g: { toBase: 1, baseUnit: 'g' },
  kg: { toBase: 1000, baseUnit: 'g' },
  oz: { toBase: 28.3495, baseUnit: 'g' },
  lb: { toBase: 453.592, baseUnit: 'g' },
  // Volume
  ml: { toBase: 1, baseUnit: 'ml' },
  liters: { toBase: 1000, baseUnit: 'ml' },
  tsp: { toBase: 4.92892, baseUnit: 'ml' },
  tbsp: { toBase: 14.7868, baseUnit: 'ml' },
  fl_oz: { toBase: 29.5735, baseUnit: 'ml' },
  cups: { toBase: 236.588, baseUnit: 'ml' },
  pints: { toBase: 473.176, baseUnit: 'ml' },
  quarts: { toBase: 946.353, baseUnit: 'ml' },
  gallons: { toBase: 3785.41, baseUnit: 'ml' },
}

// ============================================
// CONVERSION FUNCTIONS
// ============================================

/**
 * Check if a unit is convertible (weight or volume)
 */
export function isConvertibleUnit(unit: string): boolean {
  return unit in CONVERSION_FACTORS
}

/**
 * Convert a value to the base unit (grams for weight, ml for volume)
 */
export function convertToBase(value: number, unit: string): number | null {
  const factor = CONVERSION_FACTORS[unit]
  if (!factor) return null
  return value * factor.toBase
}

/**
 * Convert a value from the base unit to target unit
 */
export function convertFromBase(value: number, unit: string): number | null {
  const factor = CONVERSION_FACTORS[unit]
  if (!factor) return null
  return value / factor.toBase
}

/**
 * Convert between two units (if compatible)
 */
export function convert(value: number, fromUnit: string, toUnit: string): number | null {
  const fromFactor = CONVERSION_FACTORS[fromUnit]
  const toFactor = CONVERSION_FACTORS[toUnit]

  // Both must exist
  if (!fromFactor || !toFactor) return null

  // Must be same category (weight or volume)
  if (fromFactor.baseUnit !== toFactor.baseUnit) return null

  // Convert: value * fromToBase / toToBase
  const inBase = value * fromFactor.toBase
  return inBase / toFactor.toBase
}

/**
 * Check if two units can be converted between each other
 */
export function canConvert(fromUnit: string, toUnit: string): boolean {
  const fromFactor = CONVERSION_FACTORS[fromUnit]
  const toFactor = CONVERSION_FACTORS[toUnit]

  if (!fromFactor || !toFactor) return false
  return fromFactor.baseUnit === toFactor.baseUnit
}

/**
 * Get the base unit category for a unit
 */
export function getBaseUnit(unit: string): string | null {
  const factor = CONVERSION_FACTORS[unit]
  return factor?.baseUnit || null
}

// ============================================
// YIELD CALCULATION HELPERS
// ============================================

/**
 * Calculate yield percentage from input and output
 * Returns null if units are incompatible
 *
 * Example: 6 oz input, 2 oz output = 33.33% yield
 */
export function calculateYield(
  inputValue: number,
  inputUnit: string,
  outputValue: number,
  outputUnit: string
): number | null {
  // If same unit, simple division
  if (inputUnit === outputUnit) {
    return (outputValue / inputValue) * 100
  }

  // Try to convert to same base
  const inputInBase = convertToBase(inputValue, inputUnit)
  const outputInBase = convertToBase(outputValue, outputUnit)

  if (inputInBase === null || outputInBase === null) {
    return null // Cannot calculate yield for incompatible units
  }

  // Make sure both are same category (weight or volume)
  if (getBaseUnit(inputUnit) !== getBaseUnit(outputUnit)) {
    return null
  }

  return (outputInBase / inputInBase) * 100
}

/**
 * Calculate cost per output unit given parent cost and transformation
 *
 * Example:
 * - Parent: Raw Chicken at $4.00/lb
 * - Input: 6 oz raw
 * - Output: 2 oz shredded
 * - Cost per oz shredded = ($4.00/lb * 6oz) / 2oz = $0.75/oz
 */
export function calculateCostPerOutputUnit(
  parentCostPerUnit: number,
  parentUnit: string,
  inputQuantity: number,
  inputUnit: string,
  outputQuantity: number,
  _outputUnit: string
): number | null {
  // Convert input to parent's unit to get input cost
  const inputInParentUnits = convert(inputQuantity, inputUnit, parentUnit)

  if (inputInParentUnits === null) {
    // If can't convert (e.g., 'each' to 'oz'), assume 1:1 relationship
    // This handles cases like "1 dough ball → 1 crust"
    return (parentCostPerUnit * inputQuantity) / outputQuantity
  }

  // Cost of input = parent cost * input amount in parent units
  const inputCost = parentCostPerUnit * inputInParentUnits

  // Cost per output unit = input cost / output quantity
  return inputCost / outputQuantity
}

// ============================================
// FORMATTING HELPERS
// ============================================

/**
 * Format a quantity with appropriate decimal places based on unit precision
 */
export function formatQuantity(value: number, unit: string): string {
  // For whole units, round to integer
  const wholeUnits = ['each', 'pieces', 'slices', 'balls', 'crusts', 'patties', 'batches']
  if (wholeUnits.includes(unit)) {
    return Math.round(value).toString()
  }

  // For decimals, show up to 2 places but trim trailing zeros
  return parseFloat(value.toFixed(2)).toString()
}

/**
 * Format a transformation for display
 * Example: "6 oz → 2 oz" or "1 ball → 1 crust"
 */
export function formatTransformation(
  inputQty: number,
  inputUnit: string,
  outputQty: number,
  outputUnit: string
): string {
  return `${formatQuantity(inputQty, inputUnit)} ${inputUnit} → ${formatQuantity(outputQty, outputUnit)} ${outputUnit}`
}
