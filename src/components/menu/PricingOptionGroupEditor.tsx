'use client'

import { useState, useEffect } from 'react'
import { PricingOptionRow } from './PricingOptionRow'
import type { PricingOptionGroup } from './usePricingOptions'

interface PricingOptionGroupEditorProps {
  group: PricingOptionGroup
  onUpdateGroup: (data: Partial<Pick<PricingOptionGroup, 'name' | 'isRequired' | 'showAsQuickPick'>>) => void
  onDeleteGroup: () => void
  onAddOption: (label: string) => void
  onUpdateOption: (optionId: string, data: { label?: string; price?: number | null; isDefault?: boolean; showOnPos?: boolean; color?: string | null }) => void
  onDeleteOption: (optionId: string) => void
}

export function PricingOptionGroupEditor({
  group,
  onUpdateGroup,
  onDeleteGroup,
  onAddOption,
  onUpdateOption,
  onDeleteOption,
}: PricingOptionGroupEditorProps) {
  const [name, setName] = useState(group.name)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    setName(group.name)
  }, [group.name])

  const handleNameBlur = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== group.name) {
      onUpdateGroup({ name: trimmed })
    } else if (!trimmed) {
      setName(group.name)
    }
  }

  return (
    <div className="border border-orange-200 rounded-xl bg-orange-50/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-orange-50 border-b border-orange-200 flex items-center gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          className="flex-1 bg-transparent text-sm font-semibold text-gray-800 border-0 border-b border-transparent hover:border-gray-300 focus:border-orange-400 focus:ring-0 px-0 py-0.5 min-w-0"
          placeholder="Group name"
        />

        <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={group.isRequired}
            onChange={(e) => onUpdateGroup({ isRequired: e.target.checked })}
            className="w-3.5 h-3.5 rounded text-orange-600 focus:ring-orange-400"
          />
          <span className="text-xs text-gray-600">Required</span>
        </label>

        <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={group.showAsQuickPick}
            onChange={(e) => onUpdateGroup({ showAsQuickPick: e.target.checked })}
            className="w-3.5 h-3.5 rounded text-orange-600 focus:ring-orange-400"
          />
          <span className="text-xs text-gray-600">Quick Pick</span>
        </label>

        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
          title="Delete group"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Options */}
      <div className="px-4 py-2">
        {group.options.length === 0 ? (
          <p className="text-xs text-gray-400 py-2 text-center">No options yet</p>
        ) : (
          <div className="divide-y divide-orange-100">
            {group.options.map(opt => (
              <PricingOptionRow
                key={opt.id}
                option={opt}
                showOnPosCount={group.options.filter(o => o.showOnPos).length}
                onUpdate={(data) => onUpdateOption(opt.id, data)}
                onDelete={() => onDeleteOption(opt.id)}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => onAddOption('New Option')}
          className="mt-2 text-xs text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Option
        </button>
      </div>

      {/* Delete confirmation inline */}
      {showDeleteConfirm && (
        <div className="px-4 py-3 bg-red-50 border-t border-red-200 flex items-center justify-between">
          <span className="text-xs text-red-700">Delete this group and all its options?</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="px-3 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(false)
                onDeleteGroup()
              }}
              className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
