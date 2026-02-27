'use client'

import { usePricingOptions } from './usePricingOptions'
import { PricingOptionGroupEditor } from './PricingOptionGroupEditor'

interface QuickPickTabProps {
  itemId: string
}

export function QuickPickTab({ itemId }: QuickPickTabProps) {
  const {
    groups,
    loading,
    saving,
    addGroup,
    updateGroup,
    deleteGroup,
    addOption,
    updateOption,
    deleteOption,
  } = usePricingOptions(itemId)

  // Only show groups marked as quick picks
  const quickPickGroups = groups.filter(g => g.showAsQuickPick)

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-gray-400">Loading quick picks...</div>
    )
  }

  return (
    <div className="space-y-4">
      {quickPickGroups.length === 0 ? (
        <div className="py-8 text-center">
          <svg className="w-10 h-10 mx-auto mb-3 text-orange-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <p className="text-sm font-medium text-gray-600">No quick pick labels yet</p>
          <p className="text-xs text-gray-400 mt-1">Quick picks appear as buttons on the POS order screen for fast selection</p>
          <button
            type="button"
            onClick={() => addGroup('New Quick Pick Group', true)}
            disabled={saving}
            className="mt-4 px-4 py-2 text-sm font-semibold text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            Create First Quick Pick Group
          </button>
        </div>
      ) : (
        <>
          {quickPickGroups.map(group => (
            <PricingOptionGroupEditor
              key={group.id}
              group={group}
              onUpdateGroup={(data) => updateGroup(group.id, data)}
              onDeleteGroup={() => deleteGroup(group.id)}
              onAddOption={(label) => addOption(group.id, label)}
              onUpdateOption={(optionId, data) => updateOption(group.id, optionId, data)}
              onDeleteOption={(optionId) => deleteOption(group.id, optionId)}
            />
          ))}
          <button
            type="button"
            onClick={() => addGroup('New Quick Pick Group', true)}
            disabled={saving}
            className="w-full py-2 border-2 border-dashed border-orange-300 rounded-xl text-sm font-medium text-orange-600 hover:bg-orange-50 hover:border-orange-400 transition-colors disabled:opacity-50"
          >
            + Add Quick Pick Group
          </button>
        </>
      )}

      <p className="text-[11px] text-gray-400 text-center">
        Changes save automatically. Quick picks appear as buttons on the POS order screen.
      </p>
    </div>
  )
}
