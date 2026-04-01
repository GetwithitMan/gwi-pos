'use client'

import { BottleProduct } from './types'
import { TIER_COLORS, TIER_TEXT_COLORS, getTierLabel } from './liquor-builder-utils'

export interface SpiritEntry {
  id?: string
  bottleProductId: string
  bottleName: string
  tier: string
  price: number
  isDefault?: boolean
}

export interface SpiritTierPanelProps {
  spiritEntries: SpiritEntry[]
  bottles: BottleProduct[]
  savingSpirit: boolean
  onAddSpiritBottle: (tier: string, bottleId: string) => void
  onUpdatePrice: (modifierId: string, price: number) => void
  onRemoveEntry: (modifierId: string) => void
  onSetDefault: (modifierId: string) => void
}

const TIERS = ['well', 'call', 'premium', 'top_shelf'] as const

export function SpiritTierPanel({
  spiritEntries,
  bottles,
  savingSpirit,
  onAddSpiritBottle,
  onUpdatePrice,
  onRemoveEntry,
  onSetDefault,
}: SpiritTierPanelProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">Assign bottles from your inventory to each tier. Guests pick their spirit on the POS.</p>
      {savingSpirit && <p className="text-xs text-amber-600">Saving...</p>}
      {TIERS.map(tier => {
        const tierEntries = spiritEntries.filter(e => e.tier === tier)
        const tierLabel = getTierLabel(tier)
        const addedBottleIds = new Set(tierEntries.map(e => e.bottleProductId))
        const availableBottles = (bottles as any[]).filter((b: any) => b.tier === tier && b.isActive !== false && !addedBottleIds.has(b.id))
        return (
          <div key={tier} className={`rounded-lg border p-3 ${TIER_COLORS[tier]}`}>
            <div className={`text-xs font-bold uppercase tracking-wide mb-2 ${TIER_TEXT_COLORS[tier]}`}>{tierLabel}</div>
            {tierEntries.length === 0 && (
              <p className="text-xs text-gray-600 mb-2">No bottles assigned yet</p>
            )}
            {tierEntries.map(entry => (
              <div key={entry.id || entry.bottleProductId} className="flex items-center gap-2 mb-1.5">
                {entry.isDefault ? (
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-100 text-green-700 shrink-0">Default</span>
                ) : (
                  <button
                    onClick={() => entry.id && onSetDefault(entry.id)}
                    className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-gray-300 text-gray-900 hover:border-green-400 hover:text-green-600 hover:bg-green-50 shrink-0 transition-colors"
                    title="Set as default spirit"
                  >
                    Set default
                  </button>
                )}
                <span className="flex-1 text-sm font-medium text-gray-800 truncate">{entry.bottleName}</span>
                <span className="text-xs text-gray-900">+$</span>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  defaultValue={entry.price}
                  key={`${entry.id}-${entry.price}`}
                  onBlur={e => {
                    const price = parseFloat(e.target.value) || 0
                    if (entry.id && price !== entry.price) {
                      onUpdatePrice(entry.id, price)
                    }
                  }}
                  className="w-16 px-2 py-1 text-sm border rounded text-right bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="0.00"
                />
                <button
                  onClick={() => entry.id && onRemoveEntry(entry.id)}
                  className="text-gray-900 hover:text-red-500 text-lg leading-none shrink-0"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            {availableBottles.length > 0 && (
              <select
                key={`${tier}-${tierEntries.length}`}
                defaultValue=""
                onChange={e => {
                  const bottleId = e.target.value
                  if (bottleId) onAddSpiritBottle(tier, bottleId)
                }}
                disabled={savingSpirit}
                className="mt-1 w-full text-xs border rounded px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                <option value="">+ Add {tierLabel.charAt(0) + tierLabel.slice(1).toLowerCase()} bottle...</option>
                {availableBottles.map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
            {availableBottles.length === 0 && tierEntries.length === 0 && (
              <p className="text-xs text-gray-600 italic">No {tier.replace('_', ' ')} bottles in inventory</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
