'use client'

import Link from 'next/link'

export interface ModifierTemplatesPanelProps {
  modifierGroups: any[]
  selectedDrink: any | null
  drinkModifierGroups: any[]
  attachingGroupId: string | null
  onAttachGroup: (group: any) => Promise<void>
  setAttachingGroupId: (id: string | null) => void
}

export function ModifierTemplatesPanel({
  modifierGroups,
  selectedDrink,
  drinkModifierGroups,
  attachingGroupId,
  onAttachGroup,
  setAttachingGroupId,
}: ModifierTemplatesPanelProps) {
  return (
    <div className="w-64 bg-white border-l flex flex-col shrink-0 overflow-hidden">
      <div className="px-3 py-2 border-b shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase text-gray-900 font-semibold tracking-wide">Modifier Templates</span>
        </div>
        <Link href="/liquor-modifiers" className="text-[10px] text-purple-600 hover:text-purple-700 font-medium">
          Manage Templates →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {modifierGroups.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-600">
            <p className="mb-2">No modifier templates yet.</p>
            <p className="text-gray-600 mb-3">Create templates in the Modifier Templates page, then attach them here.</p>
            <Link href="/liquor-modifiers" className="text-purple-600 hover:text-purple-700 font-medium">
              Create templates →
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5">
            {selectedDrink && (
              <p className="text-[10px] text-purple-600 font-medium px-1 pb-1">
                Tap to attach to {selectedDrink.name || 'this drink'}:
              </p>
            )}
            {modifierGroups.map((group: any) => {
              const isAlreadyAdded = selectedDrink &&
                drinkModifierGroups.some((mg: any) => mg.name === group.name && !mg.isSpiritGroup)
              return (
                <button
                  key={group.id}
                  disabled={!!attachingGroupId || !selectedDrink || !!isAlreadyAdded}
                  onClick={async () => {
                    if (selectedDrink && !group.isSpiritGroup && !isAlreadyAdded) {
                      setAttachingGroupId(group.id)
                      try {
                        await onAttachGroup(group)
                      } finally {
                        setAttachingGroupId(null)
                      }
                    }
                  }}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                    isAlreadyAdded
                      ? 'bg-green-50 border-green-200 cursor-default'
                      : attachingGroupId === group.id
                      ? 'bg-blue-50 border-blue-300'
                      : selectedDrink
                      ? 'bg-white border-purple-200 hover:bg-purple-50 hover:border-purple-400'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm truncate">{group.name}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-xs text-gray-600">{group.modifiers?.length ?? 0} options</span>
                    {isAlreadyAdded ? (
                      <span className="text-xs text-green-600">✓ Added</span>
                    ) : attachingGroupId === group.id ? (
                      <span className="text-xs text-blue-600">Adding...</span>
                    ) : selectedDrink ? (
                      <span className="text-xs text-purple-500">+ Attach</span>
                    ) : (
                      <span className="text-xs text-gray-600">{group.modifiers?.length ?? 0} opts</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
