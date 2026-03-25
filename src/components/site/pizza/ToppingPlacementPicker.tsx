'use client'

import { getAllSectionPresetsForMode, getSectionPreset } from '@/lib/pizza-section-utils'

interface ToppingPlacementPickerProps {
  sectionMode: number
  selectedSections: number[]
  onChange: (sections: number[]) => void
}

export function ToppingPlacementPicker({ sectionMode, selectedSections, onChange }: ToppingPlacementPickerProps) {
  // For whole pizzas, no placement picker needed
  if (sectionMode <= 1) return null

  const presets = getAllSectionPresetsForMode(sectionMode)
  const wholePreset = getSectionPreset(1, 0)
  const isWhole = selectedSections.length === wholePreset.length

  return (
    <div className="flex flex-wrap gap-1">
      {/* Whole option */}
      <PlacementButton
        label="Whole"
        isSelected={isWhole}
        onClick={() => onChange(wholePreset)}
      />
      {/* Per-section options */}
      {presets.map((preset) => {
        const isSelected = !isWhole && arraysMatch(selectedSections, preset.sections)
        return (
          <PlacementButton
            key={preset.position}
            label={preset.label}
            isSelected={isSelected}
            onClick={() => onChange(preset.sections)}
          />
        )
      })}
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
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!isSelected ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'text-white'}`}
      style={isSelected ? { backgroundColor: 'var(--site-brand)' } : undefined}
    >
      {label}
    </button>
  )
}

function arraysMatch(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort((x, y) => x - y)
  const sortedB = [...b].sort((x, y) => x - y)
  return sortedA.every((v, i) => v === sortedB[i])
}
