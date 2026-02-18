'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'

interface TaxRule {
  id: string
  name: string
  rate: number
  ratePercent: number
  appliesTo: string
  categoryIds?: string[]
  itemIds?: string[]
  isInclusive: boolean
  priority: number
  isCompounded: boolean
  isActive: boolean
}

interface Category {
  id: string
  name: string
}

export default function TaxRulesPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  const crud = useAdminCRUD<TaxRule>({
    apiBase: '/api/tax-rules',
    locationId: employee?.location?.id,
    resourceName: 'tax rule',
    parseResponse: (data) => data.taxRules || [],
  })

  const {
    items: taxRules,
    isLoading,
    showModal,
    editingItem: editingRule,
    isSaving,
    modalError,
    loadItems,
    openAddModal,
    openEditModal,
    closeModal,
    handleSave,
    handleDelete,
  } = crud

  const [categories, setCategories] = useState<Category[]>([])
  const [formData, setFormData] = useState({
    name: '',
    ratePercent: 0,
    appliesTo: 'all',
    categoryIds: [] as string[],
    isInclusive: false,
    priority: 0,
    isCompounded: false,
  })

  const loadCategories = useCallback(async () => {
    if (!employee?.location?.id) return
    try {
      const res = await fetch(`/api/menu?locationId=${employee.location.id}`)
      if (res.ok) {
        const data = await res.json()
        setCategories(data.categories || [])
      }
    } catch (error) {
      console.error('Failed to load categories:', error)
    }
  }, [employee?.location?.id])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/tax-rules')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (employee?.location?.id) {
      loadItems()
      loadCategories()
    }
  }, [employee?.location?.id, loadItems, loadCategories])

  const handleEdit = (rule: TaxRule) => {
    setFormData({
      name: rule.name,
      ratePercent: rule.ratePercent,
      appliesTo: rule.appliesTo,
      categoryIds: (rule.categoryIds as string[]) || [],
      isInclusive: rule.isInclusive,
      priority: rule.priority,
      isCompounded: rule.isCompounded,
    })
    openEditModal(rule)
  }

  const handleSubmitForm = async () => {
    if (!employee?.location?.id || !formData.name) return

    const payload = {
      locationId: employee.location.id,
      name: formData.name,
      rate: formData.ratePercent,
      appliesTo: formData.appliesTo,
      categoryIds: formData.appliesTo === 'category' ? formData.categoryIds : null,
      isInclusive: formData.isInclusive,
      priority: formData.priority,
      isCompounded: formData.isCompounded,
    }

    const ok = await handleSave(payload)
    if (ok) resetForm()
  }

  const handleToggleActive = async (rule: TaxRule) => {
    try {
      await fetch(`/api/tax-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rule.isActive }),
      })
      loadItems()
    } catch (error) {
      console.error('Failed to toggle rule:', error)
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      ratePercent: 0,
      appliesTo: 'all',
      categoryIds: [],
      isInclusive: false,
      priority: 0,
      isCompounded: false,
    })
  }

  if (!isAuthenticated) return null

  return (
    <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tax Rules</h1>
            <p className="text-gray-600">Configure multiple tax rates for different items</p>
          </div>
          <Button onClick={() => {
            resetForm()
            openAddModal()
          }}>
            Add Tax Rule
          </Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{taxRules.length}</p>
              <p className="text-sm text-gray-600">Total Rules</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">
                {taxRules.filter(r => r.isActive).length}
              </p>
              <p className="text-sm text-gray-600">Active Rules</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">
                {taxRules.filter(r => r.isActive && r.appliesTo === 'all')
                  .reduce((sum, r) => sum + r.ratePercent, 0).toFixed(2)}%
              </p>
              <p className="text-sm text-gray-600">Default Rate</p>
            </CardContent>
          </Card>
        </div>

        {/* Tax Rules List */}
        <Card>
          <CardHeader>
            <CardTitle>Tax Rules</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-gray-500">Loading...</p>
            ) : taxRules.length === 0 ? (
              <p className="text-gray-500">No tax rules configured</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Name</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Rate</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Applies To</th>
                      <th className="text-center p-3 text-sm font-medium text-gray-600">Priority</th>
                      <th className="text-center p-3 text-sm font-medium text-gray-600">Compounded</th>
                      <th className="text-center p-3 text-sm font-medium text-gray-600">Status</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {taxRules.map(rule => (
                      <tr key={rule.id}>
                        <td className="p-3 font-medium">{rule.name}</td>
                        <td className="p-3 text-right">{rule.ratePercent.toFixed(2)}%</td>
                        <td className="p-3">
                          <span className="capitalize">{rule.appliesTo}</span>
                          {rule.appliesTo === 'category' && rule.categoryIds && (
                            <span className="text-sm text-gray-500 ml-1">
                              ({(rule.categoryIds as string[]).length} categories)
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">{rule.priority}</td>
                        <td className="p-3 text-center">
                          {rule.isCompounded ? '✓' : '-'}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleToggleActive(rule)}
                            className={`px-2 py-1 rounded text-xs ${
                              rule.isActive
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {rule.isActive ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(rule)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(rule.id, 'Delete this tax rule?')}
                            className="text-red-600"
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>{editingRule ? 'Edit Tax Rule' : 'Add Tax Rule'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {modalError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                    {modalError}
                  </div>
                )}
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="State Sales Tax"
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.ratePercent}
                    onChange={(e) => setFormData({ ...formData, ratePercent: parseFloat(e.target.value) })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Applies To</label>
                  <select
                    value={formData.appliesTo}
                    onChange={(e) => setFormData({ ...formData, appliesTo: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="all">All Items</option>
                    <option value="category">Specific Categories</option>
                    <option value="item">Specific Items</option>
                  </select>
                </div>

                {formData.appliesTo === 'category' && (
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Categories</label>
                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded p-2">
                      {categories.map(cat => (
                        <label key={cat.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={formData.categoryIds.includes(cat.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({
                                  ...formData,
                                  categoryIds: [...formData.categoryIds, cat.id],
                                })
                              } else {
                                setFormData({
                                  ...formData,
                                  categoryIds: formData.categoryIds.filter(id => id !== cat.id),
                                })
                              }
                            }}
                          />
                          {cat.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Priority</label>
                    <input
                      type="number"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                      className="w-full border rounded px-3 py-2"
                    />
                    <p className="text-xs text-gray-400 mt-1">Lower = applied first</p>
                  </div>
                  <div className="space-y-2 pt-6">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={formData.isCompounded}
                        onChange={(e) => setFormData({ ...formData, isCompounded: e.target.checked })}
                      />
                      Compounded (tax on tax)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={formData.isInclusive}
                        onChange={(e) => setFormData({ ...formData, isInclusive: e.target.checked })}
                      />
                      Tax-inclusive pricing
                    </label>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      closeModal()
                      resetForm()
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSubmitForm} className="flex-1" disabled={isSaving}>
                    {isSaving ? 'Saving...' : editingRule ? 'Save Changes' : 'Add Rule'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
