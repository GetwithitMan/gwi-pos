'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

interface ModifierGroup {
  id: string
  name: string
  modifiers: { id: string; name: string; price: number }[]
}

interface Ingredient {
  id: string
  name: string
  category: string | null
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number
  allowSwap: boolean
  swapModifierGroupId: string | null
  swapModifierGroup: ModifierGroup | null
  swapUpcharge: number
  sortOrder: number
  isActive: boolean
}

const CATEGORIES = [
  { value: 'produce', label: 'Produce' },
  { value: 'protein', label: 'Protein' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'sauce', label: 'Sauce' },
  { value: 'bread', label: 'Bread' },
  { value: 'topping', label: 'Topping' },
  { value: 'other', label: 'Other' },
]

export default function IngredientsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null)
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [search, setSearch] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    allowNo: true,
    allowLite: true,
    allowOnSide: true,
    allowExtra: true,
    extraPrice: '',
    allowSwap: false,
    swapModifierGroupId: '',
    swapUpcharge: '',
    isActive: true,
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/ingredients')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (employee?.location?.id) {
      loadIngredients()
      loadModifierGroups()
    }
  }, [employee?.location?.id])

  const loadIngredients = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        includeInactive: 'true',
      })
      const response = await fetch(`/api/ingredients?${params}`)
      if (response.ok) {
        const data = await response.json()
        setIngredients(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load ingredients:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadModifierGroups = async () => {
    if (!employee?.location?.id) return

    try {
      const params = new URLSearchParams({ locationId: employee.location.id })
      const response = await fetch(`/api/menu/modifiers?${params}`)
      if (response.ok) {
        const data = await response.json()
        // API returns modifierGroups, not data
        setModifierGroups(data.modifierGroups || [])
      }
    } catch (error) {
      console.error('Failed to load modifier groups:', error)
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      category: '',
      allowNo: true,
      allowLite: true,
      allowOnSide: true,
      allowExtra: true,
      extraPrice: '',
      allowSwap: false,
      swapModifierGroupId: '',
      swapUpcharge: '',
      isActive: true,
    })
    setEditingIngredient(null)
  }

  const handleEdit = (ingredient: Ingredient) => {
    setEditingIngredient(ingredient)
    setFormData({
      name: ingredient.name,
      category: ingredient.category || '',
      allowNo: ingredient.allowNo,
      allowLite: ingredient.allowLite,
      allowOnSide: ingredient.allowOnSide,
      allowExtra: ingredient.allowExtra,
      extraPrice: ingredient.extraPrice > 0 ? ingredient.extraPrice.toString() : '',
      allowSwap: ingredient.allowSwap,
      swapModifierGroupId: ingredient.swapModifierGroupId || '',
      swapUpcharge: ingredient.swapUpcharge > 0 ? ingredient.swapUpcharge.toString() : '',
      isActive: ingredient.isActive,
    })
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!employee?.location?.id) return

    const payload = {
      locationId: employee.location.id,
      name: formData.name,
      category: formData.category || null,
      allowNo: formData.allowNo,
      allowLite: formData.allowLite,
      allowOnSide: formData.allowOnSide,
      allowExtra: formData.allowExtra,
      extraPrice: parseFloat(formData.extraPrice) || 0,
      allowSwap: formData.allowSwap,
      swapModifierGroupId: formData.allowSwap ? formData.swapModifierGroupId || null : null,
      swapUpcharge: formData.allowSwap ? parseFloat(formData.swapUpcharge) || 0 : 0,
      isActive: formData.isActive,
    }

    try {
      const url = editingIngredient
        ? `/api/ingredients/${editingIngredient.id}`
        : '/api/ingredients'
      const method = editingIngredient ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        await loadIngredients()
        setShowModal(false)
        resetForm()
      } else {
        const errorData = await response.json()
        alert(errorData.error || 'Failed to save ingredient')
      }
    } catch (error) {
      console.error('Failed to save ingredient:', error)
      alert('Failed to save ingredient')
    }
  }

  const handleDelete = async (ingredient: Ingredient) => {
    if (!confirm(`Are you sure you want to delete "${ingredient.name}"?`)) return

    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await loadIngredients()
      } else {
        const errorData = await response.json()
        alert(errorData.error || 'Failed to delete ingredient')
      }
    } catch (error) {
      console.error('Failed to delete ingredient:', error)
      alert('Failed to delete ingredient')
    }
  }

  const toggleActive = async (ingredient: Ingredient) => {
    try {
      const response = await fetch(`/api/ingredients/${ingredient.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !ingredient.isActive }),
      })

      if (response.ok) {
        await loadIngredients()
      }
    } catch (error) {
      console.error('Failed to toggle active:', error)
    }
  }

  const filteredIngredients = ingredients.filter(ing => {
    const matchesCategory = !filterCategory || ing.category === filterCategory
    const matchesSearch = !search || ing.name.toLowerCase().includes(search.toLowerCase())
    return matchesCategory && matchesSearch
  })

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Ingredient Library</h1>
            <p className="text-gray-600">Manage ingredients for menu items</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/menu')}>
              Back to Menu
            </Button>
            <Button onClick={() => { resetForm(); setShowModal(true) }}>
              + Add Ingredient
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <input
            type="text"
            placeholder="Search ingredients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-4 py-2 border rounded-lg"
          />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-4 py-2 border rounded-lg bg-white"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
        </div>

        {/* Ingredients List */}
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading ingredients...</div>
        ) : filteredIngredients.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-gray-500">No ingredients found</p>
            <Button className="mt-4" onClick={() => { resetForm(); setShowModal(true) }}>
              Create your first ingredient
            </Button>
          </Card>
        ) : (
          <div className="grid gap-3">
            {filteredIngredients.map(ingredient => (
              <Card
                key={ingredient.id}
                className={`p-4 ${!ingredient.isActive ? 'opacity-60 bg-gray-50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-lg">{ingredient.name}</span>
                      {ingredient.category && (
                        <span className="px-2 py-0.5 bg-gray-200 rounded text-xs uppercase">
                          {ingredient.category}
                        </span>
                      )}
                      {!ingredient.isActive && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 mt-2 text-sm text-gray-600">
                      <span className="flex items-center gap-1">
                        <span className={ingredient.allowNo ? 'text-green-600' : 'text-gray-400'}>
                          {ingredient.allowNo ? '✓' : '✗'}
                        </span>
                        No
                      </span>
                      <span className="flex items-center gap-1">
                        <span className={ingredient.allowLite ? 'text-green-600' : 'text-gray-400'}>
                          {ingredient.allowLite ? '✓' : '✗'}
                        </span>
                        Lite
                      </span>
                      <span className="flex items-center gap-1">
                        <span className={ingredient.allowOnSide ? 'text-green-600' : 'text-gray-400'}>
                          {ingredient.allowOnSide ? '✓' : '✗'}
                        </span>
                        Side
                      </span>
                      <span className="flex items-center gap-1">
                        <span className={ingredient.allowExtra ? 'text-green-600' : 'text-gray-400'}>
                          {ingredient.allowExtra ? '✓' : '✗'}
                        </span>
                        Extra
                        {ingredient.allowExtra && ingredient.extraPrice > 0 && (
                          <span className="text-green-700 ml-1">
                            (+{formatCurrency(ingredient.extraPrice)})
                          </span>
                        )}
                      </span>
                      {ingredient.allowSwap && (
                        <span className="flex items-center gap-1 text-blue-600">
                          ↔ Swap
                          {ingredient.swapModifierGroup && (
                            <span className="text-gray-500">
                              → {ingredient.swapModifierGroup.name}
                            </span>
                          )}
                          {ingredient.swapUpcharge > 0 && (
                            <span className="text-green-700">
                              (+{formatCurrency(ingredient.swapUpcharge)})
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive(ingredient)}
                    >
                      {ingredient.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(ingredient)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleDelete(ingredient)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold">
                {editingIngredient ? 'Edit Ingredient' : 'Add Ingredient'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                  placeholder="e.g., Lettuce, Tomato, Bacon"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg bg-white"
                >
                  <option value="">Select category...</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              {/* Modification Options */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Modification Options
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={formData.allowNo}
                      onChange={(e) => setFormData({ ...formData, allowNo: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span>Allow "No" (remove)</span>
                  </label>
                  <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={formData.allowLite}
                      onChange={(e) => setFormData({ ...formData, allowLite: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span>Allow "Lite" (less)</span>
                  </label>
                  <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={formData.allowOnSide}
                      onChange={(e) => setFormData({ ...formData, allowOnSide: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span>Allow "On Side"</span>
                  </label>
                  <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={formData.allowExtra}
                      onChange={(e) => setFormData({ ...formData, allowExtra: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span>Allow "Extra" (more)</span>
                  </label>
                </div>
              </div>

              {/* Extra Price */}
              {formData.allowExtra && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Extra Price (upcharge for "Extra")
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.extraPrice}
                      onChange={(e) => setFormData({ ...formData, extraPrice: e.target.value })}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}

              {/* Swap Option */}
              <div className="border-t pt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.allowSwap}
                    onChange={(e) => setFormData({ ...formData, allowSwap: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="font-medium">Enable Swap</span>
                </label>
                <p className="text-sm text-gray-500 mt-1 ml-6">
                  Allow customers to replace this with an item from a modifier group
                </p>

                {formData.allowSwap && (
                  <div className="mt-4 space-y-4 ml-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Swap From Modifier Group *
                      </label>
                      <select
                        value={formData.swapModifierGroupId}
                        onChange={(e) => setFormData({ ...formData, swapModifierGroupId: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg bg-white"
                        required={formData.allowSwap}
                      >
                        <option value="">Select a modifier group...</option>
                        {modifierGroups.map(group => (
                          <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Swap Upcharge (base)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-gray-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.swapUpcharge}
                          onChange={(e) => setFormData({ ...formData, swapUpcharge: e.target.value })}
                          className="w-full pl-7 pr-3 py-2 border rounded-lg"
                          placeholder="0.00"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Added to modifier price when swapping
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Active */}
              <div className="border-t pt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="font-medium">Active</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => { setShowModal(false); resetForm() }}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingIngredient ? 'Save Changes' : 'Create Ingredient'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
