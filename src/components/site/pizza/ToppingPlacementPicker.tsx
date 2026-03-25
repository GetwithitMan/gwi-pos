'use client'

import { getAllSectionPresetsForMode, getSectionPreset, TOTAL_SECTIONS } from '@/lib/pizza-section-utils'

interface ToppingPlacementPickerProps {
  sectionMode: number
  selectedSections: number[]
  onChange: (sections: number[]) => void
  /** If true, allow selecting multiple sections (e.g., pepperoni on left AND right). Default: true */
  multiSelect?: boolean
}

export function ToppingPlacementPicker({
  sectionMode,
  selectedSections,
  onChange,
  multiSelect = true,
}: ToppingPlacementPickerProps) {
  if (sectionMode <= 1) return null

  const presets = getAllSectionPresetsForMode(sectionMode)
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
    if (multiSelect) {
      // Multi-select: toggle this section on/off
      const alreadySelected = isSectionSelected(sectionIndices)

      if (alreadySelected) {
        // Remove these sections
        const remaining = selectedSections.filter(s => !sectionIndices.includes(s))
        // Don't allow empty — keep at least this section if removing would empty
        onChange(remaining.length > 0 ? remaining : sectionIndices)
      } else {
        // Add these sections (merge with existing, dedupe)
        const merged = [...new Set([...selectedSections, ...sectionIndices])].sort((a, b) => a - b)
        // Check if all sections now selected → treat as whole
        const allSelected = presets.every(p => p.sections.every(s => merged.includes(s)))
        onChange(allSelected ? wholePreset : merged)
      }
    } else {
      // Single-select: replace
      onChange(sectionIndices)
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
