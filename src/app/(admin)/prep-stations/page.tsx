'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'

interface PrepStation {
  id: string
  name: string
  displayName: string | null
  color: string | null
  stationType: string
  sortOrder: number
  isActive: boolean
  showAllItems: boolean
  autoComplete: number | null
  categoryCount: number
  itemCount: number
}

interface Category {
  id: string
  name: string
  color: string | null
}

interface MenuItem {
  id: string
  name: string
  categoryId: string
}

const STATION_TYPES = [
  { value: 'kitchen', label: 'Kitchen', color: 'bg-orange-100 text-orange-700' },
  { value: 'bar', label: 'Bar', color: 'bg-blue-100 text-blue-700' },
  { value: 'expo', label: 'Expo', color: 'bg-purple-100 text-purple-700' },
  { value: 'prep', label: 'Prep', color: 'bg-green-100 text-green-700' },
]

const COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E',
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#EC4899', '#F43F5E',
]

export default function PrepStationsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  const crud = useAdminCRUD<PrepStation>({
    apiBase: '/api/prep-stations',
    locationId: employee?.location?.id,
    resourceName: 'station',
    parseResponse: (data) => data.stations || [],
  })

  const {
    items: stations,
    isLoading,
    showModal,
    editingItem: editingStation,
    isSaving,
    modalError,
    loadItems,
    openAddModal: crudOpenAddModal,
    openEditModal: crudOpenEditModal,
    closeModal,
    handleSave: crudHandleSave,
    handleDelete: crudHandleDelete,
  } = crud

  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assigningStation, setAssigningStation] = useState<PrepStation | null>(null)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedItems, setSelectedItems] = useState<string[]>([])

  // Form state
  const [formName, setFormName] = useState('')
  const [formDisplayName, setFormDisplayName] = useState('')
  const [formColor, setFormColor] = useState('#3B82F6')
  const [formType, setFormType] = useState('kitchen')
  const [formShowAllItems, setFormShowAllItems] = useState(false)
  const [formAutoComplete, setFormAutoComplete] = useState<number | ''>('')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/prep-stations')
      return
    }
  }, [isAuthenticated, router])

  const loadMenuData = useCallback(async () => {
    if (!employee?.location?.id) return
    try {
      const menuRes = await fetch(`/api/menu?locationId=${employee.location.id}`)
      if (menuRes.ok) {
        const data = await menuRes.json()
        setCategories(data.categories || [])
        const items: MenuItem[] = []
        data.categories?.forEach((cat: { id: string; items: { id: string; name: string }[] }) => {
          cat.items?.forEach((item: { id: string; name: string }) => {
            items.push({ id: item.id, name: item.name, categoryId: cat.id })
          })
        })
        setMenuItems(items)
      }
    } catch (error) {
      console.error('Failed to load menu data:', error)
    }
  }, [employee?.location?.id])

  useEffect(() => {
    if (employee?.location?.id) {
      loadItems()
      loadMenuData()
    }
  }, [employee?.location?.id, loadItems, loadMenuData])

  const resetForm = () => {
    setFormName('')
    setFormDisplayName('')
    setFormColor('#3B82F6')
    setFormType('kitchen')
    setFormShowAllItems(false)
    setFormAutoComplete('')
  }

  const openAddModal = () => {
    resetForm()
    crudOpenAddModal()
  }

  const openEditModal = (station: PrepStation) => {
    setFormName(station.name)
    setFormDisplayName(station.displayName || '')
    setFormColor(station.color || '#3B82F6')
    setFormType(station.stationType)
    setFormShowAllItems(station.showAllItems)
    setFormAutoComplete(station.autoComplete || '')
    crudOpenEditModal(station)
  }

  const handleSave = async () => {
    if (!employee?.location?.id || !formName.trim()) return

    const payload = {
      locationId: employee.location.id,
      name: formName.trim(),
      displayName: formDisplayName.trim() || null,
      color: formColor,
      stationType: formType,
      showAllItems: formShowAllItems,
      autoComplete: formAutoComplete ? Number(formAutoComplete) : null,
    }

    const ok = await crudHandleSave(payload)
    if (ok) resetForm()
  }

  const handleDelete = (station: PrepStation) => {
    crudHandleDelete(station.id, `Delete "${station.name}"? This will remove all category and item assignments.`)
  }

  const openAssignModal = async (station: PrepStation) => {
    setAssigningStation(station)
    try {
      const response = await fetch(`/api/prep-stations/${station.id}`)
      if (response.ok) {
        const data = await response.json()
        setSelectedCategories(data.categories?.map((c: { id: string }) => c.id) || [])
        setSelectedItems(data.menuItems?.map((i: { id: string }) => i.id) || [])
      }
    } catch (error) {
      console.error('Failed to load assignments:', error)
    }
    setShowAssignModal(true)
  }

  const handleSaveAssignments = async () => {
    if (!assigningStation) return

    try {
      const response = await fetch(`/api/prep-stations/${assigningStation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryIds: selectedCategories,
          menuItemIds: selectedItems,
        }),
      })

      if (response.ok) {
        setShowAssignModal(false)
        setAssigningStation(null)
        loadItems()
      }
    } catch (error) {
      console.error('Failed to save assignments:', error)
    }
  }

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  const toggleItem = (itemId: string) => {
    setSelectedItems(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    )
  }

  if (!isAuthenticated) return null

  const getTypeStyle = (type: string) => {
    return STATION_TYPES.find(t => t.value === type)?.color || 'bg-gray-100 text-gray-700'
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push('/orders')}>
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to POS
          </Button>
          <h1 className="text-2xl font-bold">Prep Stations / KDS Routing</h1>
        </div>
        <Button variant="primary" onClick={openAddModal}>
          + Add Station
        </Button>
      </header>

      <div className="p-6 max-w-6xl mx-auto">
        {/* Info Card */}
        <Card className="mb-6 bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <svg className="w-6 h-6 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-medium text-blue-900">How Prep Stations Work</p>
                <p className="text-sm text-blue-700 mt-1">
                  Create stations for each kitchen area (Kitchen, Bar, Expo, etc.).
                  Assign categories or individual items to each station. When orders are sent to kitchen,
                  items will route to their assigned station's KDS screen.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stations Grid */}
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading stations...</div>
        ) : stations.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No Prep Stations</h3>
              <p className="text-gray-500 mb-4">Create your first prep station to start routing items to kitchen displays.</p>
              <Button variant="primary" onClick={openAddModal}>Create Station</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stations.map(station => (
              <Card key={station.id} className="overflow-hidden">
                <div
                  className="h-2"
                  style={{ backgroundColor: station.color || '#3B82F6' }}
                />
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{station.displayName || station.name}</CardTitle>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getTypeStyle(station.stationType)}`}>
                        {STATION_TYPES.find(t => t.value === station.stationType)?.label || station.stationType}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="p-1.5 hover:bg-gray-100 rounded"
                        onClick={() => openEditModal(station)}
                        title="Edit"
                      >
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        className="p-1.5 hover:bg-red-50 rounded"
                        onClick={() => handleDelete(station)}
                        title="Delete"
                      >
                        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Categories assigned:</span>
                      <span className="font-medium">{station.categoryCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Item overrides:</span>
                      <span className="font-medium">{station.itemCount}</span>
                    </div>
                    {station.showAllItems && (
                      <div className="text-purple-600 text-xs">
                        Shows all items (Expo mode)
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-4"
                    onClick={() => openAssignModal(station)}
                  >
                    Assign Categories & Items
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => { closeModal(); resetForm() }} title={editingStation ? 'Edit Station' : 'Add Prep Station'} size="md">
            <div className="space-y-4">
              {modalError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {modalError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Kitchen, Bar, Grill"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input
                  type="text"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional display name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Station Type</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {STATION_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(color => (
                    <button
                      key={color}
                      className={`w-8 h-8 rounded-full border-2 ${formColor === color ? 'border-gray-900' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setFormColor(color)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="showAllItems"
                  checked={formShowAllItems}
                  onChange={(e) => setFormShowAllItems(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="showAllItems" className="text-sm">
                  Show all items (Expo mode)
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Auto-complete after (seconds)
                </label>
                <input
                  type="number"
                  value={formAutoComplete}
                  onChange={(e) => setFormAutoComplete(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Leave empty for manual completion"
                  min={0}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <Button variant="outline" className="flex-1" onClick={() => { closeModal(); resetForm() }}>
                  Cancel
                </Button>
                <Button variant="primary" className="flex-1" onClick={handleSave} disabled={!formName.trim() || isSaving}>
                  {isSaving ? 'Saving...' : editingStation ? 'Update' : 'Create'}
                </Button>
              </div>
            </div>
      </Modal>

      {/* Assign Modal */}
      <Modal isOpen={showAssignModal && !!assigningStation} onClose={() => { setShowAssignModal(false); setAssigningStation(null) }} title={assigningStation ? `Assign to ${assigningStation.displayName || assigningStation.name}` : 'Assign'} size="2xl">
        {assigningStation && (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Select which categories and items should route to this station
            </p>
            <div>
              {/* Categories */}
              <div className="mb-6">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Categories
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  All items in selected categories will route to this station
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        selectedCategories.includes(cat.id)
                          ? 'bg-blue-50 border-blue-500'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => toggleCategory(cat.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: cat.color || '#gray' }}
                        />
                        <span className={selectedCategories.includes(cat.id) ? 'font-medium' : ''}>
                          {cat.name}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Item Overrides */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Individual Items (Overrides)
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  Override category assignment for specific items
                </p>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {menuItems.map(item => {
                    const category = categories.find(c => c.id === item.categoryId)
                    return (
                      <button
                        key={item.id}
                        className={`p-2 rounded-lg border text-left text-sm transition-colors ${
                          selectedItems.includes(item.id)
                            ? 'bg-purple-50 border-purple-500'
                            : 'bg-white border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => toggleItem(item.id)}
                      >
                        <div className={selectedItems.includes(item.id) ? 'font-medium' : ''}>
                          {item.name}
                        </div>
                        <div className="text-xs text-gray-400">{category?.name}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowAssignModal(false)
                  setAssigningStation(null)
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" className="flex-1" onClick={handleSaveAssignments}>
                Save Assignments
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
