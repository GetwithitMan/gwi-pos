'use client'

import { formatCurrency } from '@/lib/utils'
import type { MenuItemIngredient } from './useModifierSelections'

interface SwapPickerProps {
  ingredient: MenuItemIngredient
  currentSwap?: { modifierId: string; name: string; price: number }
  onSelect: (option: { id: string; name: string; price: number }) => void
  onCancel: () => void
}

export function SwapPicker({ ingredient, currentSwap, onSelect, onCancel }: SwapPickerProps) {
  const swapGroup = ingredient.swapModifierGroup
  const baseUpcharge = ingredient.swapUpcharge || 0

  // Check if no options available
  if (!swapGroup || !swapGroup.modifiers || swapGroup.modifiers.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]">
        <div className="mm-glass-panel rounded-2xl w-full max-w-sm p-6">
          <div className="text-center">
            <p className="text-white font-medium mb-2">No swap options available</p>
            <p className="text-slate-400 text-sm mb-4">The modifier group has no active modifiers.</p>
            <button
              onClick={onCancel}
              className="w-full bg-white/10 border border-white/20 text-slate-300 rounded-xl py-3 hover:bg-white/15 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Get cost color coding class
  const getCostClasses = (totalCost: number) => {
    if (totalCost === 0) {
      return 'text-emerald-400 border-emerald-500/30'
    } else if (totalCost <= 2.00) {
      return 'text-amber-400 border-amber-500/30'
    } else {
      return 'text-red-400 border-red-500/30'
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]">
      <div className="mm-glass-panel rounded-2xl w-full max-w-sm max-h-[85vh] overflow-hidden flex flex-col">
        {/* Drag Handle (decorative) */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-500/50" />
        </div>

        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 bg-purple-500/20">
          <h3 className="font-bold text-white flex items-center gap-2">
            <span>↔</span>
            <span>Swap {ingredient.name}</span>
          </h3>
          {baseUpcharge > 0 && (
            <p className="text-sm text-slate-300 mt-1">
              Base upcharge: +{formatCurrency(baseUpcharge)}
            </p>
          )}
        </div>

        {/* Options Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            {swapGroup.modifiers.map(option => {
              const totalCost = baseUpcharge + option.price
              const isSelected = currentSwap?.modifierId === option.id
              const costClasses = getCostClasses(totalCost)

              return (
                <button
                  key={option.id}
                  onClick={() => onSelect(option)}
                  className={`
                    relative min-h-[72px] p-3 rounded-xl
                    bg-white/[0.06] border
                    transition-all duration-200
                    hover:bg-white/10 active:scale-[0.98]
                    flex flex-col items-center justify-center gap-2
                    ${isSelected
                      ? 'border-indigo-500 shadow-lg shadow-indigo-500/20'
                      : `border-white/10 ${costClasses.split(' ')[1]}`
                    }
                  `}
                >
                  {/* Selected checkmark */}
                  {isSelected && (
                    <span className="absolute top-1 right-1 text-indigo-400 text-sm">
                      ✓
                    </span>
                  )}

                  {/* Option name */}
                  <span className="text-white font-medium text-sm text-center leading-tight">
                    {option.name}
                  </span>

                  {/* Cost */}
                  <span className={`text-xs font-semibold ${costClasses.split(' ')[0]}`}>
                    {totalCost === 0 ? 'No charge' : `+${formatCurrency(totalCost)}`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Cancel Button */}
        <div className="p-3 border-t border-white/10">
          <button
            onClick={onCancel}
            className="w-full bg-white/10 border border-white/20 text-slate-300 rounded-xl py-3 hover:bg-white/15 transition-colors font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
