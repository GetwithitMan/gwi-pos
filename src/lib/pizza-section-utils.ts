/**
 * Pizza Section Normalization — Single Source of Truth
 *
 * The pizza system uses a 24-section internal model (indices 0–23) to represent
 * which portions of a pizza each topping/sauce/cheese covers. This allows
 * arbitrary subdivision: whole, halves, quarters, sixths, or eighths.
 *
 * Section layout (clockwise from top-right):
 *   WHOLE:    [0,1,2,...,23]
 *   RIGHT:    [0,1,2,3,4,5,6,7,8,9,10,11]
 *   LEFT:     [12,13,14,15,16,17,18,19,20,21,22,23]
 *   QUARTERS: [0-5], [6-11], [12-17], [18-23]
 *   SIXTHS:   [0-3], [4-7], [8-11], [12-15], [16-19], [20-23]
 *   EIGHTHS:  [0-2], [3-5], [6-8], [9-11], [12-14], [15-17], [18-20], [21-23]
 *
 * Used by: PizzaBuilder UI, CartItemRow display, checkout-quote, checkout validation.
 * Never duplicate this logic — import from here.
 */

export const TOTAL_SECTIONS = 24
export const DEFAULT_SECTION_OPTIONS = [1, 2, 4]

/** Valid section modes: 1=whole, 2=halves, 4=quarters, 6=sixths, 8=eighths */
export type SectionMode = 1 | 2 | 4 | 6 | 8

const SECTIONS_PER_MODE: Record<number, number> = {
  1: 24,
  2: 12,
  4: 6,
  6: 4,
  8: 3,
}

/**
 * Returns the canonical section array for a given mode and position.
 *
 * @param mode - How many slices the pizza is split into (1, 2, 4, 6, or 8)
 * @param position - 0-indexed position within the mode (e.g., 0 = first section, 1 = second)
 * @returns Sorted array of section indices
 *
 * @example
 * getSectionPreset(1, 0) // [0,1,2,...,23] (whole)
 * getSectionPreset(2, 0) // [0,1,...,11]   (right half)
 * getSectionPreset(2, 1) // [12,13,...,23] (left half)
 * getSectionPreset(4, 2) // [12,13,...,17] (quarter 3)
 */
export function getSectionPreset(mode: number, position: number): number[] {
  const sectionsPerSlice = SECTIONS_PER_MODE[mode]
  if (sectionsPerSlice === undefined) {
    throw new Error(`Invalid section mode: ${mode}. Must be 1, 2, 4, 6, or 8.`)
  }
  if (position < 0 || position >= mode) {
    throw new Error(`Invalid position ${position} for mode ${mode}. Must be 0-${mode - 1}.`)
  }

  // Whole pizza: special case (mode=1, position=0)
  if (mode === 1) {
    return Array.from({ length: TOTAL_SECTIONS }, (_, i) => i)
  }

  const start = position * sectionsPerSlice
  return Array.from({ length: sectionsPerSlice }, (_, i) => start + i)
}

/**
 * Check if a section mode is allowed by the venue's configuration.
 *
 * @param sectionOptions - Array of allowed modes from PizzaConfig (e.g., [1, 2, 4])
 * @param mode - The mode to check
 */
export function isAllowedSectionMode(sectionOptions: number[], mode: number): boolean {
  return sectionOptions.includes(mode)
}

/** Human-readable labels for halves */
const HALF_LABELS = ['Right Half', 'Left Half']

/** Human-readable labels for quarters */
const QUARTER_LABELS = ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']

/** Generate ordinal labels for 6ths and 8ths */
function getOrdinalLabel(mode: number, position: number): string {
  return `${mode === 6 ? 'Sixth' : 'Eighth'} ${position + 1}`
}

/**
 * Returns a human-readable label for a given section array.
 *
 * @param sections - The section indices (e.g., [0,1,2,3,4,5])
 * @param sectionMode - The mode the pizza is split into (for context in labels)
 * @returns Human-readable string like "Whole", "Left Half", "Quarter 3", etc.
 *
 * @example
 * humanizeSections([0,1,...,23], 1) // "Whole"
 * humanizeSections([12,...,23], 2)  // "Left Half"
 * humanizeSections([6,...,11], 4)   // "Quarter 2"
 */
export function humanizeSections(sections: number[], sectionMode: number): string {
  const sorted = normalizeSectionsForStorage(sections)

  // Whole pizza
  if (sorted.length === TOTAL_SECTIONS) {
    return 'Whole'
  }

  // Try to match against presets for the given mode
  const validModes: number[] = [2, 4, 6, 8]
  const modeToCheck = validModes.includes(sectionMode) ? sectionMode : 0

  // First: check against the specified mode
  if (modeToCheck > 0) {
    for (let pos = 0; pos < modeToCheck; pos++) {
      const preset = getSectionPreset(modeToCheck, pos)
      if (arraysEqual(sorted, preset)) {
        if (modeToCheck === 2) return HALF_LABELS[pos]
        if (modeToCheck === 4) return QUARTER_LABELS[pos]
        return getOrdinalLabel(modeToCheck, pos)
      }
    }
  }

  // Fallback: try all modes to find a match
  for (const mode of validModes) {
    if (mode === modeToCheck) continue // already checked
    for (let pos = 0; pos < mode; pos++) {
      const preset = getSectionPreset(mode, pos)
      if (arraysEqual(sorted, preset)) {
        if (mode === 2) return HALF_LABELS[pos]
        if (mode === 4) return QUARTER_LABELS[pos]
        return getOrdinalLabel(mode, pos)
      }
    }
  }

  // Multi-section selection that doesn't match a single preset
  const coverage = getSectionCoverage(sorted)
  const pct = Math.round(coverage * 100)
  return `Custom (${pct}%)`
}

/**
 * Sort and deduplicate a section array for consistent storage.
 * Ensures [5,3,1,3] becomes [1,3,5].
 */
export function normalizeSectionsForStorage(sections: number[]): number[] {
  const unique = Array.from(new Set(sections))
  return unique.sort((a, b) => a - b)
}

/**
 * Calculate what fraction of the pizza these sections cover (0–1).
 * Used by pricing to compute fractional topping costs.
 *
 * @example
 * getSectionCoverage([0,1,...,23]) // 1.0  (whole)
 * getSectionCoverage([0,1,...,11]) // 0.5  (half)
 * getSectionCoverage([0,1,...,5])  // 0.25 (quarter)
 */
export function getSectionCoverage(sections: number[]): number {
  const unique = new Set(sections)
  return unique.size / TOTAL_SECTIONS
}

/**
 * Get all section presets for a given mode, with labels.
 * Useful for rendering section picker UIs.
 *
 * @example
 * getAllSectionPresetsForMode(2)
 * // [
 * //   { position: 0, sections: [0,...,11], label: "Right Half" },
 * //   { position: 1, sections: [12,...,23], label: "Left Half" }
 * // ]
 */
export function getAllSectionPresetsForMode(
  mode: number
): Array<{ position: number; sections: number[]; label: string }> {
  if (!SECTIONS_PER_MODE[mode]) {
    throw new Error(`Invalid section mode: ${mode}. Must be 1, 2, 4, 6, or 8.`)
  }

  const results: Array<{ position: number; sections: number[]; label: string }> = []

  if (mode === 1) {
    results.push({ position: 0, sections: getSectionPreset(1, 0), label: 'Whole' })
    return results
  }

  for (let pos = 0; pos < mode; pos++) {
    const sections = getSectionPreset(mode, pos)
    let label: string
    if (mode === 2) label = HALF_LABELS[pos]
    else if (mode === 4) label = QUARTER_LABELS[pos]
    else label = getOrdinalLabel(mode, pos)

    results.push({ position: pos, sections, label })
  }

  return results
}

/** Internal helper: check sorted-array equality */
function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
