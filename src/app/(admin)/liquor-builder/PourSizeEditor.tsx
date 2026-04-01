'use client'

import { useState } from 'react'
import { calculateCardPrice } from '@/lib/pricing'
import { toast } from '@/stores/toast-store'
import { DEFAULT_POUR_SIZES, PourSizeConfig } from './liquor-builder-utils'

export interface PourSizeEditorProps {
  editingDrinkPrice: string
  enabledPourSizes: Record<string, PourSizeConfig>
  defaultPourSize: string
  applyPourToModifiers: boolean
  hideDefaultOnPos: boolean
  isDualPricingEnabled: boolean
  cashDiscountPct: number
  onTogglePourSize: (size: string) => void
  onUpdateLabel: (size: string, label: string) => void
  onUpdateMultiplier: (size: string, multiplier: number) => void
  onUpdateCustomPrice: (size: string, customPrice: number | null) => void
  onSetDefaultPourSize: (size: string) => void
  onSetApplyPourToModifiers: (value: boolean) => void
  onSetHideDefaultOnPos: (value: boolean) => void
  onSetEnabledPourSizes: React.Dispatch<React.SetStateAction<Record<string, PourSizeConfig>>>
}

export function PourSizeEditor({
  editingDrinkPrice,
  enabledPourSizes,
  defaultPourSize,
  applyPourToModifiers,
  hideDefaultOnPos,
  isDualPricingEnabled,
  cashDiscountPct,
  onTogglePourSize,
  onUpdateLabel,
  onUpdateMultiplier,
  onUpdateCustomPrice,
  onSetDefaultPourSize,
  onSetApplyPourToModifiers,
  onSetHideDefaultOnPos,
  onSetEnabledPourSizes,
}: PourSizeEditorProps) {
  // Custom pour size creation
  const [showCustomPourForm, setShowCustomPourForm] = useState(false)
  const [customPourKey, setCustomPourKey] = useState('')
  const [customPourLabel, setCustomPourLabel] = useState('')
  const [customPourMultiplier, setCustomPourMultiplier] = useState('1.0')
  const [customPourPrice, setCustomPourPrice] = useState('')

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Pour Size Buttons</h3>
        <span className="text-xs text-gray-600">Shot / Tall / Short / Double</span>
      </div>
      <p className="text-xs text-gray-600 mb-3">Enable size variants for this item. Each multiplies the base price, or set a custom price override.</p>
      <div className="space-y-2 mb-3">
        {/* Standard Pour -- always on, represents the base item tap */}
        {(() => {
          const basePrice = parseFloat(editingDrinkPrice) || 0
          return (
            <div className="p-2.5 border rounded-lg border-indigo-300 bg-indigo-50">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked disabled className="w-4 h-4 text-indigo-600 shrink-0 opacity-60" />
                <span className="flex-1 text-sm font-medium text-indigo-800">Standard Pour</span>
                <span className="text-xs text-indigo-600">1.0x — Base price</span>
                <span className="text-sm font-semibold text-indigo-700">${basePrice.toFixed(2)}</span>
                {isDualPricingEnabled && (
                  <span className="text-[10px] text-blue-500">Card: ${calculateCardPrice(basePrice, cashDiscountPct).toFixed(2)}</span>
                )}
                {defaultPourSize === 'standard' && (
                  <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded shrink-0">Default</span>
                )}
              </div>
              <div className="mt-1 ml-6 text-[11px] text-indigo-600">Always on — this is the main item tap price. Select a quick pick below to change the default.</div>
            </div>
          )
        })()}
        {/* Quick pick pour size buttons */}
        {Object.entries(DEFAULT_POUR_SIZES).filter(([sizeKey]) => sizeKey !== 'standard').map(([sizeKey, defaults]) => {
          const isEnabled = enabledPourSizes[sizeKey] !== undefined
          const current = enabledPourSizes[sizeKey]
          const basePrice = parseFloat(editingDrinkPrice) || 0
          const autoPrice = basePrice * (current?.multiplier ?? defaults.multiplier)
          const hasCustomPrice = current?.customPrice != null
          return (
            <div key={sizeKey} className={`p-2.5 border rounded-lg transition-colors ${isEnabled ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => onTogglePourSize(sizeKey)}
                  className="w-4 h-4 text-purple-600 shrink-0"
                />
                {isEnabled ? (
                  <>
                    <input
                      type="text"
                      value={current?.label || ''}
                      onChange={e => onUpdateLabel(sizeKey, e.target.value)}
                      className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="Button label"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        step="0.25"
                        min="0.25"
                        defaultValue={current?.multiplier ?? 1}
                        key={`${sizeKey}-${current?.multiplier}`}
                        onBlur={e => {
                          const num = parseFloat(e.target.value)
                          if (!isNaN(num) && num > 0) onUpdateMultiplier(sizeKey, num)
                          else e.target.value = String(current?.multiplier || 1)
                        }}
                        className="w-14 px-1 py-1 text-sm border rounded text-center focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                      <span className="text-xs text-purple-600">x</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={hasCustomPrice ? current!.customPrice! : ''}
                        key={`${sizeKey}-custom-${current?.customPrice ?? 'none'}`}
                        placeholder={autoPrice.toFixed(2)}
                        onBlur={e => {
                          const val = e.target.value.trim()
                          if (val === '') {
                            onUpdateCustomPrice(sizeKey, null)
                          } else {
                            const num = parseFloat(val)
                            if (!isNaN(num) && num >= 0) onUpdateCustomPrice(sizeKey, num)
                            else e.target.value = hasCustomPrice ? String(current!.customPrice!) : ''
                          }
                        }}
                        className={`w-20 px-1 py-1 text-sm border rounded text-right focus:outline-none focus:ring-1 focus:ring-purple-500 ${hasCustomPrice ? 'border-green-400 bg-green-50' : ''}`}
                        title={hasCustomPrice ? 'Custom price override (clear to use auto-calculated)' : `Auto-calculated: $${autoPrice.toFixed(2)}`}
                      />
                    </div>
                    {isEnabled && defaultPourSize === sizeKey && (
                      <span className="text-[10px] bg-purple-600 text-white px-1.5 py-0.5 rounded shrink-0">Default</span>
                    )}
                    {isEnabled && defaultPourSize !== sizeKey && (
                      <button
                        onClick={() => onSetDefaultPourSize(sizeKey)}
                        className="text-[10px] text-purple-500 hover:text-purple-700 shrink-0"
                      >Set default</button>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-between text-gray-600">
                    <span className="text-sm">{defaults.label}</span>
                    <span className="text-xs">{defaults.multiplier}x</span>
                  </div>
                )}
              </div>
              {isEnabled && hasCustomPrice && (
                <div className="mt-1 ml-6 flex items-center gap-2 text-[11px] text-green-700">
                  <span>
                    Custom price: ${current!.customPrice!.toFixed(2)} (auto would be ${autoPrice.toFixed(2)})
                    {isDualPricingEnabled && (
                      <span className="text-indigo-500 ml-1">
                        | Card: ${calculateCardPrice(current!.customPrice!, cashDiscountPct).toFixed(2)}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => onUpdateCustomPrice(sizeKey, null)}
                    className="text-[10px] text-red-500 hover:text-red-700 underline shrink-0"
                  >
                    Reset to Default
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Custom Pour Sizes */}
      {Object.entries(enabledPourSizes).filter(([key]) => !Object.keys(DEFAULT_POUR_SIZES).includes(key)).length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Custom Pour Sizes</div>
          <div className="space-y-2">
            {Object.entries(enabledPourSizes).filter(([key]) => !Object.keys(DEFAULT_POUR_SIZES).includes(key)).map(([sizeKey, current]) => {
              const basePrice = parseFloat(editingDrinkPrice) || 0
              const autoPrice = basePrice * (current?.multiplier ?? 1)
              const hasCustomPrice = current?.customPrice != null
              return (
                <div key={sizeKey} className="p-2.5 border rounded-lg border-orange-300 bg-orange-50">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={current?.label || sizeKey}
                      onChange={e => onUpdateLabel(sizeKey, e.target.value)}
                      className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
                      placeholder="Button label"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        step="0.25"
                        min="0.25"
                        defaultValue={current?.multiplier ?? 1}
                        key={`custom-${sizeKey}-${current?.multiplier}`}
                        onBlur={e => {
                          const num = parseFloat(e.target.value)
                          if (!isNaN(num) && num > 0) onUpdateMultiplier(sizeKey, num)
                          else e.target.value = String(current?.multiplier || 1)
                        }}
                        className="w-14 px-1 py-1 text-sm border rounded text-center focus:outline-none focus:ring-1 focus:ring-orange-500"
                      />
                      <span className="text-xs text-orange-600">x</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={hasCustomPrice ? current!.customPrice! : ''}
                        key={`custom-${sizeKey}-cp-${current?.customPrice ?? 'none'}`}
                        placeholder={autoPrice.toFixed(2)}
                        onBlur={e => {
                          const val = e.target.value.trim()
                          if (val === '') onUpdateCustomPrice(sizeKey, null)
                          else {
                            const num = parseFloat(val)
                            if (!isNaN(num) && num >= 0) onUpdateCustomPrice(sizeKey, num)
                          }
                        }}
                        className={`w-20 px-1 py-1 text-sm border rounded text-right focus:outline-none focus:ring-1 focus:ring-orange-500 ${hasCustomPrice ? 'border-green-400 bg-green-50' : ''}`}
                      />
                    </div>
                    {defaultPourSize === sizeKey && (
                      <span className="text-[10px] bg-orange-600 text-white px-1.5 py-0.5 rounded shrink-0">Default</span>
                    )}
                    {defaultPourSize !== sizeKey && (
                      <button
                        onClick={() => onSetDefaultPourSize(sizeKey)}
                        className="text-[10px] text-orange-500 hover:text-orange-700 shrink-0"
                      >Set default</button>
                    )}
                    <button
                      onClick={() => {
                        const newSizes = { ...enabledPourSizes }
                        delete newSizes[sizeKey]
                        onSetEnabledPourSizes(newSizes)
                        if (defaultPourSize === sizeKey) onSetDefaultPourSize('standard')
                      }}
                      className="text-red-400 hover:text-red-600 text-lg leading-none shrink-0"
                      title="Remove custom pour size"
                    >
                      x
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Add Custom Pour Size button + form */}
      {!showCustomPourForm ? (
        <button
          onClick={() => { setShowCustomPourForm(true); setCustomPourKey(''); setCustomPourLabel(''); setCustomPourMultiplier('1.0'); setCustomPourPrice('') }}
          className="mt-2 text-xs text-orange-600 hover:text-orange-800 font-medium"
        >
          + Add Custom Pour Size
        </button>
      ) : (
        <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="text-[10px] font-bold uppercase text-orange-600 tracking-wider mb-2">New Custom Pour Size</div>
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div className="col-span-2">
              <label className="block text-[10px] text-gray-600 mb-0.5">Label</label>
              <input
                type="text"
                value={customPourLabel}
                onChange={e => {
                  setCustomPourLabel(e.target.value)
                  // Auto-generate key from label
                  setCustomPourKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
                }}
                placeholder="e.g. Triple, Pint, Goblet"
                className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 mb-0.5">Multiplier</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                value={customPourMultiplier}
                onChange={e => setCustomPourMultiplier(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 mb-0.5">Price (opt)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={customPourPrice}
                onChange={e => setCustomPourPrice(e.target.value)}
                placeholder="auto"
                className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!customPourLabel.trim() || !customPourKey.trim()) return
                const mult = parseFloat(customPourMultiplier) || 1.0
                const price = customPourPrice ? parseFloat(customPourPrice) : null
                // Check for key collision
                if (enabledPourSizes[customPourKey] || DEFAULT_POUR_SIZES[customPourKey]) {
                  toast.error('A pour size with this name already exists')
                  return
                }
                onSetEnabledPourSizes(prev => ({
                  ...prev,
                  [customPourKey]: {
                    label: customPourLabel.trim(),
                    multiplier: mult,
                    ...(price != null ? { customPrice: price } : {}),
                  }
                }))
                setShowCustomPourForm(false)
                setCustomPourKey('')
                setCustomPourLabel('')
                setCustomPourMultiplier('1.0')
                setCustomPourPrice('')
              }}
              disabled={!customPourLabel.trim()}
              className="px-3 py-1.5 text-xs font-medium bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => setShowCustomPourForm(false)}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Hide default pour on POS toggle */}
      {Object.keys(enabledPourSizes).length > 0 && (
        <label className="flex items-center gap-2 cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={hideDefaultOnPos}
            onChange={e => onSetHideDefaultOnPos(e.target.checked)}
            className="w-4 h-4 text-purple-600"
          />
          <span className="text-xs text-gray-900">Hide default pour button on POS</span>
          <span className="text-[10px] text-gray-500">(tapping the item already uses the default)</span>
        </label>
      )}
      {Object.keys(enabledPourSizes).length > 0 && (
        <label className="flex items-center gap-2 cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={applyPourToModifiers}
            onChange={e => onSetApplyPourToModifiers(e.target.checked)}
            className="w-4 h-4 text-purple-600"
          />
          <span className="text-xs text-gray-900">Apply multiplier to spirit upgrade charges too</span>
        </label>
      )}
      {Object.keys(enabledPourSizes).length > 0 && (
        <>
          <p className="text-xs text-gray-600 mt-1 ml-6">
            Price on POS: base price x multiplier, or set a custom price to override.
          </p>
          <div className="ml-6 mt-0.5 space-y-0.5">
            {Object.entries(enabledPourSizes).map(([key, cfg]) => {
              const base = parseFloat(editingDrinkPrice) || 0
              const pourPrice = cfg.customPrice != null ? cfg.customPrice : base * cfg.multiplier
              return (
                <p key={key} className="text-xs text-gray-500">
                  {cfg.label}: ${pourPrice.toFixed(2)}{cfg.customPrice != null ? ' (custom)' : ` (${base.toFixed(2)} x ${cfg.multiplier})`}
                  {isDualPricingEnabled && base > 0 && (
                    <span className="text-indigo-400 ml-2">Card: ${calculateCardPrice(pourPrice, cashDiscountPct).toFixed(2)}</span>
                  )}
                </p>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
