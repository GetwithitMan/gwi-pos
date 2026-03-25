'use client'

import { getAllSectionPresetsForMode } from '@/lib/pizza-section-utils'

interface SectionSelectorProps {
  sectionOptions: number[]
  selectedMode: number
  onModeChange: (mode: number) => void
}

const MODE_LABELS: Record<number, string> = {
  1: 'Whole',
  2: 'Halves',
  4: 'Quarters',
  6: 'Sixths',
  8: 'Eighths',
}

export function SectionSelector({ sectionOptions, selectedMode, onModeChange }: SectionSelectorProps) {
  // Only show options from venue config; default to [1,2,4] if not configured
  const allowedModes = (sectionOptions.length > 0 ? sectionOptions : [1, 2, 4])
    .filter((m) => MODE_LABELS[m])
    .sort((a, b) => a - b)

  if (allowedModes.length <= 1) return null

  return (
    <div className="py-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
        Split Pizza
      </h3>
      <div className="flex gap-2 flex-wrap">
        {allowedModes.map((mode) => {
          const isSelected = mode === selectedMode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange(mode)}
              className={`
                px-4 py-2.5 rounded-full border-2 text-sm font-medium cursor-pointer transition-all min-h-[44px]
                ${isSelected
                  ? 'border-blue-500 bg-blue-500 text-white'
                  : 'border-gray-200 text-gray-700 hover:border-gray-300'}
              `}
            >
              {MODE_LABELS[mode] || `${mode} Sections`}
            </button>
          )
        })}
      </div>
      {selectedMode > 1 && (
        <SectionPreview mode={selectedMode} />
      )}
    </div>
  )
}

function SectionPreview({ mode }: { mode: number }) {
  const presets = getAllSectionPresetsForMode(mode)
  return (
    <div className="flex flex-wrap gap-1.5 text-xs text-gray-400 mt-2">
      {presets.map((p) => (
        <span
          key={p.position}
          className="rounded-md bg-gray-100 px-2 py-0.5"
        >
          {p.label}
        </span>
      ))}
    </div>
  )
}
