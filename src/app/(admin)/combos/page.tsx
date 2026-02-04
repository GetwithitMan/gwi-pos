'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, menuSubNav } from '@/components/admin/AdminSubNav'

interface Modifier {
  id: string
  name: string
  price: number
  childModifierGroupId?: string | null
}

interface ModifierGroup {
  id: string
  name: string
  displayName?: string | null
  minSelections: number
  maxSelections: number
  isRequired: boolean
  modifiers: Modifier[]
}

interface MenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  categoryName?: string
  modifierGroups?: {
    modifierGroup: ModifierGroup
  }[]
}

interface ComboComponent {
  id?: string
  slotName: string
  displayName: string
  sortOrder: number
  isRequired: boolean
  menuItemId?: string | null
  menuItem?: MenuItem | null
  itemPriceOverride?: number | null
  modifierPriceOverrides?: Record<string, number> | null
}

interface ComboTemplate {
  id: string
  basePrice: number
  comparePrice?: number | null
  components: ComboComponent[]
}

interface Combo {
  id: string
  name: string
  displayName?: string
  description?: string
  price: number
  categoryId: string
  categoryName: string
  isActive: boolean
  isAvailable: boolean
  template: ComboTemplate | null
}

interface Category {
  id: string
  name: string
  items?: MenuItem[]
}

export default function CombosPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [combos, setCombos] = useState<Combo[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingCombo, setEditingCombo] = useState<Combo | null>(null)
  const [expandedCombo, setExpandedCombo] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    description: '',
    price: '',
    comparePrice: '',
    categoryId: '',
    isActive: true,
    components: [] as ComboComponent[],
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/combos')
      return
    }
    loadData()
  }, [isAuthenticated, router])

  const loadData = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const [combosRes, menuRes] = await Promise.all([
        fetch(`/api/combos?locationId=${employee.location.id}`),
        fetch(`/api/menu?locationId=${employee.location.id}`),
      ])

      if (combosRes.ok) {
        const data = await combosRes.json()
        setCombos(data.combos)
      }

      if (menuRes.ok) {
        const data = await menuRes.json()
        setCategories(data.categories)
        // Items are returned separately, add category name
        const categoryMap = Object.fromEntries(
          data.categories.map((c: Category) => [c.id, c.name])
        )
        const allItems: MenuItem[] = (data.items || []).map((item: MenuItem) => ({
          ...item,
          categoryName: categoryMap[item.categoryId] || 'Unknown',
        }))
        setMenuItems(allItems)
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Load modifier groups for a specific menu item
  const loadItemModifiers = async (itemId: string): Promise<ModifierGroup[]> => {
    try {
      const res = await fetch(`/api/menu/items/${itemId}/modifiers`)
      if (res.ok) {
        const data = await res.json()
        return data.modifierGroups || []
      }
    } catch (error) {
      console.error('Failed to load item modifiers:', error)
    }
    return []
  }

  const handleOpenModal = (combo?: Combo) => {
    if (combo) {
      setEditingCombo(combo)
      setFormData({
        name: combo.name,
        displayName: combo.displayName || '',
        description: combo.description || '',
        price: combo.price.toString(),
        comparePrice: combo.template?.comparePrice?.toString() || '',
        categoryId: combo.categoryId,
        isActive: combo.isActive,
        components: combo.template?.components || [],
      })
    } else {
      setEditingCombo(null)
      setFormData({
        name: '',
        displayName: '',
        description: '',
        price: '',
        comparePrice: '',
        categoryId: categories[0]?.id || '',
        isActive: true,
        components: [],
      })
    }
    setShowModal(true)
  }

  const handleAddComponent = () => {
    setFormData(prev => ({
      ...prev,
      components: [
        ...prev.components,
        {
          slotName: `slot_${prev.components.length + 1}`,
          displayName: `Item ${prev.components.length + 1}`,
          sortOrder: prev.components.length,
          isRequired: true,
          menuItemId: null,
          menuItem: null,
          itemPriceOverride: null,
          modifierPriceOverrides: null,
        },
      ],
    }))
  }

  const handleRemoveComponent = (index: number) => {
    setFormData(prev => ({
      ...prev,
      components: prev.components.filter((_, i) => i !== index),
    }))
  }

  const handleUpdateComponent = (index: number, updates: Partial<ComboComponent>) => {
    setFormData(prev => ({
      ...prev,
      components: prev.components.map((c, i) =>
        i === index ? { ...c, ...updates } : c
      ),
    }))
  }

  const handleSelectMenuItem = async (compIdx: number, itemId: string) => {
    const item = menuItems.find(i => i.id === itemId)
    if (!item) {
      handleUpdateComponent(compIdx, {
        menuItemId: null,
        menuItem: null,
        displayName: formData.components[compIdx].displayName,
        modifierPriceOverrides: null,
      })
      return
    }

    // Load this item's modifier groups
    const modGroups = await loadItemModifiers(itemId)

    handleUpdateComponent(compIdx, {
      menuItemId: itemId,
      menuItem: {
        ...item,
        modifierGroups: modGroups.map(g => ({ modifierGroup: g })),
      },
      displayName: item.name,
      modifierPriceOverrides: null, // Reset price overrides when item changes
    })
  }

  const handleModifierPriceOverride = (compIdx: number, modifierId: string, price: number | null) => {
    const comp = formData.components[compIdx]
    const currentOverrides = comp.modifierPriceOverrides || {}

    let newOverrides: Record<string, number> | null
    if (price === null) {
      // Remove this override
      const { [modifierId]: _, ...rest } = currentOverrides
      newOverrides = Object.keys(rest).length > 0 ? rest : null
    } else {
      newOverrides = { ...currentOverrides, [modifierId]: price }
    }

    handleUpdateComponent(compIdx, { modifierPriceOverrides: newOverrides })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee?.location?.id) return

    try {
      const payload = {
        locationId: employee.location.id,
        name: formData.name,
        displayName: formData.displayName || undefined,
        description: formData.description || undefined,
        price: parseFloat(formData.price),
        comparePrice: formData.comparePrice ? parseFloat(formData.comparePrice) : undefined,
        categoryId: formData.categoryId,
        isActive: formData.isActive,
        components: formData.components.map(c => ({
          slotName: c.slotName,
          displayName: c.displayName,
          sortOrder: c.sortOrder,
          isRequired: c.isRequired,
          menuItemId: c.menuItemId || undefined,
          itemPriceOverride: c.itemPriceOverride ?? undefined,
          modifierPriceOverrides: c.modifierPriceOverrides || undefined,
        })),
      }

      const res = await fetch(
        editingCombo ? `/api/combos/${editingCombo.id}` : '/api/combos',
        {
          method: editingCombo ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )

      if (res.ok) {
        setShowModal(false)
        loadData()
      }
    } catch (error) {
      console.error('Failed to save combo:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this combo?')) return

    try {
      const res = await fetch(`/api/combos/${id}`, { method: 'DELETE' })
      if (res.ok) {
        loadData()
      }
    } catch (error) {
      console.error('Failed to delete combo:', error)
    }
  }

  const handleToggleActive = async (combo: Combo) => {
    try {
      const res = await fetch(`/api/combos/${combo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !combo.isActive }),
      })
      if (res.ok) {
        loadData()
      }
    } catch (error) {
      console.error('Failed to toggle combo:', error)
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Combo Meals"
        subtitle="Bundle menu items with their modifiers"
        breadcrumbs={[{ label: 'Menu', href: '/menu' }]}
        actions={<Button onClick={() => handleOpenModal()}>+ New Combo</Button>}
      />
      <AdminSubNav items={menuSubNav} basePath="/menu" />

      <div className="max-w-7xl mx-auto mt-6">

        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : combos.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500 mb-4">No combo meals created yet</p>
              <Button onClick={() => handleOpenModal()}>Create Your First Combo</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {combos.map(combo => (
              <Card key={combo.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg">{combo.name}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          combo.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {combo.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{combo.categoryName}</p>
                      {combo.description && (
                        <p className="text-sm text-gray-500 mt-1">{combo.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2">
                        <span className="text-lg font-bold text-green-600">
                          {formatCurrency(combo.price)}
                        </span>
                        {combo.template?.comparePrice && (
                          <span className="text-sm text-gray-400 line-through">
                            {formatCurrency(combo.template.comparePrice)}
                          </span>
                        )}
                        <span className="text-sm text-gray-500">
                          {combo.template?.components.length || 0} items
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedCombo(expandedCombo === combo.id ? null : combo.id)}
                      >
                        {expandedCombo === combo.id ? 'Hide' : 'Details'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(combo)}
                      >
                        {combo.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleOpenModal(combo)}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(combo.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedCombo === combo.id && combo.template && (
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="font-medium mb-2">Included Items:</h4>
                      <div className="space-y-3">
                        {combo.template.components.map((comp, idx) => (
                          <div key={comp.id || idx} className="bg-gray-50 rounded p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium">{comp.displayName}</span>
                              <div className="flex items-center gap-2">
                                {comp.itemPriceOverride !== null && comp.itemPriceOverride !== undefined && (
                                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                    Price: {formatCurrency(comp.itemPriceOverride)}
                                  </span>
                                )}
                                <span className="text-xs text-gray-500">
                                  {comp.isRequired ? 'Required' : 'Optional'}
                                </span>
                              </div>
                            </div>
                            {comp.menuItem ? (
                              <div>
                                <p className="text-sm text-blue-600 mb-2">
                                  Item: {comp.menuItem.name} ({formatCurrency(comp.menuItem.price)})
                                </p>
                                {comp.menuItem.modifierGroups && comp.menuItem.modifierGroups.length > 0 && (
                                  <div className="ml-4 mt-2 space-y-2">
                                    {comp.menuItem.modifierGroups.map(mg => (
                                      <div key={mg.modifierGroup.id} className="text-sm">
                                        <span className="text-gray-600">{mg.modifierGroup.name}:</span>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {mg.modifierGroup.modifiers.map(mod => {
                                            const override = comp.modifierPriceOverrides?.[mod.id]
                                            return (
                                              <span
                                                key={mod.id}
                                                className="bg-white border rounded px-2 py-0.5 text-xs"
                                              >
                                                {mod.name}
                                                {override !== undefined ? (
                                                  <span className="text-blue-600 ml-1">
                                                    {formatCurrency(override)}
                                                  </span>
                                                ) : mod.price > 0 ? (
                                                  <span className="text-green-600 ml-1">
                                                    +{formatCurrency(mod.price)}
                                                  </span>
                                                ) : null}
                                              </span>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 italic">No item selected</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold">
                {editingCombo ? 'Edit Combo' : 'New Combo'}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Combo Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full border rounded px-3 py-2"
                    placeholder="e.g., Taco Combo"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Display Name</label>
                  <input
                    type="text"
                    value={formData.displayName}
                    onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category *</label>
                  <select
                    value={formData.categoryId}
                    onChange={(e) => setFormData(prev => ({ ...prev, categoryId: e.target.value }))}
                    className="w-full border rounded px-3 py-2"
                    required
                  >
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Combo Price *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                    className="w-full border rounded px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Compare Price (A la carte total)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.comparePrice}
                    onChange={(e) => setFormData(prev => ({ ...prev, comparePrice: e.target.value }))}
                    className="w-full border rounded px-3 py-2"
                    placeholder="Shows savings vs ordering separately"
                  />
                </div>
                <div className="flex items-center">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                    />
                    <span>Active</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>

              {/* Combo Items */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium">Combo Items</h3>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddComponent}>
                    + Add Item
                  </Button>
                </div>

                {formData.components.length === 0 ? (
                  <p className="text-gray-500 text-center py-4 bg-gray-50 rounded">
                    Add items to include in this combo
                  </p>
                ) : (
                  <div className="space-y-4">
                    {formData.components.map((comp, compIdx) => (
                      <div key={compIdx} className="border rounded p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1 mr-4">
                            <label className="text-xs text-gray-500 block mb-1">Select Menu Item</label>
                            <select
                              value={comp.menuItemId || ''}
                              onChange={(e) => handleSelectMenuItem(compIdx, e.target.value)}
                              className="w-full border rounded px-2 py-2"
                            >
                              <option value="">-- Select an Item --</option>
                              {categories.map(cat => (
                                <optgroup key={cat.id} label={cat.name}>
                                  {menuItems
                                    .filter(item => item.categoryId === cat.id && item.id !== editingCombo?.id)
                                    .map(item => (
                                      <option key={item.id} value={item.id}>
                                        {item.name} ({formatCurrency(item.price)})
                                      </option>
                                    ))}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveComponent(compIdx)}
                          >
                            Remove
                          </Button>
                        </div>

                        {/* Display name override */}
                        <div className="grid grid-cols-2 gap-4 mb-3">
                          <div>
                            <label className="text-xs text-gray-500">Display Name</label>
                            <input
                              type="text"
                              value={comp.displayName}
                              onChange={(e) => handleUpdateComponent(compIdx, { displayName: e.target.value })}
                              className="w-full border rounded px-2 py-1 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Item Price Override</label>
                            <input
                              type="number"
                              step="0.01"
                              value={comp.itemPriceOverride ?? ''}
                              onChange={(e) => handleUpdateComponent(compIdx, {
                                itemPriceOverride: e.target.value ? parseFloat(e.target.value) : null
                              })}
                              className="w-full border rounded px-2 py-1 text-sm"
                              placeholder={comp.menuItem ? `Default: ${formatCurrency(comp.menuItem.price)}` : 'Select item first'}
                            />
                          </div>
                        </div>

                        {/* Show item's modifier groups */}
                        {comp.menuItem?.modifierGroups && comp.menuItem.modifierGroups.length > 0 && (
                          <div className="bg-blue-50 rounded p-3">
                            <p className="text-xs text-blue-700 font-medium mb-2">
                              Modifiers for {comp.menuItem.name}:
                            </p>
                            {comp.menuItem.modifierGroups.map(mg => (
                              <div key={mg.modifierGroup.id} className="mb-3 last:mb-0">
                                <p className="text-xs text-gray-600 mb-1">
                                  {mg.modifierGroup.name}
                                  {mg.modifierGroup.isRequired && <span className="text-red-500 ml-1">*</span>}
                                </p>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                  {mg.modifierGroup.modifiers.map(mod => {
                                    const currentOverride = comp.modifierPriceOverrides?.[mod.id]
                                    return (
                                      <div key={mod.id} className="bg-white border rounded p-2">
                                        <div className="flex justify-between items-center text-sm">
                                          <span>{mod.name}</span>
                                          <span className="text-gray-400">
                                            {formatCurrency(mod.price)}
                                          </span>
                                        </div>
                                        <div className="mt-1">
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={currentOverride ?? ''}
                                            onChange={(e) => handleModifierPriceOverride(
                                              compIdx,
                                              mod.id,
                                              e.target.value ? parseFloat(e.target.value) : null
                                            )}
                                            className="w-full border rounded px-2 py-1 text-xs"
                                            placeholder="Override price"
                                          />
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {comp.menuItemId && !comp.menuItem?.modifierGroups?.length && (
                          <p className="text-sm text-gray-400 italic bg-gray-50 rounded p-2">
                            This item has no modifier groups
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingCombo ? 'Update Combo' : 'Create Combo'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
