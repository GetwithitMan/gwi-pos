'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { IngredientHierarchyPicker } from './IngredientHierarchyPicker'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { calculateCardPrice } from '@/lib/pricing'
import { isItemTaxInclusive } from '@/lib/order-calculations'
import { ItemSettingsModal } from './ItemSettingsModal'
import { useIngredientOperations } from './useIngredientOperations'
import { useModifierGroupManager } from './useModifierGroupManager'
import { useModifierEditor } from './useModifierEditor'
import { useIngredientCreation } from './useIngredientCreation'
import type { Ingredient, IngredientLibraryItem, IngredientCategory, Modifier, ModifierGroup, MenuItem } from './item-editor-types'

// Re-export types for external consumers
export type { IngredientLibraryItem } from './item-editor-types'

interface ItemEditorProps {
  item: MenuItem | null
  ingredientsLibrary: IngredientLibraryItem[]
  ingredientCategories?: IngredientCategory[]
  locationId?: string
  onItemUpdated: () => void
  onIngredientCreated?: (ingredient: IngredientLibraryItem) => void
  onCategoryCreated?: (category: IngredientCategory) => void
  onToggle86?: (item: MenuItem) => void
  onDelete?: (itemId: string) => void
  refreshKey?: number
  onSelectGroup?: (groupId: string | null) => void
}

export function ItemEditor({ item, ingredientsLibrary, ingredientCategories = [], locationId = '', onItemUpdated, onIngredientCreated, onCategoryCreated, onToggle86, onDelete, refreshKey, onSelectGroup }: ItemEditorProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Pricing settings — item is the source of truth for all pricing
  const { dualPricing, taxRate, taxInclusiveLiquor, taxInclusiveFood } = useOrderSettings()
  const isDualPricingEnabled = dualPricing.enabled
  const cashDiscountPct = dualPricing.cashDiscountPercent || 4.0

  const itemCardPrice = useMemo(() => {
    if (!item || !isDualPricingEnabled) return item?.price ?? 0
    return calculateCardPrice(item.price, cashDiscountPct)
  }, [item?.price, isDualPricingEnabled, cashDiscountPct])

  const isTaxInclusive = useMemo(() => {
    if (!item) return false
    return isItemTaxInclusive(item.categoryType, { taxInclusiveLiquor, taxInclusiveFood })
  }, [item?.categoryType, taxInclusiveLiquor, taxInclusiveFood])

  // Collapse states
  const [ingredientsExpanded, setIngredientsExpanded] = useState(false)

  // Item settings modal state
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  // Printer routing state
  const [printers, setPrinters] = useState<Array<{ id: string; name: string }>>([])
  const [printerRoutingModifier, setPrinterRoutingModifier] = useState<{ groupId: string; modId: string } | null>(null)

  // --- Stable loadData via ref pattern (hooks need loadData, loadData needs hook setters) ---
  const loadDataRef = useRef<(showSpinner?: boolean) => Promise<void>>(async () => {})
  const loadData = useCallback(async (showSpinner?: boolean) => {
    await loadDataRef.current(showSpinner)
  }, [])

  // --- Hook 1: Ingredient Operations ---
  const ingredientOps = useIngredientOperations({
    itemId: item?.id,
    ingredientsLibrary,
    loadData,
    setSaving,
  })

  // --- Hook 2: Modifier Group Manager ---
  const modGroupManager = useModifierGroupManager({
    itemId: item?.id,
    loadData,
    setSaving,
  })

  // --- Refs for cross-hook dependencies ---
  const resetCreationExpansionRef = useRef<() => void>(() => {})
  const linkIngredientRef = useRef<((groupId: string, modId: string, ingredientId: string | null) => Promise<void>) | undefined>(undefined)
  const linkingModifierRef = useRef<{ groupId: string; modId: string } | null>(null)

  // --- Hook 4: Ingredient Creation (created before modEditor to resolve circular dep) ---
  const ingredientCreation = useIngredientCreation({
    locationId,
    onIngredientCreated,
    onCategoryCreated,
    onItemUpdated,
    linkIngredientRef,
    linkingModifierRef,
    showIngredientPicker: ingredientOps.showIngredientPicker,
    ingredients: ingredientOps.ingredients,
    saveIngredients: ingredientOps.saveIngredients,
    setShowIngredientPicker: ingredientOps.setShowIngredientPicker,
    setIngredientSearch: ingredientOps.setIngredientSearch,
  })

  // --- Hook 3: Modifier Editor ---
  const modEditor = useModifierEditor({
    itemId: item?.id,
    ingredientsLibrary,
    loadData,
    setSaving,
    modifierGroups: modGroupManager.modifierGroups,
    setModifierGroups: modGroupManager.setModifierGroups,
    findGroupById: modGroupManager.findGroupById,
    findModifierById: modGroupManager.findModifierById,
    resetCreationExpansionRef,
  })

  // --- Wire up cross-hook refs (safe: called during render, functions only invoked from event handlers) ---
  resetCreationExpansionRef.current = () => {
    ingredientCreation.setExpandedCategories(new Set())
    ingredientCreation.setExpandedParents(new Set())
  }
  linkIngredientRef.current = modEditor.linkIngredient
  linkingModifierRef.current = modEditor.linkingModifier

  // --- Wire up loadData implementation (needs hook setters) ---
  loadDataRef.current = async (showSpinner = false) => {
    if (!item?.id) return
    if (showSpinner) setLoading(true)
    try {
      const [ingRes, groupsRes] = await Promise.all([
        fetch(`/api/menu/items/${item.id}/ingredients`),
        fetch(`/api/menu/items/${item.id}/modifier-groups`),
      ])
      const [ingData, groupsData] = await Promise.all([ingRes.json(), groupsRes.json()])
      ingredientOps.setIngredients(ingData.data || [])
      modGroupManager.setModifierGroups(groupsData.data || [])
    } catch (e) {
      console.error('Failed to load data:', e)
      toast.error('Failed to load modifier data')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  // Compute ingredient-to-modifier mapping for bidirectional link indicators
  const ingredientToModifiers = useMemo(() => {
    const map = new Map<string, { modName: string; groupName: string }[]>()

    // Recursive function to process modifiers, including child groups
    const processModifiers = (mods: Modifier[], groupName: string) => {
      mods.forEach(mod => {
        if (mod.ingredientId) {
          const existing = map.get(mod.ingredientId) || []
          existing.push({ modName: mod.name, groupName })
          map.set(mod.ingredientId, existing)
        }
        // Recurse into child modifier groups
        if (mod.childModifierGroup) {
          processModifiers(
            mod.childModifierGroup.modifiers,
            mod.childModifierGroup.name
          )
        }
      })
    }

    modGroupManager.modifierGroups.forEach(group => {
      processModifiers(group.modifiers, group.name)
    })
    return map
  }, [modGroupManager.modifierGroups])

  // Load data when item changes or refreshKey updates
  useEffect(() => {
    if (!item?.id) {
      ingredientOps.setIngredients([])
      modGroupManager.setModifierGroups([])
      return
    }
    loadData(true) // Show spinner only on initial/item-change load
  }, [item?.id, refreshKey])

  // Auto-open settings for new items
  useEffect(() => {
    if (item && item.name === 'New Item' && item.price === 0) {
      setShowSettingsModal(true)
    }
  }, [item?.id])

  // Load printers for print routing
  useEffect(() => {
    const fetchPrinters = async () => {
      try {
        const res = await fetch('/api/hardware/printers')
        if (res.ok) {
          const raw = await res.json()
          const data = raw.data ?? raw
          setPrinters((data.printers || []).map((p: any) => ({ id: p.id, name: p.name })))
        }
      } catch (e) {
        console.error('Failed to load printers:', e)
      }
    }
    fetchPrinters()
  }, [])

  // Close printer routing dropdown when clicking outside
  useEffect(() => {
    if (!printerRoutingModifier) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Don't close if clicking inside the dropdown or on the button
      if (target.closest('.printer-routing-dropdown') || target.closest('.printer-routing-button')) {
        return
      }
      setPrinterRoutingModifier(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [printerRoutingModifier])

  // --- Destructure hook returns for cleaner render code ---
  const {
    ingredients, showIngredientPicker, setShowIngredientPicker,
    relinkingIngredientId, setRelinkingIngredientId,
    ingredientSearch, setIngredientSearch,
    addIngredient, removeIngredient, swapIngredientLink,
    toggleIngredientOption, updateExtraPrice,
  } = ingredientOps

  const {
    modifierGroups, expandedGroups, toggleExpanded,
    showNewGroupForm, setShowNewGroupForm,
    newGroupName, setNewGroupName,
    draggedGroupId, setDraggedGroupId,
    dragOverGroupId, setDragOverGroupId,
    dragOverDropZone, setDragOverDropZone,
    renamingGroupId, setRenamingGroupId: _setRenamingGroupId,
    renameValue, setRenameValue,
    createGroup, updateGroup, deleteGroup, duplicateGroup,
    reorderGroups, reorderModifiers,
    findGroupById, findModifierById, isDescendantOf,
    reparentGroup, handleGroupDrop, handleGroupDropOnModifier,
    nestGroupInGroup, startRename, commitRename,
  } = modGroupManager

  const {
    addingModifierTo, setAddingModifierTo,
    newModName, setNewModName,
    newModPrice, setNewModPrice,
    addingType, setAddingType,
    editingModifierId, setEditingModifierId,
    editModValues, setEditModValues,
    linkingModifier, setLinkingModifier,
    modIngredientSearch, setModIngredientSearch,
    draggedModifierId, setDraggedModifierId,
    dragOverModifierId, setDragOverModifierId,
    addModifier, updateModifier, toggleDefault, deleteModifier,
    startEditModifier, commitEditModifier,
    createChildGroup, addChoice, linkIngredient,
  } = modEditor

  const {
    expandedCategories, expandedParents,
    creatingInventoryInCategory, setCreatingInventoryInCategory,
    creatingPrepUnderParent, setCreatingPrepUnderParent,
    newInventoryName, setNewInventoryName,
    newPrepName, setNewPrepName,
    creatingIngredientLoading,
    creatingNewCategory, setCreatingNewCategory,
    newCategoryName, setNewCategoryName,
    createCategory, createInventoryItem, createPrepItem,
  } = ingredientCreation

  // Helper to render a choice row (navigation modifier with child group)
  const renderChoiceRow = (groupId: string, mod: Modifier, depth: number = 0, siblingIndex: number = 0) => {
    const childGroup = mod.childModifierGroup
    const itemCount = childGroup?.modifiers?.length || 0

    return (
      <div
        key={mod.id}
        className={`space-y-1 ${draggedModifierId === mod.id ? 'opacity-50' : ''} ${dragOverModifierId === mod.id && draggedModifierId !== mod.id ? 'ring-2 ring-indigo-300 rounded' : ''}`}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          setDraggedModifierId(mod.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', mod.id)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (draggedGroupId) {
            // Group being dragged — choice already has a child, can't nest another
            return
          }
          setDragOverModifierId(mod.id)
        }}
        onDragLeave={() => setDragOverModifierId(null)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (draggedModifierId) reorderModifiers(groupId, draggedModifierId, mod.id)
          setDraggedModifierId(null)
          setDragOverModifierId(null)
        }}
        onDragEnd={() => {
          setDraggedModifierId(null)
          setDragOverModifierId(null)
        }}
      >
        <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded text-sm">
          <span className="cursor-grab text-gray-300 hover:text-gray-500 text-xs" title="Drag to reorder">⠿</span>
          <span className="text-amber-500 text-xs">📁</span>
          {editingModifierId === mod.id ? (
            <input
              type="text"
              value={editModValues.name}
              onChange={(e) => setEditModValues(prev => ({ ...prev, name: e.target.value }))}
              onBlur={() => commitEditModifier(groupId, mod.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEditModifier(groupId, mod.id)
                if (e.key === 'Escape') setEditingModifierId(null)
              }}
              className="flex-1 px-1 py-0.5 text-sm font-medium border rounded bg-white"
              autoFocus
            />
          ) : (
            <span
              className="flex-1 font-medium text-amber-800 truncate cursor-pointer hover:text-amber-600"
              onDoubleClick={() => startEditModifier(mod)}
              title="Double-click to rename"
            >
              {mod.name}
            </span>
          )}
          <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded font-medium">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
          <button
            onClick={() => deleteModifier(groupId, mod.id)}
            className="text-red-400 hover:text-red-600 text-xs"
            title="Delete choice and its group"
          >
            ×
          </button>
        </div>
        {childGroup && renderChildGroup(childGroup, depth + 1, siblingIndex)}
      </div>
    )
  }

  // Helper to render a modifier row with all controls
  const renderModifierRow = (groupId: string, mod: Modifier, depth: number = 0, rowIndex: number = 0) => {
    // If this is a choice (label with child group), render it differently
    if (mod.isLabel && mod.childModifierGroupId) {
      return renderChoiceRow(groupId, mod, depth, rowIndex)
    }

    const isLinking = linkingModifier?.groupId === groupId && linkingModifier?.modId === mod.id
    const filteredIngredients = ingredientsLibrary.filter(ing =>
      ing.parentIngredientId &&  // ONLY prep items (children)
      ing.name.toLowerCase().includes(modIngredientSearch.toLowerCase())
    )

    // When a group is being dragged, this modifier becomes a potential nest target
    // Allow dropping groups on any modifier (swap if already has child)
    const isGroupDropTarget = !!draggedGroupId
    const isGroupDragOverThis = dragOverDropZone === mod.id && draggedGroupId

    return (
      <div
        key={mod.id}
        className={`space-y-1 ${draggedModifierId === mod.id ? 'opacity-50' : ''} ${dragOverModifierId === mod.id && draggedModifierId !== mod.id ? 'ring-2 ring-indigo-300 rounded' : ''} ${isGroupDragOverThis ? 'ring-2 ring-green-400 rounded bg-green-50' : ''}`}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          setDraggedModifierId(mod.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', mod.id)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (draggedGroupId) {
            // Group is being dragged — this modifier is a nest target
            if (isGroupDropTarget) setDragOverDropZone(mod.id)
          } else {
            setDragOverModifierId(mod.id)
          }
        }}
        onDragLeave={() => { setDragOverModifierId(null); setDragOverDropZone(null) }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (draggedGroupId && isGroupDropTarget) {
            // A group was dropped on this modifier → nest the group
            handleGroupDropOnModifier(e, mod.id, groupId)
          } else if (draggedModifierId) {
            reorderModifiers(groupId, draggedModifierId, mod.id)
          }
          setDraggedModifierId(null)
          setDragOverModifierId(null)
          setDragOverDropZone(null)
        }}
        onDragEnd={() => {
          setDraggedModifierId(null)
          setDragOverModifierId(null)
          setDragOverDropZone(null)
        }}
      >
        <div className={`flex items-center gap-1.5 px-2 py-1.5 border rounded text-sm ${isGroupDragOverThis ? 'bg-green-50 border-green-300' : rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
          <span className="cursor-grab text-gray-300 hover:text-gray-500 text-xs shrink-0" title="Drag to reorder">⠿</span>

          {/* LEFT SIDE: Name + Upcharge price only */}
          {editingModifierId === mod.id ? (
            <div className="flex items-center gap-1 flex-1 min-w-0" ref={(el) => {
              // Store ref so blur can check if focus moved within this container
              if (el) (el as any)._editContainer = true
            }}>
              <input
                type="text"
                value={editModValues.name}
                onChange={(e) => setEditModValues(prev => ({ ...prev, name: e.target.value }))}
                onBlur={(e) => {
                  // Don't close if clicking the sibling price input
                  const related = e.relatedTarget as HTMLElement | null
                  if (related && e.currentTarget.parentElement?.contains(related)) return
                  setTimeout(() => commitEditModifier(groupId, mod.id), 100)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEditModifier(groupId, mod.id)
                  if (e.key === 'Escape') setEditingModifierId(null)
                }}
                className="flex-1 px-1 py-0.5 text-sm border rounded bg-white min-w-0"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex items-center gap-0.5 shrink-0">
                <span className="text-[9px] text-gray-500">$</span>
                <input
                  type="number"
                  value={editModValues.price}
                  onChange={(e) => setEditModValues(prev => ({ ...prev, price: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const related = e.relatedTarget as HTMLElement | null
                    if (related && e.currentTarget.parentElement?.parentElement?.contains(related)) return
                    setTimeout(() => commitEditModifier(groupId, mod.id), 100)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEditModifier(groupId, mod.id)
                    if (e.key === 'Escape') setEditingModifierId(null)
                  }}
                  className="w-16 px-1 py-0.5 text-xs border rounded text-center"
                  step="0.01"
                  min="0"
                />
                {isDualPricingEnabled && editModValues.price && parseFloat(editModValues.price) > 0 && (
                  <span className="text-[9px] text-indigo-400 font-semibold whitespace-nowrap">
                    card {formatCurrency(calculateCardPrice(parseFloat(editModValues.price) || 0, cashDiscountPct))}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <span
              className="flex-1 truncate cursor-pointer hover:text-indigo-600 flex items-center gap-1.5 min-w-0 group/name"
              onClick={() => startEditModifier(mod)}
              title="Click to edit name & price"
            >
              <span className="truncate">{mod.name}</span>
              {mod.price > 0 && (
                <span className="text-xs font-semibold shrink-0 flex items-center gap-1">
                  <span className="text-green-600">+{formatCurrency(mod.price)}</span>
                  {isDualPricingEnabled && (
                    <span className="text-indigo-400">+{formatCurrency(calculateCardPrice(mod.price, cashDiscountPct))}</span>
                  )}
                </span>
              )}
              {mod.isDefault && (
                <span className="text-[8px] px-1 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold shrink-0">DEFAULT</span>
              )}
              <span className="text-gray-300 group-hover/name:text-indigo-400 text-[10px] shrink-0 transition-colors">✏️</span>
            </span>
          )}

          {/* RIGHT SIDE: All controls */}
          {/* Ingredient Link Badge */}
          {mod.ingredientId && mod.ingredientName && (
            <span className="text-[9px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded flex items-center gap-1 shrink-0">
              🔗 {mod.ingredientName}
              <button
                onClick={() => linkIngredient(groupId, mod.id, null)}
                className="hover:text-purple-900"
              >
                ×
              </button>
            </span>
          )}

          {/* Unlinked hint - only for non-label modifiers */}
          {!mod.ingredientId && !mod.isLabel && (
            <span className="text-[8px] text-gray-300 italic shrink-0">unlinked</span>
          )}

          {/* Link Ingredient Button */}
          <button
            onClick={() => {
              if (isLinking) {
                // Closing current modifier's dropdown — reset everything
                setLinkingModifier(null)
                setModIngredientSearch('')
                ingredientCreation.setExpandedCategories(new Set())
                ingredientCreation.setExpandedParents(new Set())
              } else {
                // Opening dropdown for a new modifier — reset and open
                ingredientCreation.setExpandedCategories(new Set())
                ingredientCreation.setExpandedParents(new Set())
                setModIngredientSearch('')
                setLinkingModifier({ groupId, modId: mod.id })
              }
            }}
            className={`w-5 h-5 rounded text-xs shrink-0 ${isLinking ? 'bg-purple-500 text-white' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'}`}
            title="Link Ingredient"
          >
            🔗
          </button>

          {/* Default Selection Toggle */}
          <button
            onClick={() => toggleDefault(groupId, mod.id, !!mod.isDefault)}
            className={`w-5 h-5 rounded text-[9px] font-bold shrink-0 ${mod.isDefault ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-amber-100 hover:text-amber-500'}`}
            title={mod.isDefault ? 'Default: ON' : 'Default: OFF'}
          >
            ★
          </button>

          {/* Pre-modifier toggles — each in own bordered box, faded color when off */}
          <div className="flex gap-1 shrink-0">
            <span className={`flex items-center h-6 rounded border px-0.5 ${mod.allowNo ? 'border-red-300 bg-red-50' : 'border-red-200 bg-red-50/40'}`}>
              <button
                onClick={() => updateModifier(groupId, mod.id, { allowNo: !mod.allowNo })}
                className={`h-5 rounded text-[9px] font-bold px-1.5 ${mod.allowNo ? 'bg-red-500 text-white' : 'bg-red-100 text-red-300'}`}
              >
                No
              </button>
            </span>
            <span className={`flex items-center gap-0.5 h-6 rounded border px-0.5 ${mod.allowLite ? 'border-yellow-300 bg-yellow-50' : 'border-yellow-200 bg-yellow-50/40'}`}>
              <button
                onClick={() => updateModifier(groupId, mod.id, { allowLite: !mod.allowLite })}
                className={`h-5 rounded text-[9px] font-bold px-1.5 ${mod.allowLite ? 'bg-yellow-500 text-white' : 'bg-yellow-100 text-yellow-300'}`}
              >
                Lite
              </button>
              {mod.allowLite && (
                <>
                  <span className={`text-[9px] font-bold text-yellow-600`}>×</span>
                  <input
                    type="number"
                    defaultValue={mod.liteMultiplier ?? 0.5}
                    key={`lite-${mod.id}-${mod.liteMultiplier ?? 0.5}`}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const parsed = parseFloat(e.target.value)
                      const val = Number.isFinite(parsed) ? parsed : 0.5
                      const current = mod.liteMultiplier ?? 0.5
                      if (val !== current) {
                        updateModifier(groupId, mod.id, { liteMultiplier: val })
                      }
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                    className="w-12 h-5 px-1 text-[10px] font-semibold rounded text-center bg-white border border-yellow-300 text-yellow-700 focus:border-yellow-500 focus:ring-1 focus:ring-yellow-300 focus:outline-none"
                    step="0.1"
                    min="0"
                    max="10"
                  />
                </>
              )}
            </span>
            <span className={`flex items-center h-6 rounded border px-0.5 ${mod.allowOnSide ? 'border-blue-300 bg-blue-50' : 'border-blue-200 bg-blue-50/40'}`}>
              <button
                onClick={() => updateModifier(groupId, mod.id, { allowOnSide: !mod.allowOnSide })}
                className={`h-5 rounded text-[9px] font-bold px-1.5 ${mod.allowOnSide ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-300'}`}
              >
                Side
              </button>
            </span>
            <span className={`flex items-center gap-0.5 h-6 rounded border px-0.5 ${mod.allowExtra ? 'border-green-300 bg-green-50' : 'border-green-200 bg-green-50/40'}`}>
              <button
                onClick={() => {
                  const turningOn = !mod.allowExtra
                  const updates: Partial<Modifier> = { allowExtra: turningOn }
                  if (turningOn && mod.price > 0 && !(mod.extraPrice && mod.extraPrice > 0)) {
                    updates.extraPrice = mod.price
                  }
                  updateModifier(groupId, mod.id, updates)
                }}
                className={`h-5 rounded text-[9px] font-bold px-1.5 ${mod.allowExtra ? 'bg-green-500 text-white' : 'bg-green-100 text-green-300'}`}
              >
                Extra
              </button>
              {mod.allowExtra && (
                <>
                  <span className="text-[9px] font-bold text-green-600">×</span>
                  <input
                    type="number"
                    defaultValue={mod.extraMultiplier ?? 2.0}
                    key={`extra-mult-${mod.id}-${mod.extraMultiplier ?? 2.0}`}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const parsed = parseFloat(e.target.value)
                      const val = Number.isFinite(parsed) ? parsed : 2.0
                      const current = mod.extraMultiplier ?? 2.0
                      if (val !== current) {
                        updateModifier(groupId, mod.id, { extraMultiplier: val })
                      }
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                    className="w-12 h-5 px-1 text-[10px] font-semibold rounded text-center bg-white border border-green-300 text-green-700 focus:border-green-500 focus:ring-1 focus:ring-green-300 focus:outline-none"
                    step="0.1"
                    min="0"
                    max="10"
                  />
                </>
              )}
              <span className={`text-[9px] font-bold ${mod.allowExtra ? 'text-green-600' : 'text-green-300'}`}>$</span>
              {mod.allowExtra ? (
                <input
                  type="number"
                  defaultValue={mod.extraPrice ?? 0}
                  key={`extra-${mod.id}-${mod.extraPrice ?? 0}`}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const parsed = parseFloat(e.target.value)
                    const val = Number.isFinite(parsed) ? parsed : 0
                    if (val !== (mod.extraPrice ?? 0)) {
                      updateModifier(groupId, mod.id, { extraPrice: val })
                    }
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  className="w-14 h-5 px-1 text-[10px] font-semibold rounded text-center bg-white border border-green-300 text-green-700 focus:border-green-500 focus:ring-1 focus:ring-green-300 focus:outline-none"
                  step="0.01"
                  min="0"
                />
              ) : (
                <span className="w-14 h-5 flex items-center justify-center text-[10px] text-green-300 font-semibold">
                  {(mod.extraPrice ?? 0).toFixed(2)}
                </span>
              )}
              {isDualPricingEnabled && (mod.extraPrice ?? 0) > 0 && (
                <span className="text-[8px] text-indigo-400 font-semibold ml-0.5">
                  {formatCurrency(calculateCardPrice(mod.extraPrice ?? 0, cashDiscountPct))}
                </span>
              )}
            </span>
          </div>

          {/* Printer Routing Button */}
          <div className="relative shrink-0">
            <button
              onClick={() => setPrinterRoutingModifier(
                printerRoutingModifier?.modId === mod.id ? null : { groupId, modId: mod.id }
              )}
              className={`printer-routing-button w-5 h-5 rounded text-xs shrink-0 ${
                mod.printerRouting === 'only' ? 'bg-orange-500 text-white' :
                mod.printerRouting === 'also' ? 'bg-blue-500 text-white' :
                'bg-gray-100 text-gray-400 hover:bg-gray-200'
              }`}
              title={
                mod.printerRouting === 'only' ? 'Prints ONLY to specific printers' :
                mod.printerRouting === 'also' ? 'ALSO prints to additional printers' :
                'Follows item\'s printer routing'
              }
            >
              🖨️
            </button>

            {/* Printer Routing Dropdown */}
            {printerRoutingModifier?.modId === mod.id && (
              <div className="printer-routing-dropdown absolute right-0 top-full mt-1 bg-white border rounded shadow-lg p-2 w-56 z-50">
                <div className="text-xs font-semibold mb-2">Print Routing</div>

                {/* Routing Mode Selection */}
                <div className="space-y-1 mb-2">
                  <button
                    onClick={() => updateModifier(groupId, mod.id, { printerRouting: 'follow', printerIds: [] })}
                    className={`w-full text-left px-2 py-1 text-xs rounded ${
                      (mod.printerRouting || 'follow') === 'follow' ? 'bg-gray-200 font-semibold' : 'hover:bg-gray-50'
                    }`}
                  >
                    Follow Item (Default)
                  </button>
                  <button
                    onClick={() => {
                      if (mod.printerRouting !== 'also') {
                        updateModifier(groupId, mod.id, { printerRouting: 'also', printerIds: [] })
                      }
                    }}
                    className={`w-full text-left px-2 py-1 text-xs rounded ${
                      mod.printerRouting === 'also' ? 'bg-blue-100 text-blue-700 font-semibold' : 'hover:bg-blue-50'
                    }`}
                  >
                    Also Print To...
                  </button>
                  <button
                    onClick={() => {
                      if (mod.printerRouting !== 'only') {
                        updateModifier(groupId, mod.id, { printerRouting: 'only', printerIds: [] })
                      }
                    }}
                    className={`w-full text-left px-2 py-1 text-xs rounded ${
                      mod.printerRouting === 'only' ? 'bg-orange-100 text-orange-700 font-semibold' : 'hover:bg-orange-50'
                    }`}
                  >
                    Only Print To...
                  </button>
                </div>

                {/* Printer Selection (only show for "also" or "only") */}
                {(mod.printerRouting === 'also' || mod.printerRouting === 'only') && (
                  <div className="border-t pt-2">
                    <div className="text-[10px] text-gray-500 mb-1">Select Printers:</div>
                    {printers.length === 0 ? (
                      <div className="text-xs text-gray-400 py-2 text-center">
                        No printers configured
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {printers.map(printer => {
                          const isSelected = (mod.printerIds || []).includes(printer.id)
                          return (
                            <label key={printer.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const currentIds = mod.printerIds || []
                                  const newIds = e.target.checked
                                    ? [...currentIds, printer.id]
                                    : currentIds.filter(id => id !== printer.id)
                                  updateModifier(groupId, mod.id, { printerIds: newIds })
                                }}
                                className="w-3 h-3"
                              />
                              <span>{printer.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => deleteModifier(groupId, mod.id)}
            className="text-red-400 hover:text-red-600 text-xs shrink-0"
          >
            ×
          </button>

          {/* Create Child Group Button — only if no child group exists yet */}
          {!mod.childModifierGroupId && (
            <button
              onClick={(e) => { e.stopPropagation(); createChildGroup(mod.id) }}
              className="w-5 h-5 rounded bg-indigo-100 text-indigo-600 hover:bg-indigo-200 text-xs font-bold"
              title="Add sub-group"
            >
              +▶
            </button>
          )}
        </div>

        {/* Hierarchical Ingredient Dropdown */}
        {isLinking && (
          <div className="ml-4 p-2 bg-purple-50 border border-purple-200 rounded">
            <IngredientHierarchyPicker
              ingredientsLibrary={ingredientsLibrary}
              ingredientCategories={ingredientCategories}
              searchTerm={modIngredientSearch}
              onSearchChange={setModIngredientSearch}
              searchPlaceholder="Search prep items..."
              actionLabel="Link"
              actionColor="purple"
              onAction={(prepId) => { if (linkingModifier) linkIngredient(linkingModifier.groupId, linkingModifier.modId, prepId) }}
              creatingNewCategory={creatingNewCategory}
              setCreatingNewCategory={setCreatingNewCategory}
              newCategoryName={newCategoryName}
              setNewCategoryName={setNewCategoryName}
              onCreateCategory={createCategory}
              creatingInventoryInCategory={creatingInventoryInCategory}
              setCreatingInventoryInCategory={setCreatingInventoryInCategory}
              newInventoryName={newInventoryName}
              setNewInventoryName={setNewInventoryName}
              onCreateInventoryItem={createInventoryItem}
              creatingPrepUnderParent={creatingPrepUnderParent}
              setCreatingPrepUnderParent={setCreatingPrepUnderParent}
              newPrepName={newPrepName}
              setNewPrepName={setNewPrepName}
              onCreatePrepItem={createPrepItem}
              creatingIngredientLoading={creatingIngredientLoading}
              createPrepLabel="Create & Link"
            />
          </div>
        )}

        {/* Render Child Group: collapsed chip or full expanded view */}
        {mod.childModifierGroup && (() => {
          const cg = mod.childModifierGroup
          const cgExpanded = expandedGroups.has(cg.id)
          if (cgExpanded) {
            return renderChildGroup(cg, depth + 1, rowIndex)
          }
          // Collapsed: compact inline chip
          const colorIndex = (depth + rowIndex) % childGroupColors.length
          const colors = childGroupColors[colorIndex]
          return (
            <div
              key={`chip-${cg.id}`}
              className={`ml-6 mt-0.5 mb-0.5 flex items-center gap-1.5 cursor-pointer group/chip`}
              onClick={() => { toggleExpanded(cg.id); onSelectGroup?.(cg.id) }}
              title={`${cg.name} — ${cg.modifiers.length} modifier${cg.modifiers.length !== 1 ? 's' : ''} (click to expand)`}
            >
              <div className={`h-1.5 w-1.5 rounded-full ${colors.bg} border ${colors.border} shrink-0`} />
              <span className={`text-[10px] ${colors.border.replace('border-', 'text-')} group-hover/chip:underline truncate`}>
                {cg.name}
              </span>
              <span className="text-[9px] text-gray-400">
                ({cg.modifiers.length})
              </span>
            </div>
          )
        })()}
      </div>
    )
  }

  // Helper to render child modifier groups recursively
  // Color palette for child group headers — cycles through distinct colors per depth
  const childGroupColors = [
    { bg: 'bg-violet-100', border: 'border-violet-300', borderB: 'border-violet-200', hover: 'hover:bg-violet-200/70', wrapper: 'border-violet-300', leftBorder: 'border-l-violet-300' },
    { bg: 'bg-teal-100', border: 'border-teal-300', borderB: 'border-teal-200', hover: 'hover:bg-teal-200/70', wrapper: 'border-teal-300', leftBorder: 'border-l-teal-300' },
    { bg: 'bg-rose-100', border: 'border-rose-300', borderB: 'border-rose-200', hover: 'hover:bg-rose-200/70', wrapper: 'border-rose-300', leftBorder: 'border-l-rose-300' },
    { bg: 'bg-amber-100', border: 'border-amber-300', borderB: 'border-amber-200', hover: 'hover:bg-amber-200/70', wrapper: 'border-amber-300', leftBorder: 'border-l-amber-300' },
    { bg: 'bg-sky-100', border: 'border-sky-300', borderB: 'border-sky-200', hover: 'hover:bg-sky-200/70', wrapper: 'border-sky-300', leftBorder: 'border-l-sky-300' },
  ]

  const renderChildGroup = (childGroup: ModifierGroup, depth: number = 1, siblingIndex: number = 0) => {
    // Safety: prevent infinite recursion
    if (depth > 10) {
      console.error('Max nesting depth exceeded for group:', childGroup.id)
      return (
        <div className="ml-4 p-2 text-xs text-red-500 bg-red-50 rounded">
          ⚠ Maximum nesting depth reached
        </div>
      )
    }

    const isExpanded = expandedGroups.has(childGroup.id)
    const isEmpty = childGroup.modifiers.length === 0
    const colorIndex = (depth - 1 + siblingIndex) % childGroupColors.length
    const colors = childGroupColors[colorIndex]
    const depthIndent: Record<number, string> = {
      0: 'ml-0',
      1: 'ml-4',
      2: 'ml-8',
      3: 'ml-12',
      4: 'ml-16',
    }
    const indentClass = `${depthIndent[depth] ?? 'ml-16'} pl-3 border-l-2 ${colors.leftBorder}`

    return (
      <div
        key={childGroup.id}
        className={`mt-2 ${indentClass} ${draggedGroupId === childGroup.id ? 'opacity-50' : ''}`}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          setDraggedGroupId(childGroup.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-modifier-group', JSON.stringify({
            groupId: childGroup.id,
            sourceItemId: item?.id,
            groupName: childGroup.name,
            isChild: true,
          }))
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOverGroupId(childGroup.id)
        }}
        onDragLeave={() => setDragOverGroupId(null)}
        onDrop={(e) => handleGroupDrop(e, childGroup.id)}
        onDragEnd={() => {
          setDraggedGroupId(null)
          setDragOverGroupId(null)
          setDragOverDropZone(null)
        }}
      >
        {/* Removed "After selecting parent modifier:" label to save space */}
        <div className={`border-2 ${colors.wrapper} rounded-lg overflow-hidden shadow-sm ${childGroup.isRequired ? 'border-l-4 border-l-red-400' : ''} ${isEmpty ? 'border-dashed' : ''} ${dragOverGroupId === childGroup.id && draggedGroupId !== childGroup.id ? 'ring-2 ring-indigo-400' : ''}`}>
          {/* Child Group Header — entire bar is clickable to expand/collapse */}
          <div
            className={`px-3 py-2 ${colors.bg} border-b ${colors.borderB} flex items-center gap-2 cursor-pointer ${colors.hover} transition-colors`}
            onClick={() => {
              toggleExpanded(childGroup.id)
              onSelectGroup?.(isExpanded ? null : childGroup.id)
            }}
          >
            {/* Drag handle */}
            <span className="cursor-grab text-gray-400 hover:text-gray-600 mr-1 text-xs" title="Drag to move group" onClick={(e) => e.stopPropagation()}>⠿</span>
            {/* Expand/collapse arrow */}
            <span className={`text-xs transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''} ${childGroup.isRequired && isEmpty ? 'text-red-500' : isEmpty ? 'text-gray-300' : 'text-green-500'}`}>
              ▶
            </span>

            {/* Name - double-click to rename */}
            {renamingGroupId === childGroup.id ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(childGroup.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(childGroup.id)
                  if (e.key === 'Escape') { modGroupManager.setRenamingGroupId(null); setRenameValue('') }
                }}
                className="flex-1 px-1 py-0.5 text-sm font-medium border rounded bg-white"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="flex-1 font-medium text-sm truncate"
                onDoubleClick={(e) => { e.stopPropagation(); startRename(childGroup.id, childGroup.name) }}
                title="Double-click to rename"
              >
                {childGroup.name}
              </span>
            )}

            {/* Settings badges — always visible in header */}
            <span className="ml-auto text-[9px] text-gray-400 flex items-center gap-1 shrink-0">
              <span className="px-1 py-0.5 bg-gray-100 rounded">{childGroup.minSelections}-{childGroup.maxSelections}</span>
              {childGroup.isRequired && <span className="px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium">Req</span>}
              {childGroup.allowStacking && <span className="px-1 py-0.5 bg-yellow-100 text-yellow-700 rounded">Stack</span>}
            </span>
            <span className="text-xs text-gray-400">{childGroup.modifiers.length}</span>

            {/* Promote to top-level button */}
            <button
              onClick={(e) => { e.stopPropagation(); reparentGroup(childGroup.id, null) }}
              className="text-gray-400 hover:text-green-600 text-xs px-0.5"
              title="Promote to top-level group"
              disabled={saving}
            >
              ⬆
            </button>

            {/* Action buttons */}
            <button
              onClick={(e) => { e.stopPropagation(); startRename(childGroup.id, childGroup.name) }}
              className="text-gray-400 hover:text-indigo-600 text-xs px-0.5"
              title="Rename"
              disabled={saving}
            >
              ✏️
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); duplicateGroup(childGroup.id) }}
              className="text-gray-400 hover:text-indigo-600 text-xs px-0.5"
              title="Duplicate Group"
              disabled={saving}
            >
              ⧉
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deleteGroup(childGroup.id) }}
              className="text-gray-400 hover:text-red-600 text-xs px-0.5"
              title="Delete Group"
              disabled={saving}
            >
              🗑
            </button>
          </div>

          {/* Child Group Expanded Content */}
          {isExpanded && (
            <div className="border-t" draggable={false} onDragStart={(e) => e.stopPropagation()}>
              {/* Child Modifiers */}
              <div className="p-2 space-y-1">
                {isEmpty && (
                  <div className="text-center text-gray-400 text-xs py-2 italic">
                    Add modifiers to get started
                  </div>
                )}
                {childGroup.modifiers.map((mod, idx) => renderModifierRow(childGroup.id, mod, depth, idx))}

                {/* Drop zone: nest a group inside this child group */}
                {draggedGroupId && draggedGroupId !== childGroup.id && !isDescendantOf(draggedGroupId, childGroup.id) && (
                  <div
                    className={`py-2 px-3 text-xs text-center rounded border-2 border-dashed transition-colors ${dragOverDropZone === `nest-${childGroup.id}` ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-400'}`}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverDropZone(`nest-${childGroup.id}`) }}
                    onDragLeave={() => setDragOverDropZone(null)}
                    onDrop={async (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (draggedGroupId) {
                        await nestGroupInGroup(draggedGroupId, childGroup.id)
                      }
                      setDraggedGroupId(null)
                      setDragOverGroupId(null)
                      setDragOverDropZone(null)
                    }}
                  >
                    ⬇ Drop here to nest inside {childGroup.name}
                  </div>
                )}

                {/* Add Modifier to Child Group */}
                {addingModifierTo === childGroup.id ? (
                  <div className="flex gap-1 mt-2">
                    <input
                      type="text"
                      value={newModName}
                      onChange={(e) => setNewModName(e.target.value)}
                      placeholder="Name"
                      className="flex-1 px-2 py-1 text-xs border rounded"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (addingType === 'choice') {
                            addChoice(childGroup.id)
                          } else {
                            addModifier(childGroup.id)
                          }
                        }
                      }}
                    />
                    {addingType === 'item' && (
                      <input
                        type="number"
                        value={newModPrice}
                        onChange={(e) => setNewModPrice(e.target.value)}
                        placeholder="$"
                        className="w-14 px-2 py-1 text-xs border rounded"
                        step="0.01"
                        min="0"
                      />
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => addingType === 'choice' ? addChoice(childGroup.id) : addModifier(childGroup.id)}
                      disabled={!newModName.trim()}
                    >
                      +
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddingModifierTo(null); setAddingType(null); setNewModName(''); setNewModPrice('') }}>
                      ×
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setAddingModifierTo(childGroup.id); setAddingType('item') }}
                      className="flex-1 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded border border-dashed border-indigo-300"
                    >
                      + Add Item
                    </button>
                    <button
                      onClick={() => { setAddingModifierTo(childGroup.id); setAddingType('choice') }}
                      className="flex-1 py-1 text-xs text-amber-600 hover:bg-amber-50 rounded border border-dashed border-amber-300"
                    >
                      + Add Choice
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 p-4 bg-gray-50">
        <p className="text-sm">Select an item to edit</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Item Header */}
      <div className="p-4 border-b bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold truncate">{item.name}</h2>
              {!loading && (() => {
                const seen = new Set<string>()
                const allDefaults: { id: string; name: string; price: number }[] = []
                const collectDefaults = (groups: ModifierGroup[]) => {
                  for (const g of groups) {
                    for (const m of g.modifiers) {
                      if (m.isDefault && !seen.has(m.id)) {
                        seen.add(m.id)
                        allDefaults.push({ id: m.id, name: m.name, price: m.price })
                      }
                      if (m.childModifierGroup) collectDefaults([m.childModifierGroup])
                    }
                  }
                }
                collectDefaults(modifierGroups)
                if (allDefaults.length === 0) return null
                return (
                  <span className="ml-auto text-[11px] font-semibold text-red-300 truncate shrink-0 pl-3">
                    ★ {allDefaults.map(d => d.name).join(', ')}
                  </span>
                )
              })()}
            </div>
            <div className="mt-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">{formatCurrency(item.price)}</span>
                {isDualPricingEnabled && (
                  <>
                    <span className="text-xs text-slate-400">cash</span>
                    <span className="text-lg font-semibold text-indigo-400">{formatCurrency(itemCardPrice)}</span>
                    <span className="text-xs text-slate-400">card</span>
                  </>
                )}
              </div>
              {isTaxInclusive && (
                <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 mt-1">
                  TAX INCLUSIVE
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setShowSettingsModal(true)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-white/20 hover:bg-white/30"
              title="Edit Item"
            >
              Edit Item
            </button>
            {onToggle86 && (
              <button
                onClick={() => onToggle86(item)}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  !item.isAvailable ? 'bg-white text-blue-600' : 'bg-white/20 hover:bg-white/30'
                }`}
              >
                {!item.isAvailable ? 'Restore' : '86 It'}
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(item.id)}
                className="px-3 py-1.5 rounded text-sm bg-red-500/80 hover:bg-red-500"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : (
          <>
            {/* INGREDIENTS SECTION - Collapsible */}
            <div className="border-b">
              <button
                onClick={() => setIngredientsExpanded(!ingredientsExpanded)}
                className="w-full px-4 py-3 bg-green-50 flex items-center justify-between hover:bg-green-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-green-600 transition-transform ${ingredientsExpanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="font-semibold text-green-900">🥗 Ingredients</span>
                  <span className="text-sm text-green-600">({ingredients.length})</span>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  className="text-green-600 text-xs font-semibold px-2 py-1 hover:bg-green-100 rounded cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setShowIngredientPicker(!showIngredientPicker); setIngredientsExpanded(true) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setShowIngredientPicker(!showIngredientPicker); setIngredientsExpanded(true) } }}
                >
                  + Add
                </span>
              </button>

              {ingredientsExpanded && (
                <div className="p-3 space-y-2">
                  {/* Hierarchical Ingredient Picker */}
                  {showIngredientPicker && (
                    <div className="p-2 border rounded bg-white mb-2">
                      <IngredientHierarchyPicker
                        ingredientsLibrary={ingredientsLibrary}
                        ingredientCategories={ingredientCategories}
                        searchTerm={ingredientSearch}
                        onSearchChange={setIngredientSearch}
                        actionLabel="+ Add"
                        actionColor="green"
                        onAction={addIngredient}
                        excludeIds={new Set(ingredients.map(i => i.ingredientId))}
                        showAvailableCount
                        creatingNewCategory={creatingNewCategory}
                        setCreatingNewCategory={setCreatingNewCategory}
                        newCategoryName={newCategoryName}
                        setNewCategoryName={setNewCategoryName}
                        onCreateCategory={createCategory}
                        creatingInventoryInCategory={creatingInventoryInCategory}
                        setCreatingInventoryInCategory={setCreatingInventoryInCategory}
                        newInventoryName={newInventoryName}
                        setNewInventoryName={setNewInventoryName}
                        onCreateInventoryItem={createInventoryItem}
                        creatingPrepUnderParent={creatingPrepUnderParent}
                        setCreatingPrepUnderParent={setCreatingPrepUnderParent}
                        newPrepName={newPrepName}
                        setNewPrepName={setNewPrepName}
                        onCreatePrepItem={createPrepItem}
                        creatingIngredientLoading={creatingIngredientLoading}
                        createPrepLabel="Create & Add"
                      />
                    </div>
                  )}

                  {ingredients.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-2">No ingredients linked</p>
                  ) : (
                    ingredients.map(ing => {
                      const linkedModifiers = ingredientToModifiers.get(ing.ingredientId) || []
                      const libItem = ingredientsLibrary.find(l => l.id === ing.ingredientId)
                      const isUnverified = ing.needsVerification || libItem?.needsVerification
                      const isRelinking = relinkingIngredientId === ing.ingredientId
                      const isPrepItem = !!libItem?.parentIngredientId
                      const parentName = libItem?.parentName
                      const parentId = libItem?.parentIngredientId
                      const categoryName = libItem?.categoryName || ing.category
                      return (
                        <div key={ing.ingredientId} className={`rounded border overflow-hidden ${isPrepItem ? 'border-green-200' : 'border-blue-200'}`}>
                          {/* Hierarchy breadcrumb — stepped display */}
                          <div className="px-2 pt-1.5 pb-1 bg-white">
                            <div className="flex items-center gap-0 text-[9px] leading-tight">
                              {/* Level 1: Category */}
                              {categoryName && (
                                <>
                                  <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-semibold">{categoryName}</span>
                                  <span className="text-gray-300 mx-0.5">›</span>
                                </>
                              )}
                              {/* Level 2: Inventory item (parent) — clickable link */}
                              {isPrepItem && parentName ? (
                                <>
                                  <a
                                    href="/ingredients"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold hover:bg-blue-200 hover:underline transition-colors cursor-pointer"
                                    title={`Open ${parentName} in Inventory`}
                                  >
                                    {parentName}
                                    <span className="text-[7px] text-blue-400">↗</span>
                                  </a>
                                  <span className="text-gray-300 mx-0.5">›</span>
                                </>
                              ) : !isPrepItem && (
                                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded font-semibold">{ing.name}</span>
                              )}
                              {/* Level 3: Prep item (this item) */}
                              {isPrepItem && (
                                <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-semibold">{ing.name}</span>
                              )}
                            </div>
                          </div>

                          {/* Main row: Type badge + Name + actions */}
                          <div className={`flex items-center gap-1.5 px-2 py-1.5 ${isPrepItem ? 'bg-green-50' : 'bg-blue-50'}`}>
                            {/* Type badge */}
                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold shrink-0 ${isPrepItem ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
                              {isPrepItem ? 'PREP' : 'INV'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-medium truncate">{ing.name}</span>
                                {isUnverified && (
                                  <span className="text-[9px] px-1 py-0.5 bg-red-100 text-red-600 rounded font-semibold shrink-0">
                                    ⚠ Unverified
                                  </span>
                                )}
                              </div>
                              {/* Modifier links */}
                              {linkedModifiers.length > 0 && (
                                <div className="text-[9px] text-purple-500 mt-0.5">🔗 {linkedModifiers.map(lm => lm.modName).join(', ')}</div>
                              )}
                            </div>
                            {/* Relink button */}
                            <button
                              onClick={() => {
                                if (isRelinking) {
                                  setRelinkingIngredientId(null)
                                  setIngredientSearch('')
                                } else {
                                  setRelinkingIngredientId(ing.ingredientId)
                                  setIngredientSearch('')
                                }
                              }}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${isRelinking ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                              title={isRelinking ? 'Close picker' : 'Change linked ingredient'}
                            >
                              {isRelinking ? '✕ Close' : '🔗 Relink'}
                            </button>
                            {/* Unlink button — removes this ingredient from the item (with confirmation) */}
                            <button
                              onClick={() => {
                                if (confirm(`Unlink "${ing.name}" from this item?`)) {
                                  removeIngredient(ing.ingredientId)
                                  toast.success(`Unlinked ${ing.name}`)
                                }
                              }}
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-red-100 text-red-600 hover:bg-red-200 active:bg-red-300"
                              title="Unlink this ingredient from the item"
                            >
                              Unlink
                            </button>
                          </div>

                          {/* Inline relink picker — swap this ingredient for a different one */}
                          {isRelinking && (
                            <div className="p-2 border-2 border-blue-400 rounded bg-white">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <span className="text-[10px] font-bold text-blue-700 uppercase">Relink to:</span>
                                <span className="text-[10px] text-gray-400 flex-1">expand → tap Link</span>
                                <button
                                  onClick={() => { setRelinkingIngredientId(null); setIngredientSearch('') }}
                                  className="text-xs text-gray-400 hover:text-red-500 px-1"
                                >✕</button>
                              </div>
                              <IngredientHierarchyPicker
                                ingredientsLibrary={ingredientsLibrary}
                                ingredientCategories={ingredientCategories}
                                searchTerm={ingredientSearch}
                                onSearchChange={setIngredientSearch}
                                actionLabel="Link"
                                actionColor="green"
                                onAction={(prepId) => swapIngredientLink(ing.ingredientId, prepId)}
                                excludeIds={new Set([...ingredients.map(i => i.ingredientId), ing.ingredientId])}
                                showAvailableCount
                                maxHeight="max-h-64"
                                showCategoryCreation={false}
                                showInventoryCreation={false}
                                creatingNewCategory={creatingNewCategory}
                                setCreatingNewCategory={setCreatingNewCategory}
                                newCategoryName={newCategoryName}
                                setNewCategoryName={setNewCategoryName}
                                onCreateCategory={createCategory}
                                creatingInventoryInCategory={creatingInventoryInCategory}
                                setCreatingInventoryInCategory={setCreatingInventoryInCategory}
                                newInventoryName={newInventoryName}
                                setNewInventoryName={setNewInventoryName}
                                onCreateInventoryItem={createInventoryItem}
                                creatingPrepUnderParent={creatingPrepUnderParent}
                                setCreatingPrepUnderParent={setCreatingPrepUnderParent}
                                newPrepName={newPrepName}
                                setNewPrepName={setNewPrepName}
                                onCreatePrepItem={createPrepItem}
                                creatingIngredientLoading={creatingIngredientLoading}
                              />
                            </div>
                          )}

                          {/* Row 2: Pre-modifier toggles + extra price */}
                          <div className="flex items-center gap-1 flex-wrap">
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowNo')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowNo ? 'bg-red-500 text-white border-red-500' : 'bg-red-50 text-red-300 border-red-200'}`}
                              title="Allow NO"
                            >
                              No
                            </button>
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowLite')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowLite ? 'bg-yellow-500 text-white border-yellow-500' : 'bg-yellow-50 text-yellow-300 border-yellow-200'}`}
                              title="Allow LITE"
                            >
                              Lite
                            </button>
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowOnSide')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowOnSide ? 'bg-blue-500 text-white border-blue-500' : 'bg-blue-50 text-blue-300 border-blue-200'}`}
                              title="Allow ON SIDE"
                            >
                              Side
                            </button>
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowExtra')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowExtra ? 'bg-green-500 text-white border-green-500' : 'bg-green-50 text-green-300 border-green-200'}`}
                              title="Allow EXTRA"
                            >
                              Extra
                            </button>
                            {ing.allowExtra && (
                              <span className="flex items-center gap-0.5">
                                <span className="text-[9px] font-bold text-green-600">$</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.25"
                                  defaultValue={ing.extraPrice}
                                  onBlur={(e) => {
                                    const val = parseFloat(e.target.value) || 0
                                    if (val !== ing.extraPrice) updateExtraPrice(ing.ingredientId, val)
                                  }}
                                  className="w-14 px-1 py-0 text-[10px] border rounded text-center"
                                />
                              </span>
                            )}
                            <button
                              onClick={() => toggleIngredientOption(ing.ingredientId, 'allowSwap')}
                              className={`px-2 py-0.5 rounded text-[9px] font-bold border ${ing.allowSwap ? 'bg-purple-500 text-white border-purple-500' : 'bg-purple-50 text-purple-300 border-purple-200'}`}
                              title="Allow SWAP"
                            >
                              Swap
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>

            {/* MODIFIER GROUPS - Interactive Editor */}
            <div className="border-b">
              <div className="px-4 py-3 bg-indigo-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-indigo-900">⚙️ Modifier Groups</span>
                  <span className="text-sm text-indigo-600">({modifierGroups.length})</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-indigo-600 text-xs"
                  onClick={() => setShowNewGroupForm(true)}
                  disabled={saving}
                >
                  + Add Group
                </Button>
              </div>

              {/* New Group Form */}
              {showNewGroupForm && (
                <div className="p-2 border-b bg-indigo-50/50">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Group name"
                    className="w-full px-2 py-1 text-sm border rounded mb-2"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && createGroup()}
                  />
                  <div className="flex gap-1">
                    <Button size="sm" onClick={createGroup} disabled={!newGroupName.trim() || saving}>
                      Create
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowNewGroupForm(false); setNewGroupName('') }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Groups List — filter out child groups (they render nested under parent modifier) */}
              <div className="p-3 space-y-2">
                {/* Drop zone to promote a child group to top-level */}
                {draggedGroupId && (() => {
                  const childGroupIdSet = new Set<string>()
                  modifierGroups.forEach(g => {
                    g.modifiers.forEach(m => {
                      if (m.childModifierGroupId) childGroupIdSet.add(m.childModifierGroupId)
                    })
                  })
                  const isChild = childGroupIdSet.has(draggedGroupId)
                  if (!isChild) return null
                  return (
                    <div
                      className={`py-2 px-3 text-xs text-center rounded border-2 border-dashed transition-colors ${dragOverDropZone === 'top-level' ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-300 text-gray-400'}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOverDropZone('top-level') }}
                      onDragLeave={() => setDragOverDropZone(null)}
                      onDrop={async (e) => {
                        e.preventDefault()
                        if (draggedGroupId) {
                          await reparentGroup(draggedGroupId, null)
                        }
                        setDraggedGroupId(null)
                        setDragOverGroupId(null)
                        setDragOverDropZone(null)
                      }}
                    >
                      ⬆ Drop here to promote to top-level
                    </div>
                  )
                })()}
                {(() => {
                  // Build set of child group IDs so we can exclude them from the top-level list
                  const childGroupIdSet = new Set<string>()
                  modifierGroups.forEach(g => {
                    g.modifiers.forEach(m => {
                      if (m.childModifierGroupId) childGroupIdSet.add(m.childModifierGroupId)
                    })
                  })
                  const topLevelGroups = modifierGroups.filter(g => !childGroupIdSet.has(g.id))

                  return topLevelGroups.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-2">No modifier groups</p>
                  ) : (
                    topLevelGroups.map(group => {
                    const isExpanded = expandedGroups.has(group.id)
                    const isEmpty = group.modifiers.length === 0
                    const childModCount = group.modifiers.filter(m => m.childModifierGroupId).length

                    return (
                      <div
                        key={group.id}
                        className={`border-2 border-indigo-300 rounded-lg overflow-hidden shadow-sm ${group.isRequired ? 'border-l-4 border-l-red-400' : ''} ${draggedGroupId === group.id ? 'opacity-50' : ''} ${dragOverGroupId === group.id && draggedGroupId !== group.id ? 'ring-2 ring-indigo-400' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          setDraggedGroupId(group.id)
                          e.dataTransfer.effectAllowed = 'copyMove'
                          // Set data for cross-item copy
                          e.dataTransfer.setData('application/x-modifier-group', JSON.stringify({
                            groupId: group.id,
                            sourceItemId: item.id,
                            groupName: group.name,
                          }))
                        }}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setDragOverGroupId(group.id)
                        }}
                        onDragLeave={() => setDragOverGroupId(null)}
                        onDrop={(e) => handleGroupDrop(e, group.id)}
                        onDragEnd={() => {
                          setDraggedGroupId(null)
                          setDragOverGroupId(null)
                          setDragOverDropZone(null)
                        }}
                      >
                        {/* Group Header - click to expand */}
                        <div
                          className="px-3 py-2 bg-indigo-100 border-b border-indigo-200 flex items-center gap-2 cursor-pointer hover:bg-indigo-150 transition-colors"
                          onClick={() => {
                            toggleExpanded(group.id)
                            onSelectGroup?.(isExpanded ? null : group.id)
                          }}
                        >
                          <span className="cursor-grab text-gray-400 hover:text-gray-600 mr-1" title="Drag to reorder">⠿</span>
                          <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                          {renamingGroupId === group.id ? (
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => commitRename(group.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename(group.id)
                                if (e.key === 'Escape') { modGroupManager.setRenamingGroupId(null); setRenameValue('') }
                              }}
                              className="flex-1 px-1 py-0.5 text-sm font-medium border rounded bg-white"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span
                              className="flex-1 font-medium text-sm truncate"
                              onDoubleClick={(e) => { e.stopPropagation(); startRename(group.id, group.name) }}
                              title="Double-click to rename"
                            >
                              {group.name}
                            </span>
                          )}
                          {/* Settings badges — always visible in header */}
                          <span className="ml-auto text-[9px] text-gray-400 flex items-center gap-1 shrink-0">
                            <span className="px-1 py-0.5 bg-gray-100 rounded">{group.minSelections}-{group.maxSelections}</span>
                            {group.isRequired && <span className="px-1 py-0.5 bg-red-100 text-red-600 rounded font-medium">Req</span>}
                            {group.allowStacking && <span className="px-1 py-0.5 bg-yellow-100 text-yellow-700 rounded">Stack</span>}
                            {(() => {
                              const defaults = group.modifiers.filter(m => m.isDefault)
                              if (defaults.length === 0) return null
                              return <span className="px-1 py-0.5 bg-amber-100 text-amber-700 rounded">★{defaults.length}</span>
                            })()}
                          </span>
                          {childModCount > 0 && <span className="text-[9px] px-1 bg-indigo-100 text-indigo-600 rounded">{childModCount}▶</span>}
                          <span className="text-xs text-gray-400">{group.modifiers.length}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); startRename(group.id, group.name) }}
                            className="text-gray-400 hover:text-indigo-600 text-xs px-0.5"
                            title="Rename"
                            disabled={saving}
                          >
                            ✏️
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); duplicateGroup(group.id) }}
                            className="text-gray-400 hover:text-indigo-600 text-xs px-1"
                            title="Duplicate Group"
                            disabled={saving}
                          >
                            ⧉
                          </button>
                        </div>

                        {/* Expanded: Modifiers */}
                        {isExpanded && (
                          <div className="border-t" draggable={false} onDragStart={(e) => e.stopPropagation()}>

                            {/* Modifier rows */}
                            <div className="p-2 space-y-1">
                              {isEmpty && (
                                <div className="text-center text-gray-400 text-xs py-2 italic">
                                  Add modifiers to get started
                                </div>
                              )}
                              {group.modifiers.map((mod, idx) => renderModifierRow(group.id, mod, 0, idx))}

                              {/* Drop zone: nest a group inside this group */}
                              {draggedGroupId && draggedGroupId !== group.id && !isDescendantOf(draggedGroupId, group.id) && (
                                <div
                                  className={`py-2 px-3 text-xs text-center rounded border-2 border-dashed transition-colors ${dragOverDropZone === `nest-${group.id}` ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-400'}`}
                                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverDropZone(`nest-${group.id}`) }}
                                  onDragLeave={() => setDragOverDropZone(null)}
                                  onDrop={async (e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    if (draggedGroupId) {
                                      await nestGroupInGroup(draggedGroupId, group.id)
                                    }
                                    setDraggedGroupId(null)
                                    setDragOverGroupId(null)
                                    setDragOverDropZone(null)
                                  }}
                                >
                                  ⬇ Drop here to nest inside {group.name}
                                </div>
                              )}

                              {/* Add modifier form */}
                              {addingModifierTo === group.id ? (
                                <div className="flex gap-1 mt-2">
                                  <input
                                    type="text"
                                    value={newModName}
                                    onChange={(e) => setNewModName(e.target.value)}
                                    placeholder="Name"
                                    className="flex-1 px-2 py-1 text-xs border rounded"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        if (addingType === 'choice') {
                                          addChoice(group.id)
                                        } else {
                                          addModifier(group.id)
                                        }
                                      }
                                    }}
                                  />
                                  {addingType === 'item' && (
                                    <input
                                      type="number"
                                      value={newModPrice}
                                      onChange={(e) => setNewModPrice(e.target.value)}
                                      placeholder="$"
                                      className="w-14 px-2 py-1 text-xs border rounded"
                                      step="0.01"
                                      min="0"
                                    />
                                  )}
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    onClick={() => addingType === 'choice' ? addChoice(group.id) : addModifier(group.id)}
                                    disabled={!newModName.trim() || saving}
                                  >
                                    +
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => { setAddingModifierTo(null); setAddingType(null); setNewModName(''); setNewModPrice('') }}>
                                    ×
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => { setAddingModifierTo(group.id); setAddingType('item') }}
                                    className="flex-1 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded border border-dashed border-indigo-300"
                                    disabled={saving}
                                  >
                                    + Add Item
                                  </button>
                                  <button
                                    onClick={() => { setAddingModifierTo(group.id); setAddingType('choice') }}
                                    className="flex-1 py-1 text-xs text-amber-600 hover:bg-amber-50 rounded border border-dashed border-amber-300"
                                    disabled={saving}
                                  >
                                    + Add Choice
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                  )
                })()}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Item Settings Modal */}
      {showSettingsModal && item && (
        <ItemSettingsModal
          itemId={item.id}
          onClose={() => setShowSettingsModal(false)}
          onSaved={onItemUpdated}
          ingredientsLibrary={ingredientsLibrary}
          ingredientCategories={ingredientCategories}
          locationId={locationId}
          onIngredientCreated={onIngredientCreated}
          onCategoryCreated={onCategoryCreated}
        />
      )}
    </div>
  )
}
