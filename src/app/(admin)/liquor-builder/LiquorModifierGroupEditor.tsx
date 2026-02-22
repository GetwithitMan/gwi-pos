'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast-store'

interface LMGEIngredient {
  id: string
  name: string
}

interface LMGEMod {
  id?: string
  name: string
  price: number
  isDefault: boolean
  isActive: boolean
  showOnPOS: boolean
  ingredientId: string | null
}

interface LMGEGroup {
  id: string
  name: string
  displayName?: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking: boolean
  modifiers: Array<{
    id: string
    name: string
    price: number
    isDefault: boolean
    isActive: boolean
    showOnPOS?: boolean
    ingredientId?: string | null
  }>
}

interface LiquorModifierGroupEditorProps {
  group: LMGEGroup
  onSaved: () => void
  onDelete?: () => void
}

export function LiquorModifierGroupEditor({ group, onSaved, onDelete }: LiquorModifierGroupEditorProps) {
  const [groupName, setGroupName] = useState(group.name)
  const [minSel, setMinSel] = useState(group.minSelections)
  const [maxSel, setMaxSel] = useState(group.maxSelections)
  const [isRequired, setIsRequired] = useState(group.isRequired)
  const [allowStacking, setAllowStacking] = useState(group.allowStacking)
  const [mods, setMods] = useState<LMGEMod[]>(
    group.modifiers.map(m => ({
      id: m.id,
      name: m.name,
      price: m.price,
      isDefault: m.isDefault,
      isActive: m.isActive,
      showOnPOS: m.showOnPOS ?? true,
      ingredientId: m.ingredientId || null,
    }))
  )
  const [ingredients, setIngredients] = useState<LMGEIngredient[]>([])
  const [saving, setSaving] = useState(false)

  // Reset state when the selected group changes
  useEffect(() => {
    setGroupName(group.name)
    setMinSel(group.minSelections)
    setMaxSel(group.maxSelections)
    setIsRequired(group.isRequired)
    setAllowStacking(group.allowStacking)
    setMods(
      group.modifiers.map(m => ({
        id: m.id,
        name: m.name,
        price: m.price,
        isDefault: m.isDefault,
        isActive: m.isActive,
        showOnPOS: m.showOnPOS ?? true,
        ingredientId: m.ingredientId || null,
      }))
    )
  }, [group.id])

  // Load ingredients for inventory tracking picker
  useEffect(() => {
    fetch('/api/ingredients')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data) setIngredients(data.data || data || [])
      })
      .catch(() => {})
  }, [])

  const addMod = () => {
    setMods([...mods, { name: '', price: 0, isDefault: false, isActive: true, showOnPOS: true, ingredientId: null }])
  }

  const updateMod = (i: number, field: keyof LMGEMod, value: any) => {
    const next = [...mods]
    next[i] = { ...next[i], [field]: value }
    setMods(next)
  }

  const removeMod = (i: number) => {
    setMods(mods.filter((_, idx) => idx !== i))
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/menu/modifiers/${group.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName.trim(),
          minSelections: minSel,
          maxSelections: maxSel,
          isRequired,
          allowStacking,
          modifiers: mods
            .filter(m => m.name.trim())
            .map(m => ({
              id: m.id,
              name: m.name.trim(),
              price: m.price,
              isDefault: m.isDefault,
              isActive: m.isActive,
              showOnPOS: m.showOnPOS,
              ingredientId: m.ingredientId || null,
            })),
        }),
      })
      if (res.ok) {
        toast.success('Saved')
        onSaved()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
      }
    } finally {
      setSaving(false)
    }
  }

  const activeCount = mods.filter(m => m.isActive && m.name.trim()).length

  return (
    <div className="p-5 space-y-5 overflow-y-auto h-full">
      {/* Group Settings */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Group Settings</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Group Name</label>
            <input
              type="text"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Min Selections</label>
            <input
              type="number"
              min="0"
              value={minSel}
              onChange={e => setMinSel(parseInt(e.target.value) || 0)}
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Max Selections</label>
            <input
              type="number"
              min="1"
              value={maxSel}
              onChange={e => setMaxSel(parseInt(e.target.value) || 1)}
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={e => setIsRequired(e.target.checked)}
              className="w-4 h-4 text-purple-600"
            />
            <span className="text-sm">Required</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allowStacking}
              onChange={e => setAllowStacking(e.target.checked)}
              className="w-4 h-4 text-purple-600"
            />
            <span className="text-sm">Allow Stacking</span>
          </label>
        </div>
      </div>

      {/* Modifier Options */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Options ({activeCount} active)
          </span>
          <button
            onClick={addMod}
            className="text-xs text-purple-600 hover:text-purple-800 font-medium"
          >
            + Add Option
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-12 gap-1 text-[10px] text-gray-400 px-1 mb-1">
          <div className="col-span-4">Name</div>
          <div className="col-span-2 text-right">+Charge</div>
          <div className="col-span-4">Inventory Link</div>
          <div className="col-span-1 text-center">On</div>
          <div className="col-span-1"></div>
        </div>

        <div className="space-y-1">
          {mods.map((mod, i) => (
            <div
              key={i}
              className={`grid grid-cols-12 gap-1 items-center p-1.5 rounded border transition-colors ${
                mod.isActive ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'
              }`}
            >
              {/* Name */}
              <div className="col-span-4">
                <input
                  type="text"
                  value={mod.name}
                  onChange={e => updateMod(i, 'name', e.target.value)}
                  placeholder="e.g. Lime, Coke"
                  className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>

              {/* Price */}
              <div className="col-span-2">
                <div className="relative">
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={mod.price}
                    onChange={e => updateMod(i, 'price', parseFloat(e.target.value) || 0)}
                    className="w-full pl-4 pr-1 py-1 text-sm border rounded text-right focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                </div>
              </div>

              {/* Ingredient picker for inventory deduction */}
              <div className="col-span-4">
                <select
                  value={mod.ingredientId || ''}
                  onChange={e => updateMod(i, 'ingredientId', e.target.value || null)}
                  className="w-full px-1.5 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-purple-400 bg-white"
                >
                  <option value="">— no tracking</option>
                  {ingredients.map(ing => (
                    <option key={ing.id} value={ing.id}>{ing.name}</option>
                  ))}
                </select>
              </div>

              {/* Active toggle */}
              <div className="col-span-1 flex justify-center">
                <input
                  type="checkbox"
                  checked={mod.isActive}
                  onChange={e => updateMod(i, 'isActive', e.target.checked)}
                  className="w-4 h-4"
                  title="Active on POS"
                />
              </div>

              {/* Remove */}
              <div className="col-span-1 flex justify-center">
                <button
                  onClick={() => removeMod(i)}
                  className="text-gray-300 hover:text-red-500 text-lg leading-none"
                  title="Remove option"
                >
                  ×
                </button>
              </div>
            </div>
          ))}

          {mods.length === 0 && (
            <div className="text-center py-6 bg-gray-50 rounded border border-dashed border-gray-300">
              <p className="text-sm text-gray-400">No options yet.</p>
              <button onClick={addMod} className="mt-1 text-xs text-purple-600 hover:text-purple-800">
                + Add first option
              </button>
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-400 mt-2">
          "Inventory Link" deducts from stock each time this option is ordered (e.g. link "Lime" to your lime ingredient).
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-3 border-t sticky bottom-0 bg-white pb-1">
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-sm text-red-400 hover:text-red-600"
          >
            Delete Group
          </button>
        )}
        <Button
          onClick={save}
          disabled={saving || !groupName.trim()}
          size="sm"
          className="ml-auto bg-purple-600 hover:bg-purple-700 text-white"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
