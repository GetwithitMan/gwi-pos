/**
 * Unit System for GWI POS Inventory
 *
 * Comprehensive measurement units for foodservice, organized by category.
 * Each unit has a precision hint (whole vs decimal) and example usage.
 */

export interface UnitDefinition {
  value: string
  label: string
  precision: 'whole' | 'decimal'
  category: 'count' | 'weight' | 'liquid' | 'cooking' | 'portion' | 'package'
  example: string
}

// Comprehensive measurement units organized by type
export const OUTPUT_UNITS: UnitDefinition[] = [
  // === COUNT UNITS (discrete items) ===
  { value: 'each', label: 'each', precision: 'whole', category: 'count', example: 'dough balls, patties, eggs' },
  { value: 'pieces', label: 'pieces', precision: 'whole', category: 'count', example: 'chicken pieces, wings' },
  { value: 'slices', label: 'slices', precision: 'whole', category: 'count', example: 'cheese slices, bread' },
  { value: 'portions', label: 'portions', precision: 'whole', category: 'count', example: 'pre-measured amounts' },
  { value: 'servings', label: 'servings', precision: 'whole', category: 'count', example: 'ready-to-serve' },
  { value: 'balls', label: 'balls', precision: 'whole', category: 'count', example: 'dough balls, meatballs' },
  { value: 'sheets', label: 'sheets', precision: 'whole', category: 'count', example: 'pasta sheets, phyllo' },
  { value: 'patties', label: 'patties', precision: 'whole', category: 'count', example: 'burger patties' },
  { value: 'links', label: 'links', precision: 'whole', category: 'count', example: 'sausage links' },
  { value: 'strips', label: 'strips', precision: 'whole', category: 'count', example: 'bacon strips, chicken strips' },
  { value: 'wings', label: 'wings', precision: 'whole', category: 'count', example: 'chicken wings' },
  { value: 'breasts', label: 'breasts', precision: 'whole', category: 'count', example: 'chicken breasts' },
  { value: 'fillets', label: 'fillets', precision: 'whole', category: 'count', example: 'fish fillets' },
  { value: 'crusts', label: 'crusts', precision: 'whole', category: 'count', example: 'pizza crusts' },
  { value: 'shells', label: 'shells', precision: 'whole', category: 'count', example: 'taco shells, calzone shells' },
  { value: 'wraps', label: 'wraps', precision: 'whole', category: 'count', example: 'tortilla wraps' },
  { value: 'buns', label: 'buns', precision: 'whole', category: 'count', example: 'burger buns, hot dog buns' },
  { value: 'rolls', label: 'rolls', precision: 'whole', category: 'count', example: 'dinner rolls, egg rolls' },
  { value: 'loaves', label: 'loaves', precision: 'whole', category: 'count', example: 'bread loaves' },
  { value: 'batches', label: 'batches', precision: 'whole', category: 'count', example: 'dough batches, sauce batches' },

  // === WEIGHT UNITS (US) ===
  { value: 'oz', label: 'oz', precision: 'decimal', category: 'weight', example: 'small portions by weight' },
  { value: 'lb', label: 'lb', precision: 'decimal', category: 'weight', example: 'bulk items by weight' },

  // === WEIGHT UNITS (Metric) ===
  { value: 'g', label: 'g (grams)', precision: 'decimal', category: 'weight', example: 'precise small weights' },
  { value: 'kg', label: 'kg', precision: 'decimal', category: 'weight', example: 'bulk metric weights' },

  // === VOLUME UNITS (Liquid) ===
  { value: 'fl_oz', label: 'fl oz', precision: 'decimal', category: 'liquid', example: 'beverages, sauces' },
  { value: 'cups', label: 'cups', precision: 'decimal', category: 'liquid', example: 'measured liquids' },
  { value: 'pints', label: 'pints', precision: 'decimal', category: 'liquid', example: 'beer, milk' },
  { value: 'quarts', label: 'quarts', precision: 'decimal', category: 'liquid', example: 'soups, sauces' },
  { value: 'gallons', label: 'gallons', precision: 'decimal', category: 'liquid', example: 'large liquid batches' },
  { value: 'liters', label: 'liters', precision: 'decimal', category: 'liquid', example: 'metric liquids' },
  { value: 'ml', label: 'ml', precision: 'decimal', category: 'liquid', example: 'small liquid measures' },

  // === VOLUME UNITS (Cooking) ===
  { value: 'tsp', label: 'tsp', precision: 'decimal', category: 'cooking', example: 'spices, extracts' },
  { value: 'tbsp', label: 'tbsp', precision: 'decimal', category: 'cooking', example: 'oils, sauces' },

  // === PORTION TOOLS ===
  { value: 'scoops', label: 'scoops', precision: 'whole', category: 'portion', example: 'ice cream, mashed potatoes' },
  { value: 'ladles', label: 'ladles', precision: 'whole', category: 'portion', example: 'soup, sauce portions' },
  { value: 'pumps', label: 'pumps', precision: 'whole', category: 'portion', example: 'syrup pumps, soap' },
  { value: 'squirts', label: 'squirts', precision: 'whole', category: 'portion', example: 'squeeze bottles' },
  { value: 'dollops', label: 'dollops', precision: 'whole', category: 'portion', example: 'sour cream, whipped cream' },
  { value: 'sprinkles', label: 'sprinkles', precision: 'whole', category: 'portion', example: 'cheese, herbs' },

  // === PACKAGING UNITS ===
  { value: 'bags', label: 'bags', precision: 'whole', category: 'package', example: 'flour bags, chip bags' },
  { value: 'boxes', label: 'boxes', precision: 'whole', category: 'package', example: 'pasta boxes' },
  { value: 'cases', label: 'cases', precision: 'whole', category: 'package', example: 'beverage cases' },
  { value: 'cans', label: 'cans', precision: 'whole', category: 'package', example: 'canned goods' },
  { value: 'jars', label: 'jars', precision: 'whole', category: 'package', example: 'pickles, sauces' },
  { value: 'bottles', label: 'bottles', precision: 'whole', category: 'package', example: 'beverages, oils' },
  { value: 'containers', label: 'containers', precision: 'whole', category: 'package', example: 'deli containers' },
  { value: 'tubs', label: 'tubs', precision: 'whole', category: 'package', example: 'butter, cream cheese' },
  { value: 'packs', label: 'packs', precision: 'whole', category: 'package', example: 'bacon packs, cheese packs' },
]

// Group units by category for organized dropdowns
export const UNIT_CATEGORIES = [
  { key: 'count', label: 'Count (Whole Items)' },
  { key: 'weight', label: 'Weight' },
  { key: 'liquid', label: 'Liquid Volume' },
  { key: 'cooking', label: 'Cooking Measures' },
  { key: 'portion', label: 'Portion Tools' },
  { key: 'package', label: 'Packaging' },
] as const

export type UnitCategory = typeof UNIT_CATEGORIES[number]['key']

// ============================================
// UNIT HELPER FUNCTIONS
// ============================================

/**
 * Get the precision type for a unit
 */
export function getUnitPrecision(unit: string): 'whole' | 'decimal' {
  const found = OUTPUT_UNITS.find(u => u.value === unit)
  return found?.precision || 'whole'
}

/**
 * Get units filtered by category
 */
export function getUnitsByCategory(category: UnitCategory): UnitDefinition[] {
  return OUTPUT_UNITS.filter(u => u.category === category)
}

/**
 * Check if a unit counts in whole numbers
 */
export function isWholeUnit(unit: string): boolean {
  return getUnitPrecision(unit) === 'whole'
}

/**
 * Check if a unit allows decimals
 */
export function isDecimalUnit(unit: string): boolean {
  return getUnitPrecision(unit) === 'decimal'
}

/**
 * Get example usage for a unit (for tooltips/helper text)
 */
export function formatUnitExample(unit: string): string {
  const found = OUTPUT_UNITS.find(u => u.value === unit)
  return found?.example ? `e.g., ${found.example}` : ''
}

/**
 * Get the category of a unit
 */
export function getUnitCategory(unit: string): UnitCategory | null {
  const found = OUTPUT_UNITS.find(u => u.value === unit)
  return found?.category || null
}

/**
 * Get the full unit definition
 */
export function getUnitDefinition(unit: string): UnitDefinition | undefined {
  return OUTPUT_UNITS.find(u => u.value === unit)
}

/**
 * Check if two units are in the same category (compatible for yield calculation)
 */
export function areUnitsCompatible(unit1: string, unit2: string): boolean {
  const cat1 = getUnitCategory(unit1)
  const cat2 = getUnitCategory(unit2)

  // Must be same category
  if (cat1 !== cat2) return false

  // Count units are not weight/volume convertible
  if (cat1 === 'count') return false

  // Portion tools are subjective, not convertible
  if (cat1 === 'portion') return false

  // Package units are not convertible
  if (cat1 === 'package') return false

  return true
}

/**
 * Get suggested units based on a parent unit (for prep items)
 */
export function getSuggestedUnits(parentUnit: string): UnitDefinition[] {
  const parentCategory = getUnitCategory(parentUnit)

  // Start with same-category units
  const sameCategory = parentCategory ? getUnitsByCategory(parentCategory) : []

  // Always include 'each' for discrete output
  const eachUnit = OUTPUT_UNITS.find(u => u.value === 'each')

  // Combine, avoiding duplicates
  const result = [...sameCategory]
  if (eachUnit && !result.find(u => u.value === 'each')) {
    result.unshift(eachUnit)
  }

  return result
}
