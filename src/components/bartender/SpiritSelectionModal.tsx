'use client'

import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import { getDualPrices } from '@/lib/pricing'

interface SpiritOption {
  id: string
  name: string
  price: number
}

interface SpiritTiers {
  well: SpiritOption[]
  call: SpiritOption[]
  premium: SpiritOption[]
  top_shelf: SpiritOption[]
}

// Must match the config in BartenderView
const SPIRIT_TIER_CONFIG: Record<string, { label: string; color: string; hoverColor: string }> = {
  well: { label: 'Well', color: 'bg-zinc-600', hoverColor: 'hover:bg-zinc-500' },
  call: { label: 'Call', color: 'bg-sky-600', hoverColor: 'hover:bg-sky-500' },
  premium: { label: 'Prem', color: 'bg-violet-600', hoverColor: 'hover:bg-violet-500' },
  top_shelf: { label: 'Top', color: 'bg-amber-500', hoverColor: 'hover:bg-amber-400' },
}

interface SpiritSelectionModalProps {
  item: { id: string; name: string; price: number; spiritTiers?: SpiritTiers | null } | null
  selectedTier: string | null
  dualPricing: { enabled: boolean; cashDiscountPercent: number; applyToCredit: boolean; applyToDebit: boolean; showSavingsMessage: boolean }
  onSelect: (spirit: SpiritOption) => void
  onClose: () => void
}

export function SpiritSelectionModal({ item, selectedTier, dualPricing, onSelect, onClose }: SpiritSelectionModalProps) {
  return (
    <Modal isOpen={!!(item && selectedTier)} onClose={onClose} size="2xl">
      {item && selectedTier && (
        <div className="-m-5 bg-slate-800/95 border border-white/20 rounded-2xl p-4">
          {/* Header - compact */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-white">{item.name}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${SPIRIT_TIER_CONFIG[selectedTier]?.color || 'bg-slate-600'} text-white`}>
                {SPIRIT_TIER_CONFIG[selectedTier]?.label || selectedTier}
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-xl px-2"
            >
              ✕
            </button>
          </div>

          {/* Spirit options - all visible in a row */}
          <div className="flex gap-2 flex-wrap">
            {item.spiritTiers?.[selectedTier as keyof SpiritTiers]?.map(spirit => {
              const totalPrice = item.price + spirit.price
              const prices = getDualPrices(totalPrice, dualPricing)
              const displayPrice = dualPricing.enabled ? prices.cardPrice : prices.cashPrice
              return (
                <button
                  key={spirit.id}
                  onClick={() => onSelect(spirit)}
                  className={`flex-1 min-w-[100px] max-w-[160px] p-3 rounded-xl text-center transition-all ${SPIRIT_TIER_CONFIG[selectedTier]?.color || 'bg-slate-700'} hover:brightness-110 active:scale-95`}
                >
                  <div className="text-white font-bold text-sm leading-tight">{spirit.name}</div>
                  <div className="text-white/90 text-lg font-bold mt-1">
                    {formatCurrency(displayPrice)}
                  </div>
                  {spirit.price > 0 && (
                    <div className="text-white/60 text-[10px]">+{formatCurrency(spirit.price)}</div>
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
