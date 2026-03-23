'use client'

/**
 * NoneButton — "None" option for modifier groups that allow skipping.
 *
 * When selected, clears all other selections in the group.
 * Styled as outlined when unselected, filled when selected.
 */

interface NoneButtonProps {
  groupId: string
  isSelected: boolean
  onSelect: (groupId: string) => void
}

export function NoneButton({ groupId, isSelected, onSelect }: NoneButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(groupId)}
      className="w-full flex items-center justify-center rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all"
      style={{
        minHeight: 44,
        borderColor: isSelected ? 'var(--site-brand)' : 'var(--site-border)',
        backgroundColor: isSelected ? 'var(--site-brand)' : 'transparent',
        color: isSelected ? '#fff' : 'var(--site-text)',
      }}
    >
      None
    </button>
  )
}
