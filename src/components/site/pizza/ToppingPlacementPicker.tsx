'use client'

import { getAllSectionPresetsForMode, getSectionPreset, TOTAL_SECTIONS } from '@/lib/pizza-section-utils'

interface ToppingPlacementPickerProps {
  sectionMode: number
  selectedSections: number[]
  onChange: (sections: number[]) => void
  /**
   * Max division level for this picker.
   * - For toppings: uses the pizza's sectionMode (halves, quarters, sixths, eighths)
   * - For sauce/cheese: capped by condimentDivisionMax (typically 1=whole, 2=halves, 3=thirds)
   * If not provided, defaults to sectionMode.
   */
  maxDivision?: number
  /** If true, allow selecting multiple sections. Default: true for toppings. */
  multiSelect?: boolean
}

export function ToppingPlacementPicker({
  sectionMode,
  selectedSections,
  onChange,
  maxDivision,
  multiSelect = true,
}: ToppingPlacementPickerProps) {
  if (sectionMode <= 1) return null

  // Use maxDivision to limit which section modes are shown
  // e.g., sauce/cheese might only get whole/halves/thirds even if pizza is in quarters
  const effectiveMode = maxDivision ? Math.min(sectionMode, maxDivision) : sectionMode
  const presets = getAllSectionPresetsForMode(effectiveMode)
  const wholePreset = getSectionPreset(1, 0)

  const isWhole = selectedSections.length === TOTAL_SECTIONS ||
    (selectedSections.length === wholePreset.length && wholePreset.every(s => selectedSections.includes(s)))

  const isSectionSelected = (sectionIndices: number[]) => {
    return sectionIndices.every(idx => selectedSections.includes(idx))
  }

  const handleWholeToggle = () => {
    onChange(wholePreset)
  }

  const handleSectionToggle = (sectionIndices: number[]) => {
    if (!multiSelect) {
      // Single-select (sauce/cheese): just replace
      onChange(sectionIndices)
      return
    }

    // Multi-select (toppings):
    if (isWhole) {
      // Currently "Whole" → clicking a section means "just this section"
      onChange(sectionIndices)
      return
    }

    const alreadySelected = isSectionSelected(sectionIndices)

    if (alreadySelected) {
      // Remove these sections
      const remaining = selectedSections.filter(s => !sectionIndices.includes(s))
      if (remaining.length > 0) {
        onChange(remaining)
      }
      // If removing would leave empty, do nothing (keep current)
    } else {
      // Add these sections
      const merged = [...new Set([...selectedSections, ...sectionIndices])].sort((a, b) => a - b)
      // Check if all sections now selected → auto-convert to whole
      const allSelected = presets.every(p => p.sections.every(s => merged.includes(s)))
      onChange(allSelected ? wholePreset : merged)
    }
  }

  return (
    <div className="space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Placement</span>
      <div className="flex flex-wrap gap-1">
        {/* Whole option */}
        <PlacementButton
          label="Whole"
          isSelected={isWhole}
          onClick={handleWholeToggle}
        />
        {/* Per-section options */}
        {presets.map((preset) => {
          const selected = !isWhole && isSectionSelected(preset.sections)
          return (
            <PlacementButton
              key={preset.position}
              label={preset.label}
              isSelected={selected}
              onClick={() => handleSectionToggle(preset.sections)}
            />
          )
        })}
      </div>
    </div>
  )
}

function PlacementButton({
  label,
  isSelected,
  onClick,
}: {
  label: string
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all min-h-[36px] ${!isSelected ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'text-white'}`}
      style={isSelected ? { backgroundColor: 'var(--site-brand)' } : undefined}
    >
      {label}
    </button>
  )
}
