'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Virtuoso } from 'react-virtuoso'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, inventorySubNav } from '@/components/admin/AdminSubNav'

interface InventoryItem {
  id: string
  name: string
  sku: string | null
  description: string | null
  department: string
  itemType: string
  category: string | null
  subcategory: string | null
  brand: string | null
  purchaseUnit: string
  purchaseSize: number
  purchaseCost: number
  storageUnit: string
  unitsPerPurchase: number
  costPerUnit: number
  yieldPercent: number | null
  yieldCostPerUnit: number | null
  currentStock: number
  parLevel: number | null
  reorderPoint: number | null
  reorderQty: number | null
  isLowStock: boolean
  isActive: boolean
  trackInventory: boolean
  defaultVendor: { id: string; name: string } | null
  spiritCategory: { id: string; name: string } | null
}

interface Vendor {
  id: string
  name: string
}

const DEPARTMENTS = ['Food', 'Beverage', 'Supplies']
const ITEM_TYPES = ['ingredient', 'bottle', 'paper_goods', 'cleaning', 'smallwares']
const PAGE_SIZE = 100 // Items per page for infinite scroll

// Common units for autocomplete (allows custom values too)
const PURCHASE_UNITS = ['case', 'box', 'bag', 'bottle', 'can', 'carton', 'gallon', 'lb', 'kg', 'each', 'pack', 'pallet']
const STORAGE_UNITS = ['oz', 'lb', 'g', 'kg', 'ml', 'L', 'each', 'slice', 'portion', 'cup', 'tbsp', 'tsp', 'fl oz']

interface Pagination {
  total: number
  limit: number
  skip: number
  hasMore: boolean
  nextCursor: string | null
}

export default function InventoryItemsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [pagination, setPagination] = useState<Pagination | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [activeOnly, setActiveOnly] = useState(true)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [showAdjustModal, setShowAdjustModal] = useState(false)

  // Debounce timer for search
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory/items')
      return
    }
    loadData()
  }, [isAuthenticated, router])

  // Reset and reload when filters change (except search which is debounced)
  useEffect(() => {
    if (employee?.location?.id) {
      loadData()
    }
  }, [departmentFilter, typeFilter, lowStockOnly, activeOnly])

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }
    searchTimerRef.current = setTimeout(() => {
      if (employee?.location?.id) {
        loadData()
      }
    }, 300)

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
    }
  }, [search])

  const buildQueryParams = useCallback((skip = 0) => {
    const params = new URLSearchParams({
      locationId: employee?.location?.id || '',
      limit: String(PAGE_SIZE),
      skip: String(skip),
      activeOnly: String(activeOnly),
    })

    if (search) params.set('search', search)
    if (departmentFilter !== 'all') params.set('department', departmentFilter)
    if (typeFilter !== 'all') params.set('itemType', typeFilter)
    if (lowStockOnly) params.set('lowStockOnly', 'true')

    return params.toString()
  }, [employee?.location?.id, activeOnly, search, departmentFilter, typeFilter, lowStockOnly])

  const loadData = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    setItems([]) // Clear existing items

    try {
      const [itemsRes, vendorsRes] = await Promise.all([
        fetch(`/api/inventory/items?${buildQueryParams(0)}`),
        fetch(`/api/inventory/vendors?locationId=${employee.location.id}`),
      ])

      if (itemsRes.ok) {
        const data = await itemsRes.json()
        setItems(data.items || [])
        setPagination(data.pagination || null)
      }
      if (vendorsRes.ok) {
        const data = await vendorsRes.json()
        setVendors(data.vendors || [])
      }
    } catch (error) {
      console.error('Failed to load inventory items:', error)
      toast.error('Failed to load inventory items')
    } finally {
      setIsLoading(false)
    }
  }

  // Load more items (for infinite scroll)
  const loadMore = useCallback(async () => {
    if (!employee?.location?.id || !pagination?.hasMore || isLoadingMore) return

    setIsLoadingMore(true)
    try {
      const res = await fetch(`/api/inventory/items?${buildQueryParams(items.length)}`)
      if (res.ok) {
        const data = await res.json()
        setItems(prev => [...prev, ...(data.items || [])])
        setPagination(data.pagination || null)
      }
    } catch (error) {
      console.error('Failed to load more items:', error)
    } finally {
      setIsLoadingMore(false)
    }
  }, [employee?.location?.id, pagination?.hasMore, isLoadingMore, items.length, buildQueryParams])

  // Filter is now done server-side, but keep low stock filtering client-side for instant feedback
  const filteredItems = useMemo(() => {
    // Most filtering is server-side now, but we can still do instant client-side filtering
    // for already-loaded items when using lowStockOnly toggle
    return items
  }, [items])

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return
    try {
      const res = await fetch(`/api/inventory/items/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Item deleted')
        if (selectedItem?.id === id) setSelectedItem(null)
        loadData()
      } else {
        toast.error('Failed to delete item')
      }
    } catch (error) {
      console.error('Failed to delete item:', error)
      toast.error('Failed to delete item')
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <AdminPageHeader
        title="Inventory Items"
        subtitle="Manage ingredients, bottles, and supplies"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
        backHref="/inventory"
        actions={
          <Button onClick={() => { setEditingItem(null); setShowModal(true) }}>
            + Add Item
          </Button>
        }
      />
      <AdminSubNav items={inventorySubNav} basePath="/inventory" />

      <div className="flex gap-6 h-[calc(100vh-260px)]">
      {/* Left Sidebar - Item List */}
      <div className="w-80 flex-shrink-0 flex flex-col bg-white rounded-lg shadow overflow-hidden">
        {/* Search and Filters */}
        <div className="p-4 border-b space-y-3">
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="all">All Depts</option>
              {DEPARTMENTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="all">All Types</option>
              {ITEM_TYPES.map(t => (
                <option key={t} value={t}>{t.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={lowStockOnly}
                onChange={(e) => setLowStockOnly(e.target.checked)}
                className="rounded"
              />
              Low Stock Only
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                className="rounded"
              />
              Active Only
            </label>
          </div>
        </div>

        {/* Add Button */}
        <div className="p-3 border-b">
          <Button
            onClick={() => { setEditingItem(null); setShowModal(true) }}
            className="w-full"
          >
            + Add Item
          </Button>
        </div>

        {/* Item List - Virtualized */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="p-4 text-gray-500">Loading...</div>
          ) : filteredItems.length === 0 ? (
            <div className="p-4 text-gray-500">No items found</div>
          ) : (
            <Virtuoso
              style={{ height: '100%' }}
              data={filteredItems}
              endReached={loadMore}
              overscan={200}
              itemContent={(index, item) => (
                <div
                  onClick={() => setSelectedItem(item)}
                  className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${
                    selectedItem?.id === item.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{item.name}</span>
                        {/* Low Stock Badge */}
                        {item.isLowStock && (
                          <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Low Stock" />
                        )}
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        {item.sku && <span>{item.sku}</span>}
                        <span className="text-gray-300">|</span>
                        <span>{item.department}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-sm font-mono ${item.isLowStock ? 'text-red-600 font-semibold' : ''}`}>
                        {item.currentStock.toFixed(1)}
                      </div>
                      <div className="text-xs text-gray-400">{item.storageUnit}</div>
                    </div>
                  </div>
                </div>
              )}
              components={{
                Footer: () => (
                  isLoadingMore ? (
                    <div className="p-3 text-center text-gray-500 text-sm">Loading more...</div>
                  ) : null
                ),
              }}
            />
          )}
        </div>

        {/* Summary Footer */}
        <div className="p-3 border-t bg-gray-50 text-sm text-gray-600">
          {pagination ? (
            <>
              {filteredItems.length} of {pagination.total} items
              {pagination.hasMore && ' (scroll for more)'}
            </>
          ) : (
            <>
              {filteredItems.length} items
              {!lowStockOnly && ` (${filteredItems.filter(i => i.isLowStock).length} low stock)`}
            </>
          )}
        </div>
      </div>

      {/* Right Panel - Item Details */}
      <div className="flex-1 overflow-y-auto">
        {selectedItem ? (
          <ItemDetails
            item={selectedItem}
            onEdit={() => { setEditingItem(selectedItem); setShowModal(true) }}
            onDelete={() => handleDelete(selectedItem.id)}
            onAdjust={() => setShowAdjustModal(true)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Select an item to view details
          </div>
        )}
      </div>

      {/* Item Modal */}
      {showModal && (
        <InventoryItemModal
          item={editingItem}
          vendors={vendors}
          locationId={employee?.location?.id || ''}
          onClose={() => { setShowModal(false); setEditingItem(null) }}
          onSave={() => { setShowModal(false); setEditingItem(null); loadData() }}
        />
      )}

      {/* Adjust Stock Modal */}
      {showAdjustModal && selectedItem && (
        <AdjustStockModal
          item={selectedItem}
          locationId={employee?.location?.id || ''}
          employeeId={employee?.id || ''}
          onClose={() => setShowAdjustModal(false)}
          onSave={() => { setShowAdjustModal(false); loadData() }}
        />
      )}
      </div>
    </div>
  )
}

// Item Details Component
function ItemDetails({
  item,
  onEdit,
  onDelete,
  onAdjust,
}: {
  item: InventoryItem
  onEdit: () => void
  onDelete: () => void
  onAdjust: () => void
}) {
  const effectiveCost = item.yieldCostPerUnit ?? item.costPerUnit

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">{item.name}</h2>
          <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
            {item.sku && <span>SKU: {item.sku}</span>}
            <span className="px-2 py-0.5 rounded bg-gray-100">{item.department}</span>
            <span className="px-2 py-0.5 rounded bg-gray-100">{item.itemType}</span>
            {!item.isActive && (
              <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">Inactive</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onAdjust}>Adjust Stock</Button>
          <Button variant="outline" onClick={onEdit}>Edit</Button>
          <Button variant="danger" onClick={onDelete}>Delete</Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className={`text-2xl font-bold ${item.isLowStock ? 'text-red-600' : ''}`}>
              {item.currentStock.toFixed(1)}
            </p>
            <p className="text-xs text-gray-500">Current Stock ({item.storageUnit})</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{item.parLevel ?? '-'}</p>
            <p className="text-xs text-gray-500">Par Level</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{formatCurrency(effectiveCost)}</p>
            <p className="text-xs text-gray-500">Cost per {item.storageUnit}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{formatCurrency(item.purchaseCost)}</p>
            <p className="text-xs text-gray-500">Cost per {item.purchaseUnit}</p>
          </CardContent>
        </Card>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* Purchase Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Purchase Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Default Vendor</span>
              <span className="font-medium">{item.defaultVendor?.name || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Purchase Unit</span>
              <span className="font-medium">{item.purchaseUnit}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Purchase Size</span>
              <span className="font-medium">{item.purchaseSize}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Cost per Purchase</span>
              <span className="font-medium">{formatCurrency(item.purchaseCost)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Storage Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Storage & Costing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Storage Unit</span>
              <span className="font-medium">{item.storageUnit}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Units per Purchase</span>
              <span className="font-medium">{item.unitsPerPurchase}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Cost per Unit</span>
              <span className="font-medium">{formatCurrency(item.costPerUnit)}</span>
            </div>
            {item.yieldPercent && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">Yield %</span>
                  <span className="font-medium">{item.yieldPercent}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Yield-Adjusted Cost</span>
                  <span className="font-medium text-blue-600">{formatCurrency(item.yieldCostPerUnit || 0)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Inventory Levels */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Inventory Levels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Current Stock</span>
              <span className={`font-medium ${item.isLowStock ? 'text-red-600' : ''}`}>
                {item.currentStock.toFixed(1)} {item.storageUnit}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Par Level</span>
              <span className="font-medium">{item.parLevel ?? '-'} {item.parLevel ? item.storageUnit : ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Reorder Point</span>
              <span className="font-medium">{item.reorderPoint ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Reorder Quantity</span>
              <span className="font-medium">{item.reorderQty ?? '-'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Classification */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Classification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Department</span>
              <span className="font-medium">{item.department}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Item Type</span>
              <span className="font-medium">{item.itemType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Category</span>
              <span className="font-medium">{item.category || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Brand</span>
              <span className="font-medium">{item.brand || '-'}</span>
            </div>
            {item.spiritCategory && (
              <div className="flex justify-between">
                <span className="text-gray-500">Spirit Category</span>
                <span className="font-medium">{item.spiritCategory.name}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {item.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">{item.description}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Inventory Item Modal
function InventoryItemModal({
  item,
  vendors,
  locationId,
  onClose,
  onSave,
}: {
  item: InventoryItem | null
  vendors: Vendor[]
  locationId: string
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState({
    name: item?.name || '',
    sku: item?.sku || '',
    description: item?.description || '',
    department: item?.department || 'Food',
    itemType: item?.itemType || 'ingredient',
    category: item?.category || '',
    subcategory: item?.subcategory || '',
    brand: item?.brand || '',
    purchaseUnit: item?.purchaseUnit || 'case',
    purchaseSize: item?.purchaseSize || 1,
    purchaseCost: item?.purchaseCost || 0,
    storageUnit: item?.storageUnit || 'each',
    unitsPerPurchase: item?.unitsPerPurchase || 1,
    yieldPercent: item?.yieldPercent || null,
    parLevel: item?.parLevel || null,
    reorderPoint: item?.reorderPoint || null,
    reorderQty: item?.reorderQty || null,
    defaultVendorId: item?.defaultVendor?.id || '',
    trackInventory: item?.trackInventory ?? true,
    isActive: item?.isActive ?? true,
  })
  const [isSaving, setIsSaving] = useState(false)

  // Calculate cost per unit in real-time
  const costPerUnit = form.purchaseCost && form.unitsPerPurchase
    ? form.purchaseCost / form.unitsPerPurchase
    : 0

  const yieldCostPerUnit = form.yieldPercent && costPerUnit
    ? costPerUnit / (form.yieldPercent / 100)
    : null

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!form.purchaseCost || form.purchaseCost <= 0) {
      toast.error('Purchase cost must be greater than 0')
      return
    }
    if (!form.unitsPerPurchase || form.unitsPerPurchase <= 0) {
      toast.error('Units per purchase must be greater than 0')
      return
    }

    setIsSaving(true)
    try {
      const url = item
        ? `/api/inventory/items/${item.id}`
        : '/api/inventory/items'
      const method = item ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          locationId,
          yieldPercent: form.yieldPercent || null,
          parLevel: form.parLevel || null,
          reorderPoint: form.reorderPoint || null,
          reorderQty: form.reorderQty || null,
          defaultVendorId: form.defaultVendorId || null,
        }),
      })

      if (res.ok) {
        toast.success(item ? 'Item updated' : 'Item created')
        onSave()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save item')
      }
    } catch (error) {
      console.error('Failed to save item:', error)
      toast.error('Failed to save item')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b sticky top-0 bg-white">
          <h2 className="text-xl font-bold">{item ? 'Edit Item' : 'Add Inventory Item'}</h2>
        </div>

        <div className="p-6 space-y-6">
          {/* Basic Info */}
          <div>
            <h3 className="font-semibold mb-3">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm text-gray-600 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., Ground Beef 80/20"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">SKU</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Brand</label>
                <input
                  type="text"
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-600 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Classification */}
          <div>
            <h3 className="font-semibold mb-3">Classification</h3>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Department *</label>
                <select
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                >
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Item Type *</label>
                <select
                  value={form.itemType}
                  onChange={(e) => setForm({ ...form, itemType: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                >
                  {ITEM_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Category</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., Proteins"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Subcategory</label>
                <input
                  type="text"
                  value={form.subcategory}
                  onChange={(e) => setForm({ ...form, subcategory: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., Beef"
                />
              </div>
            </div>
          </div>

          {/* Purchase Info */}
          <div>
            <h3 className="font-semibold mb-3">Purchase Information</h3>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Default Vendor</label>
                <select
                  value={form.defaultVendorId}
                  onChange={(e) => setForm({ ...form, defaultVendorId: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="">Select vendor...</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Purchase Unit *</label>
                <input
                  type="text"
                  list="purchase-units"
                  value={form.purchaseUnit}
                  onChange={(e) => setForm({ ...form, purchaseUnit: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., case, lb, bottle"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Purchase Size</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.purchaseSize}
                  onChange={(e) => setForm({ ...form, purchaseSize: parseFloat(e.target.value) || 0 })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Purchase Cost *</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.purchaseCost}
                  onChange={(e) => setForm({ ...form, purchaseCost: parseFloat(e.target.value) || 0 })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="$"
                />
              </div>
            </div>
          </div>

          {/* Storage & Costing */}
          <div>
            <h3 className="font-semibold mb-3">Storage & Costing</h3>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Storage Unit *</label>
                <input
                  type="text"
                  list="storage-units"
                  value={form.storageUnit}
                  onChange={(e) => setForm({ ...form, storageUnit: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., oz, each, lb"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Units per Purchase *</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.unitsPerPurchase}
                  onChange={(e) => setForm({ ...form, unitsPerPurchase: parseFloat(e.target.value) || 0 })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="How many storage units per purchase"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Yield %</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="100"
                  value={form.yieldPercent || ''}
                  onChange={(e) => setForm({ ...form, yieldPercent: parseFloat(e.target.value) || null })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., 85 for 85%"
                />
              </div>
              <div>
                {/* Real-time cost calculation */}
                <label className="block text-sm text-gray-600 mb-1">Calculated Cost</label>
                <div className="border rounded px-3 py-2 bg-gray-50">
                  <div className="text-lg font-bold text-blue-600">
                    {formatCurrency(yieldCostPerUnit ?? costPerUnit)}
                  </div>
                  <div className="text-xs text-gray-500">
                    per {form.storageUnit || 'unit'}
                    {yieldCostPerUnit && ' (yield-adjusted)'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Inventory Levels */}
          <div>
            <h3 className="font-semibold mb-3">Inventory Levels</h3>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Par Level</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.parLevel || ''}
                  onChange={(e) => setForm({ ...form, parLevel: parseFloat(e.target.value) || null })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="Min to keep on hand"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Reorder Point</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.reorderPoint || ''}
                  onChange={(e) => setForm({ ...form, reorderPoint: parseFloat(e.target.value) || null })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="When to reorder"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Reorder Quantity</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.reorderQty || ''}
                  onChange={(e) => setForm({ ...form, reorderQty: parseFloat(e.target.value) || null })}
                  className="w-full border rounded px-3 py-2"
                  placeholder="How much to order"
                />
              </div>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.trackInventory}
                    onChange={(e) => setForm({ ...form, trackInventory: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">Track Inventory</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">Active</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 sticky bottom-0">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : item ? 'Save Changes' : 'Create Item'}
          </Button>
        </div>

        {/* Unit autocomplete datalists */}
        <datalist id="purchase-units">
          {PURCHASE_UNITS.map(u => <option key={u} value={u} />)}
        </datalist>
        <datalist id="storage-units">
          {STORAGE_UNITS.map(u => <option key={u} value={u} />)}
        </datalist>
      </div>
    </div>
  )
}

// Adjust Stock Modal
function AdjustStockModal({
  item,
  locationId,
  employeeId,
  onClose,
  onSave,
}: {
  item: InventoryItem
  locationId: string
  employeeId: string
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState({
    type: 'adjustment',
    quantityChange: 0,
    reason: '',
  })
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (form.quantityChange === 0) {
      toast.error('Quantity change cannot be 0')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/inventory/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          inventoryItemId: item.id,
          type: form.type,
          quantityChange: form.quantityChange,
          reason: form.reason,
        }),
      })

      if (res.ok) {
        toast.success('Stock adjusted')
        onSave()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to adjust stock')
      }
    } catch (error) {
      console.error('Failed to adjust stock:', error)
      toast.error('Failed to adjust stock')
    } finally {
      setIsSaving(false)
    }
  }

  const newStock = item.currentStock + form.quantityChange

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Adjust Stock - {item.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-gray-500">
            Current stock: <strong>{item.currentStock.toFixed(1)} {item.storageUnit}</strong>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Adjustment Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full border rounded px-3 py-2"
            >
              <option value="adjustment">Adjustment</option>
              <option value="purchase">Purchase / Receiving</option>
              <option value="waste">Waste / Spoilage</option>
              <option value="count">Physical Count Correction</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Quantity Change</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={form.quantityChange}
              onChange={(e) => setForm({ ...form, quantityChange: parseFloat(e.target.value) || 0 })}
              className="w-full border rounded px-3 py-2"
              placeholder="+/- amount"
            />
            <p className="text-xs text-gray-400 mt-1">
              Use positive for additions, negative for removals
            </p>
          </div>

          <div className="p-3 bg-gray-50 rounded">
            <div className="text-sm text-gray-500">New stock will be:</div>
            <div className={`text-xl font-bold ${newStock < 0 ? 'text-red-600' : ''}`}>
              {newStock.toFixed(1)} {item.storageUnit}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Reason / Notes</label>
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="w-full border rounded px-3 py-2"
              placeholder="Optional"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={onClose} disabled={isSaving} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
