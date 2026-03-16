'use client'

import { useState } from 'react'
import type { ModifierGroup } from './item-editor-types'

interface TieredPricingConfig {
  enabled: boolean
  modes: {
    flat_tiers: boolean
    free_threshold: boolean
  }
  flat_tiers?: {
    tiers: Array<{ upTo: number; price: number }>
    overflowPrice: number
  }
  free_threshold?: {
    freeCount: number
  }
}

interface ModifierGroupSettingsPanelProps {
  group: ModifierGroup
  mode: 'compact' | 'full'
  onUpdate: (field: string, value: any) => void
  onOpenAdvanced?: () => void
}

const MODIFIER_TYPE_OPTIONS = ['universal', 'food', 'liquor', 'retail', 'entertainment', 'combo'] as const

export function ModifierGroupSettingsPanel({
  group,
  mode,
  onUpdate,
  onOpenAdvanced,
}: ModifierGroupSettingsPanelProps) {
  const [tieredExpanded, setTieredExpanded] = useState(false)
  const [exclusionExpanded, setExclusionExpanded] = useState(false)

  const tieredPricing: TieredPricingConfig = group.tieredPricingConfig || {
    enabled: false,
    modes: { flat_tiers: false, free_threshold: false },
  }

  const updateTieredPricing = (config: TieredPricingConfig) => {
    onUpdate('tieredPricingConfig', config)
  }

  // ── Compact Mode ──
  if (mode === 'compact') {
    return (
      <div className="flex items-center gap-3 px-2 py-1.5 text-sm">
        {/* Min / Max */}
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={group.minSelections}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              onUpdate('minSelections', Number.isFinite(val) ? val : 0)
            }}
            className="w-16 px-2 py-1 border rounded text-center text-sm"
            min="0"
            title="Min selections"
          />
          <span className="text-gray-400">/</span>
          <input
            type="number"
            value={group.maxSelections}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              onUpdate('maxSelections', Number.isFinite(val) ? Math.max(val, 1) : 1)
            }}
            className="w-16 px-2 py-1 border rounded text-center text-sm"
            min="1"
            title="Max selections"
          />
        </div>

        <div className="w-px h-5 bg-gray-300" />

        {/* Required */}
        <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={group.isRequired}
            onChange={(e) => onUpdate('isRequired', e.target.checked)}
            className="w-3.5 h-3.5 rounded"
          />
          <span className="text-xs text-gray-700">Required</span>
        </label>

        {/* Stacking */}
        <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={group.allowStacking ?? false}
            onChange={(e) => onUpdate('allowStacking', e.target.checked)}
            className="w-3.5 h-3.5 rounded"
          />
          <span className="text-xs text-gray-700">Stacking</span>
        </label>

        {/* Display Name */}
        <input
          type="text"
          value={group.displayName || ''}
          onChange={(e) => onUpdate('displayName', e.target.value || null)}
          placeholder="Display name override..."
          className="flex-1 min-w-[120px] px-2 py-1 border rounded text-sm"
        />

        {/* showOnline toggle */}
        <button
          onClick={() => onUpdate('showOnline', !(group.showOnline ?? true))}
          className={`p-1 rounded ${group.showOnline !== false ? 'text-blue-600' : 'text-gray-400'}`}
          title={group.showOnline !== false ? 'Visible online' : 'Hidden online'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {group.showOnline !== false ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
            )}
          </svg>
        </button>

        {/* Open Entry */}
        <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={group.allowOpenEntry ?? false}
            onChange={(e) => onUpdate('allowOpenEntry', e.target.checked)}
            className="w-3.5 h-3.5 rounded"
          />
          <span className="text-xs text-gray-700">Open Entry</span>
        </label>

        {/* autoAdvance */}
        <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={group.autoAdvance ?? false}
            onChange={(e) => onUpdate('autoAdvance', e.target.checked)}
            className="w-3.5 h-3.5 rounded"
          />
          <span className="text-xs text-gray-700">autoAdvance</span>
        </label>

        {/* Gear icon */}
        {onOpenAdvanced && (
          <button
            onClick={onOpenAdvanced}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
            title="Advanced settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  // ── Full Mode ──
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="p-4 space-y-6">
        {/* General Settings */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">General Settings</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <p className="text-sm text-gray-900 font-medium">{group.name}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Display Name</label>
              <input
                type="text"
                value={group.displayName || ''}
                onChange={(e) => onUpdate('displayName', e.target.value || null)}
                placeholder="Display name override..."
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Modifier Types</label>
              <div className="flex flex-wrap gap-2">
                {MODIFIER_TYPE_OPTIONS.map((type) => {
                  const selected = (group.modifierTypes || []).includes(type)
                  return (
                    <button
                      key={type}
                      onClick={() => {
                        const current = group.modifierTypes || []
                        const next = selected
                          ? current.filter((t) => t !== type)
                          : [...current, type]
                        onUpdate('modifierTypes', next)
                      }}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        selected
                          ? 'bg-blue-100 border-blue-300 text-blue-700 font-medium'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {type}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Requirements */}
        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold text-gray-900">Requirements</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 w-20">Min</span>
            <input
              type="number"
              value={group.minSelections}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                onUpdate('minSelections', Number.isFinite(val) ? val : 0)
              }}
              className="w-20 px-2 py-1.5 border rounded text-center text-sm"
              min="0"
            />
            <span className="text-sm text-gray-600 w-20 ml-4">Max</span>
            <input
              type="number"
              value={group.maxSelections}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                onUpdate('maxSelections', Number.isFinite(val) ? Math.max(val, 1) : 1)
              }}
              className="w-20 px-2 py-1.5 border rounded text-center text-sm"
              min="1"
            />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={group.isRequired}
              onChange={(e) => onUpdate('isRequired', e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm text-gray-900">Required</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={group.allowStacking ?? false}
              onChange={(e) => onUpdate('allowStacking', e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm text-gray-900">Allow Stacking</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={group.allowOpenEntry ?? false}
              onChange={(e) => onUpdate('allowOpenEntry', e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm text-gray-900">Allow Open Entry</span>
          </label>
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={group.autoAdvance ?? false}
                onChange={(e) => onUpdate('autoAdvance', e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-gray-900">Auto Advance</span>
            </label>
            <p className="text-xs text-gray-500 ml-7 mt-0.5">
              Auto-dismiss after selection for single-select required groups
            </p>
          </div>
        </div>

        {/* Display */}
        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold text-gray-900">Display</h3>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-900">Show Online</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={group.showOnline !== false}
                onChange={(e) => onUpdate('showOnline', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
            </label>
          </div>
        </div>

        {/* Tiered Pricing (collapsible) */}
        <div className="border-t pt-4">
          <button
            onClick={() => setTieredExpanded(!tieredExpanded)}
            className="flex items-center justify-between w-full text-sm font-semibold text-gray-900"
          >
            <span>Tiered Pricing</span>
            <svg
              className={`w-4 h-4 transition-transform ${tieredExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {tieredExpanded && (
            <div className="mt-3 space-y-3">
              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Enable</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tieredPricing.enabled}
                    onChange={(e) => updateTieredPricing({ ...tieredPricing, enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
                </label>
              </div>

              {tieredPricing.enabled && (
                <div className="space-y-4 pl-3 border-l-2 border-gray-200">
                  {/* Mode selectors */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tieredPricing.modes.flat_tiers}
                        onChange={(e) =>
                          updateTieredPricing({
                            ...tieredPricing,
                            modes: { ...tieredPricing.modes, flat_tiers: e.target.checked },
                          })
                        }
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="text-gray-900">Flat Tiers</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tieredPricing.modes.free_threshold}
                        onChange={(e) =>
                          updateTieredPricing({
                            ...tieredPricing,
                            modes: { ...tieredPricing.modes, free_threshold: e.target.checked },
                          })
                        }
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="text-gray-900">Free Threshold</span>
                    </label>
                  </div>

                  {/* Flat Tiers config */}
                  {tieredPricing.modes.flat_tiers && (
                    <div className="space-y-2 p-3 bg-gray-50 rounded border border-gray-200">
                      <p className="text-xs font-semibold text-gray-600 mb-2">Flat Tier Rules</p>
                      {(tieredPricing.flat_tiers?.tiers || []).map((tier, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-xs text-gray-600">First</span>
                          <input
                            type="number"
                            min="1"
                            value={tier.upTo}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10)
                              const tiers = [...(tieredPricing.flat_tiers?.tiers || [])]
                              tiers[index] = { ...tiers[index], upTo: Number.isFinite(val) ? Math.max(val, 1) : 1 }
                              updateTieredPricing({
                                ...tieredPricing,
                                flat_tiers: { ...(tieredPricing.flat_tiers || { tiers: [], overflowPrice: 0 }), tiers },
                              })
                            }}
                            className="w-16 px-2 py-1 text-xs border border-gray-300 rounded"
                          />
                          <span className="text-xs text-gray-600">sel. →</span>
                          <span className="text-xs text-gray-600">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={tier.price}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value)
                              const tiers = [...(tieredPricing.flat_tiers?.tiers || [])]
                              tiers[index] = { ...tiers[index], price: Number.isFinite(val) ? val : 0 }
                              updateTieredPricing({
                                ...tieredPricing,
                                flat_tiers: { ...(tieredPricing.flat_tiers || { tiers: [], overflowPrice: 0 }), tiers },
                              })
                            }}
                            className="w-20 px-2 py-1 text-xs border border-gray-300 rounded"
                          />
                          <span className="text-xs text-gray-600">each</span>
                          <button
                            onClick={() => {
                              const tiers = (tieredPricing.flat_tiers?.tiers || []).filter((_, i) => i !== index)
                              updateTieredPricing({
                                ...tieredPricing,
                                flat_tiers: { ...(tieredPricing.flat_tiers || { tiers: [], overflowPrice: 0 }), tiers },
                              })
                            }}
                            className="ml-auto text-red-600 hover:text-red-700 text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const tiers = [...(tieredPricing.flat_tiers?.tiers || []), { upTo: 1, price: 0 }]
                          updateTieredPricing({
                            ...tieredPricing,
                            flat_tiers: { ...(tieredPricing.flat_tiers || { tiers: [], overflowPrice: 0 }), tiers },
                          })
                        }}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        + Add Tier
                      </button>
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-300">
                        <span className="text-xs text-gray-600">Overflow price:</span>
                        <span className="text-xs text-gray-600">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={tieredPricing.flat_tiers?.overflowPrice || 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value)
                            updateTieredPricing({
                              ...tieredPricing,
                              flat_tiers: {
                                ...(tieredPricing.flat_tiers || { tiers: [], overflowPrice: 0 }),
                                overflowPrice: Number.isFinite(val) ? val : 0,
                              },
                            })
                          }}
                          className="w-20 px-2 py-1 text-xs border border-gray-300 rounded"
                        />
                      </div>
                    </div>
                  )}

                  {/* Free Threshold config */}
                  {tieredPricing.modes.free_threshold && (
                    <div className="space-y-2 p-3 bg-gray-50 rounded border border-gray-200">
                      <p className="text-xs font-semibold text-gray-600 mb-2">Free Threshold Rule</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600">First</span>
                        <input
                          type="number"
                          min="0"
                          value={tieredPricing.free_threshold?.freeCount || 0}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            updateTieredPricing({
                              ...tieredPricing,
                              free_threshold: { freeCount: Number.isFinite(val) ? Math.max(val, 0) : 0 },
                            })
                          }}
                          className="w-16 px-2 py-1 text-xs border border-gray-300 rounded"
                        />
                        <span className="text-xs text-gray-600">selections are FREE, rest use modifier prices</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Exclusion Groups (collapsible) */}
        <div className="border-t pt-4">
          <button
            onClick={() => setExclusionExpanded(!exclusionExpanded)}
            className="flex items-center justify-between w-full text-sm font-semibold text-gray-900"
          >
            <span>Exclusion Groups</span>
            <svg
              className={`w-4 h-4 transition-transform ${exclusionExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {exclusionExpanded && (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={group.exclusionGroupKey || ''}
                onChange={(e) => onUpdate('exclusionGroupKey', e.target.value || null)}
                placeholder="e.g., sauces, toppings, sides"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500">
                Groups sharing the same key prevent duplicate modifier selections across them.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
