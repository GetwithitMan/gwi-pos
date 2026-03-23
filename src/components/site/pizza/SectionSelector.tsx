'use client'

import { getAllSectionPresetsForMode, isAllowedSectionMode } from '@/lib/pizza-section-utils'

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
  const allowedModes = [1, 2, 4, 6, 8].filter((m) => isAllowedSectionMode(sectionOptions, m))

  if (allowedModes.length <= 1) return null

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--site-text-muted)' }}>
        Split Pizza
      </h3>
      <div className="flex flex-wrap gap-2">
        {allowedModes.map((mode) => {
          const isSelected = mode === selectedMode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange(mode)}
              className={`
                rounded-full border-2 px-4 py-2 text-sm font-medium transition-all
                ${isSelected
                  ? 'border-[var(--site-brand)] bg-[var(--site-brand)] text-[var(--site-text-on-brand)]'
                  : 'border-[var(--site-border)] bg-[var(--site-bg)] hover:border-[var(--site-brand)]/50'}
              `}
              style={!isSelected ? { color: 'var(--site-text)' } : undefined}
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
    <div className="flex flex-wrap gap-1.5 text-xs" style={{ color: 'var(--site-text-muted)' }}>
      {presets.map((p) => (
        <span
          key={p.position}
          className="rounded-md px-2 py-0.5"
          style={{ backgroundColor: 'var(--site-bg-secondary)' }}
        >
          {p.label}
        </span>
      ))}
    </div>
  )
}
