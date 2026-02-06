'use client'

import { useState, useEffect } from 'react'

interface TieredPricingConfig {
  enabled: boolean
  modes: {
    flat_tiers: boolean
    free_threshold: boolean
  }
  flat_tiers?: {
    tiers: Array<{
      upTo: number
      price: number
    }>
    overflowPrice: number
  }
  free_threshold?: {
    freeCount: number
  }
}

interface ModifierGroup {
  id: string
  name: string
  displayName?: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking?: boolean
  tieredPricingConfig?: TieredPricingConfig | null
  exclusionGroupKey?: string | null
  modifiers: Array<{
    id: string
    name: string
  }>
}

interface ModifierFlowEditorProps {
  item: { id: string; name: string } | null
  selectedGroupId: string | null
  refreshKey?: number
  onGroupUpdated: () => void
}

export function ModifierFlowEditor({
  item,
  selectedGroupId,
  refreshKey,
  onGroupUpdated,
}: ModifierFlowEditorProps) {
  const [group, setGroup] = useState<ModifierGroup | null>(null)
  const [allGroups, setAllGroups] = useState<ModifierGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [tieredPricing, setTieredPricing] = useState<TieredPricingConfig>({
    enabled: false,
    modes: {
      flat_tiers: false,
      free_threshold: false,
    },
  })
  const [exclusionKey, setExclusionKey] = useState('')

  // Load group data when selectedGroupId changes
  useEffect(() => {
    if (!item?.id || !selectedGroupId) {
      setGroup(null)
      return
    }

    const loadGroupData = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/menu/items/${item.id}/modifier-groups`)
        if (response.ok) {
          const data = await response.json()
          const groups = data.data || data.modifierGroups || []
          setAllGroups(groups)

          const foundGroup = groups.find((g: ModifierGroup) => g.id === selectedGroupId)
          if (foundGroup) {
            setGroup(foundGroup)
            setTieredPricing(foundGroup.tieredPricingConfig || {
              enabled: false,
              modes: {
                flat_tiers: false,
                free_threshold: false,
              },
            })
            setExclusionKey(foundGroup.exclusionGroupKey || '')
          }
        }
      } catch (error) {
        console.error('Failed to load group data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadGroupData()
  }, [item?.id, selectedGroupId, refreshKey])

  const saveChanges = async () => {
    if (!item?.id || !selectedGroupId) return

    try {
      const response = await fetch(`/api/menu/items/${item.id}/modifier-groups/${selectedGroupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tieredPricingConfig: tieredPricing,
          exclusionGroupKey: exclusionKey || null,
        }),
      })

      if (response.ok) {
        onGroupUpdated()
      }
    } catch (error) {
      console.error('Failed to save group settings:', error)
    }
  }

  const handleTieredPricingToggle = (enabled: boolean) => {
    const newConfig = { ...tieredPricing, enabled }
    setTieredPricing(newConfig)
  }

  const handleModeToggle = (mode: 'flat_tiers' | 'free_threshold', checked: boolean) => {
    const newConfig = {
      ...tieredPricing,
      modes: {
        ...tieredPricing.modes,
        [mode]: checked,
      },
    }
    setTieredPricing(newConfig)
  }

  const handleAddTier = () => {
    const newConfig = {
      ...tieredPricing,
      flat_tiers: {
        ...(tieredPricing.flat_tiers || { tiers: [], overflowPrice: 0 }),
        tiers: [
          ...(tieredPricing.flat_tiers?.tiers || []),
          { upTo: 1, price: 0 },
        ],
      },
    }
    setTieredPricing(newConfig)
  }

  const handleRemoveTier = (index: number) => {
    if (!tieredPricing.flat_tiers) return
    const newTiers = tieredPricing.flat_tiers.tiers.filter((_, i) => i !== index)
    const newConfig = {
      ...tieredPricing,
      flat_tiers: {
        ...tieredPricing.flat_tiers,
        tiers: newTiers,
      },
    }
    setTieredPricing(newConfig)
  }

  const handleTierChange = (index: number, field: 'upTo' | 'price', value: number) => {
    if (!tieredPricing.flat_tiers) return
    const newTiers = [...tieredPricing.flat_tiers.tiers]
    newTiers[index] = { ...newTiers[index], [field]: value }
    const newConfig = {
      ...tieredPricing,
      flat_tiers: {
        ...tieredPricing.flat_tiers,
        tiers: newTiers,
      },
    }
    setTieredPricing(newConfig)
  }

  const handleOverflowPriceChange = (value: number) => {
    const newConfig = {
      ...tieredPricing,
      flat_tiers: {
        ...(tieredPricing.flat_tiers || { tiers: [], overflowPrice: 0 }),
        overflowPrice: value,
      },
    }
    setTieredPricing(newConfig)
  }

  const handleFreeCountChange = (value: number) => {
    const newConfig = {
      ...tieredPricing,
      free_threshold: {
        freeCount: value,
      },
    }
    setTieredPricing(newConfig)
  }

  // Get other groups with the same exclusion key
  const relatedGroups = allGroups.filter(
    g => g.id !== selectedGroupId && g.exclusionGroupKey === exclusionKey && exclusionKey !== ''
  )

  if (!selectedGroupId) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 bg-white p-6">
        <div className="text-center">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <p className="text-sm font-medium">Select a modifier group</p>
          <p className="text-xs mt-1">to configure pricing rules</p>
        </div>
      </div>
    )
  }

  if (loading || !group) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 bg-white p-6">
        <p className="text-sm">Loading group settings...</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="p-4 space-y-6">
        {/* Section 1: Group Summary (Read-only) */}
        <div className="border-b pb-4">
          <h3 className="text-lg font-bold text-gray-800">{group.displayName || group.name}</h3>
          <div className="flex gap-2 mt-2 flex-wrap">
            {group.isRequired && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                Required
              </span>
            )}
            {group.allowStacking && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">
                Stacking
              </span>
            )}
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
              {group.minSelections}-{group.maxSelections} selections
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
              {group.modifiers.length} modifiers
            </span>
          </div>
        </div>

        {/* Section 2: Tiered Pricing */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-gray-700">Tiered Pricing</label>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={tieredPricing.enabled}
                onChange={(e) => {
                  handleTieredPricingToggle(e.target.checked)
                  if (e.target.checked) {
                    // Auto-save on toggle
                    setTimeout(saveChanges, 100)
                  } else {
                    saveChanges()
                  }
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {tieredPricing.enabled && (
            <div className="space-y-4 pl-4 border-l-2 border-gray-200">
              {/* Mode Checkboxes */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tieredPricing.modes.flat_tiers}
                    onChange={(e) => {
                      handleModeToggle('flat_tiers', e.target.checked)
                      setTimeout(saveChanges, 100)
                    }}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-gray-700">Flat Tiers — Fixed price per tier</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tieredPricing.modes.free_threshold}
                    onChange={(e) => {
                      handleModeToggle('free_threshold', e.target.checked)
                      setTimeout(saveChanges, 100)
                    }}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-gray-700">Free Threshold — First N selections free</span>
                </label>
              </div>

              {/* Flat Tiers Configuration */}
              {tieredPricing.modes.flat_tiers && (
                <div className="space-y-2 p-3 bg-gray-50 rounded border border-gray-200">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Flat Tier Rules</p>
                  {tieredPricing.flat_tiers?.tiers.map((tier, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 whitespace-nowrap">First</span>
                      <input
                        type="number"
                        min="1"
                        value={tier.upTo}
                        onChange={(e) => handleTierChange(index, 'upTo', parseInt(e.target.value) || 1)}
                        onBlur={saveChanges}
                        className="w-16 px-2 py-1 text-xs border border-gray-300 rounded"
                      />
                      <span className="text-xs text-gray-600 whitespace-nowrap">selections →</span>
                      <span className="text-xs text-gray-600">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={tier.price}
                        onChange={(e) => handleTierChange(index, 'price', parseFloat(e.target.value) || 0)}
                        onBlur={saveChanges}
                        className="w-20 px-2 py-1 text-xs border border-gray-300 rounded"
                      />
                      <span className="text-xs text-gray-600">each</span>
                      <button
                        onClick={() => {
                          handleRemoveTier(index)
                          setTimeout(saveChanges, 100)
                        }}
                        className="ml-auto text-red-600 hover:text-red-700 text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      handleAddTier()
                      setTimeout(saveChanges, 100)
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
                      onChange={(e) => handleOverflowPriceChange(parseFloat(e.target.value) || 0)}
                      onBlur={saveChanges}
                      className="w-20 px-2 py-1 text-xs border border-gray-300 rounded"
                    />
                  </div>
                </div>
              )}

              {/* Free Threshold Configuration */}
              {tieredPricing.modes.free_threshold && (
                <div className="space-y-2 p-3 bg-gray-50 rounded border border-gray-200">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Free Threshold Rule</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">First</span>
                    <input
                      type="number"
                      min="0"
                      value={tieredPricing.free_threshold?.freeCount || 0}
                      onChange={(e) => handleFreeCountChange(parseInt(e.target.value) || 0)}
                      onBlur={saveChanges}
                      className="w-16 px-2 py-1 text-xs border border-gray-300 rounded"
                    />
                    <span className="text-xs text-gray-600">selections are FREE, rest use modifier prices</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section 3: Exclusion Rules */}
        <div className="space-y-3 border-t pt-4">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Exclusion Group Key</span>
            <input
              type="text"
              value={exclusionKey}
              onChange={(e) => setExclusionKey(e.target.value)}
              onBlur={saveChanges}
              placeholder="e.g., sauces, toppings"
              className="mt-1 block w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Groups with the same key prevent duplicate modifier selections
            </p>
          </label>

          {relatedGroups.length > 0 && (
            <div className="p-3 bg-blue-50 rounded border border-blue-200">
              <p className="text-xs font-semibold text-blue-700 mb-2">
                Related Groups (sharing key "{exclusionKey}"):
              </p>
              <ul className="space-y-1">
                {relatedGroups.map(g => (
                  <li key={g.id} className="text-xs text-blue-600">
                    • {g.displayName || g.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
