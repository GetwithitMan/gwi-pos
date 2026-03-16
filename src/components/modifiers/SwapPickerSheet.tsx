'use client'

import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import type { SwapTarget } from '@/components/menu/item-editor-types'

interface SwapPickerSheetProps {
  targets: SwapTarget[]
  modifierName: string
  isOpen: boolean
  onClose: () => void
  onSelectTarget: (target: SwapTarget) => void
}

export function SwapPickerSheet({ targets, modifierName, isOpen, onClose, onSelectTarget }: SwapPickerSheetProps) {
  if (!isOpen) return null

  const sorted = [...targets].sort((a, b) => a.sortOrder - b.sortOrder)

  const getPriceBadge = (target: SwapTarget) => {
    if (target.pricingMode === 'no_charge') return { text: 'Free', className: 'text-emerald-400' }
    if (target.pricingMode === 'fixed_price') {
      const price = target.fixedPrice ?? 0
      return price === 0
        ? { text: 'Free', className: 'text-emerald-400' }
        : { text: `+${formatCurrency(price)}`, className: 'text-amber-400' }
    }
    // target_price
    return target.snapshotPrice > 0
      ? { text: `+${formatCurrency(target.snapshotPrice)}`, className: 'text-amber-400' }
      : { text: 'Item price', className: 'text-gray-400' }
  }

  return (
    <Modal isOpen={true} onClose={onClose} size="sm">
      <div className="-m-5 mm-glass-panel rounded-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Drag Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-500/50" />
        </div>

        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 bg-purple-500/20">
          <h3 className="font-bold text-white flex items-center gap-2">
            <span>↔</span>
            <span>Swap {modifierName}</span>
          </h3>
          <p className="text-sm text-gray-400 mt-0.5">Choose a substitute</p>
        </div>

        {/* Target list */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-2">
            {sorted.map(target => {
              const badge = getPriceBadge(target)

              return (
                <button
                  key={target.menuItemId}
                  onClick={() => {
                    onSelectTarget(target)
                    onClose()
                  }}
                  className="
                    w-full p-3 rounded-xl
                    bg-white/[0.06] border border-white/10
                    transition-all duration-200
                    hover:bg-white/10 active:scale-[0.98]
                    flex items-center justify-between gap-3
                  "
                >
                  <span className="font-medium text-white text-sm text-left truncate">
                    {target.name}
                  </span>
                  <span className={`text-xs font-semibold flex-shrink-0 ${badge.className}`}>
                    {badge.text}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Cancel */}
        <div className="p-3 border-t border-white/10">
          <button
            onClick={onClose}
            className="w-full bg-white/10 border border-white/20 text-slate-300 rounded-xl py-3 hover:bg-white/15 transition-colors font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
