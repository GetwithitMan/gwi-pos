'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from '@/stores/toast-store'

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

  // Debounce ref for saveChanges
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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
        toast.error('Failed to load group settings')
      } finally {
        setLoading(false)
      }
    }

    loadGroupData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, selectedGroupId])
  // Note: refreshKey intentionally excluded — external refreshes (from ItemEditor saves)
  // should NOT wipe this panel's state mid-edit. Panel reloads on group selection change only.

  const saveChanges = useCallback(async () => {
    if (!item?.id || !selectedGroupId) return
    // Don't save if user is still creating a new key
    if (exclusionKey === '__new__') return

    try {
      const response = await fetch(`/api/menu/items/${item.id}/modifier-groups/${selectedGroupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tieredPricingConfig: tieredPricing,
          exclusionGroupKey: exclusionKey || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        toast.error(errorData.error || 'Failed to save settings')
      }
      // No onGroupUpdated() — tiered pricing/exclusion saves are local to this panel,
      // calling onGroupUpdated triggers refreshKey++ which re-fetches and resets all state mid-edit
    } catch (error) {
      console.error('Failed to save group settings:', error)
      toast.error('Failed to save group settings')
    }
  }, [item?.id, selectedGroupId, exclusionKey, tieredPricing])

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveChanges()
    }, 300)  // 300ms debounce
  }, [saveChanges])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

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

  const handleSettingChange = async (updates: Record<string, any>) => {
    if (!item?.id || !selectedGroupId) return
    // Optimistic: update local group state immediately
    setGroup(prev => prev ? { ...prev, ...updates } : prev)
    try {
      const response = await fetch(`/api/menu/items/${item.id}/modifier-groups/${selectedGroupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!response.ok) {
        toast.error('Failed to update group settings')
      }
      // No full reload or onGroupUpdated — optimistic state is sufficient
    } catch (e) {
      console.error('Failed to update group settings:', e)
      toast.error('Failed to update group settings')
    }
  }

  const handleDeleteGroup = async () => {
    if (!item?.id || !selectedGroupId || !confirm('Delete this modifier group?')) return
    try {
      const response = await fetch(`/api/menu/items/${item.id}/modifier-groups/${selectedGroupId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        onGroupUpdated()
      }
    } catch (e) {
      console.error('Failed to delete group:', e)
      toast.error('Failed to delete modifier group')
    }
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

        {/* Group Settings */}
        <div className="border-b pb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Group Settings</h3>
          <div className="space-y-3">
            {/* Min/Max Selections */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 w-24">Selections:</span>
              <input
                type="number"
                value={group.minSelections}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  handleSettingChange({ minSelections: Number.isFinite(val) ? val : 0 })
                }}
                className="w-16 px-2 py-1.5 border rounded text-center text-sm disabled:opacity-50"
                min="0"
                disabled={exclusionKey === '__new__'}
              />
              <span className="text-gray-400">to</span>
              <input
                type="number"
                value={group.maxSelections}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  handleSettingChange({ maxSelections: Number.isFinite(val) ? Math.max(val, 1) : 1 })
                }}
                className="w-16 px-2 py-1.5 border rounded text-center text-sm disabled:opacity-50"
                min="1"
                disabled={exclusionKey === '__new__'}
              />
            </div>
            {/* Required Toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={group.isRequired}
                onChange={(e) => handleSettingChange({ isRequired: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-gray-700">Required</span>
              <span className="text-xs text-gray-400">Customer must make a selection</span>
            </label>
            {/* Stacking Toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={group.allowStacking ?? false}
                onChange={(e) => handleSettingChange({ allowStacking: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-gray-700">Allow Stacking</span>
              <span className="text-xs text-gray-400">Same item can be selected multiple times</span>
            </label>
            {/* Delete Group */}
            <button
              onClick={() => handleDeleteGroup()}
              className="text-red-500 hover:text-red-700 text-sm px-3 py-1.5 border border-red-200 rounded hover:bg-red-50 w-full"
            >
              Delete Group
            </button>
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
                    debouncedSave()
                  } else {
                    debouncedSave()
                  }
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {exclusionKey === '__new__' && (
            <p className="text-xs text-amber-600 mt-1">⚠ Finish entering exclusion key before changing other settings</p>
          )}

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
                      debouncedSave()
                    }}
                    disabled={exclusionKey === '__new__'}
                    className="w-4 h-4 text-blue-600 rounded disabled:opacity-50"
                  />
                  <span className="text-gray-700">Flat Tiers — Fixed price per tier</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tieredPricing.modes.free_threshold}
                    onChange={(e) => {
                      handleModeToggle('free_threshold', e.target.checked)
                      debouncedSave()
                    }}
                    disabled={exclusionKey === '__new__'}
                    className="w-4 h-4 text-blue-600 rounded disabled:opacity-50"
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
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10)
                          handleTierChange(index, 'upTo', Number.isFinite(val) ? Math.max(val, 1) : 1)
                        }}
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
                        onChange={(e) => {
                          const val = parseFloat(e.target.value)
                          handleTierChange(index, 'price', Number.isFinite(val) ? val : 0)
                        }}
                        onBlur={saveChanges}
                        className="w-20 px-2 py-1 text-xs border border-gray-300 rounded"
                      />
                      <span className="text-xs text-gray-600">each</span>
                      <button
                        onClick={() => {
                          handleRemoveTier(index)
                          debouncedSave()
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
                      debouncedSave()
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
                        handleOverflowPriceChange(Number.isFinite(val) ? val : 0)
                      }}
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
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10)
                        handleFreeCountChange(Number.isFinite(val) ? Math.max(val, 0) : 0)
                      }}
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
            <span className="text-sm font-semibold text-gray-700">Exclusion Group</span>
            <p className="mt-0.5 text-xs text-gray-500">
              Prevent duplicate selections across groups. Modifiers selected in one group will be greyed out in related groups.
            </p>
            <select
              value={exclusionKey}
              onChange={(e) => {
                setExclusionKey(e.target.value)
                // Auto-save on change
                debouncedSave()
              }}
              className="mt-2 block w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">No exclusion group</option>
              {/* Show existing exclusion keys from other groups */}
              {(() => {
                const existingKeys = new Set<string>()
                allGroups.forEach(g => {
                  if (g.exclusionGroupKey && g.id !== selectedGroupId) {
                    existingKeys.add(g.exclusionGroupKey)
                  }
                })
                // Also include current key if it's custom
                if (exclusionKey && !existingKeys.has(exclusionKey)) {
                  existingKeys.add(exclusionKey)
                }
                return Array.from(existingKeys).sort().map(key => (
                  <option key={key} value={key}>{key}</option>
                ))
              })()}
              <option value="__new__">+ Create new exclusion group...</option>
            </select>
          </label>

          {/* New exclusion key input (shown when "Create new" selected) */}
          {exclusionKey === '__new__' && (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g., sauces, toppings, sides"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    setExclusionKey((e.target as HTMLInputElement).value.trim())
                    debouncedSave()
                  }
                }}
                onBlur={(e) => {
                  const val = e.target.value.trim()
                  if (val) {
                    setExclusionKey(val)
                    debouncedSave()
                  } else {
                    setExclusionKey('')
                    debouncedSave()
                  }
                }}
              />
            </div>
          )}

          {/* Show related groups */}
          {relatedGroups.length > 0 && (
            <div className="p-3 bg-blue-50 rounded border border-blue-200">
              <p className="text-xs font-semibold text-blue-700 mb-2">
                Related Groups (sharing key &ldquo;{exclusionKey}&rdquo;):
              </p>
              <ul className="space-y-1">
                {relatedGroups.map(g => (
                  <li key={g.id} className="text-xs text-blue-600">
                    &bull; {g.displayName || g.name}
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
