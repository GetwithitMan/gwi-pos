'use client'

import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import type { EnginePricingOption, EnginePricingOptionGroup } from '@/hooks/useOrderingEngine'

interface PricingOptionPickerProps {
  item: { id: string; name: string; price: number; pricingOptionGroups?: EnginePricingOptionGroup[] } | null
  onSelect: (option: EnginePricingOption) => void
  onClose: () => void
}

export function PricingOptionPicker({ item, onSelect, onClose }: PricingOptionPickerProps) {
  const group = item?.pricingOptionGroups?.[0]

  return (
    <Modal isOpen={!!item} onClose={onClose} size="2xl">
      {item && group && (
        <div className="-m-5 bg-slate-800/95 border border-white/20 rounded-2xl p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-white">{item.name}</span>
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-indigo-600 text-white">
                {group.name}
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-xl px-2"
            >
              ✕
            </button>
          </div>

          {/* Options row */}
          <div className="flex gap-2 flex-wrap">
            {group.options.slice(0, 4).map(option => {
              const isVariant = option.price !== null
              const displayPrice = isVariant ? option.price! : item.price
              const bgColor = option.color || 'bg-indigo-600'
              // Use inline style if color is a hex value, otherwise use as class
              const isHex = bgColor.startsWith('#') || bgColor.startsWith('rgb')
              return (
                <button
                  key={option.id}
                  onClick={() => onSelect(option)}
                  className={`flex-1 min-w-[100px] max-w-[160px] p-3 rounded-xl text-center transition-all hover:brightness-110 active:scale-95 ${isHex ? '' : bgColor}`}
                  style={isHex ? { backgroundColor: bgColor } : undefined}
                >
                  <div className="text-white font-bold text-sm leading-tight">{option.label}</div>
                  <div className="text-white/90 text-lg font-bold mt-1">
                    {formatCurrency(displayPrice)}
                  </div>
                  {isVariant && option.price! !== item.price && (
                    <div className="text-white/60 text-[10px]">
                      {option.price! > item.price ? '+' : ''}{formatCurrency(option.price! - item.price)}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
