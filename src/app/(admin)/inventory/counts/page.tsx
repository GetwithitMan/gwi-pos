'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { GroupedVirtuoso } from 'react-virtuoso'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'

interface StorageLocation {
  id: string
  name: string
  description: string | null
  _count: { inventoryItems: number }
}

interface InventoryCount {
  id: string
  countType: string
  status: string
  countDate: string
  completedAt: string | null
  reviewedAt: string | null
  varianceValue: number | null
  variancePct: number | null
  notes: string | null
  storageLocation: { id: string; name: string } | null
  _count: { items: number }
}

interface CountItem {
  id: string
  inventoryItemId: string
  expectedQty: number
  countedQty: number | null
  variance: number | null
  varianceValue: number | null
  notes: string | null
  inventoryItem: {
    id: string
    name: string
    sku: string | null
    category: string | null
    storageUnit: string
    costPerUnit: number
  }
}

interface CountDetail extends InventoryCount {
  items: CountItem[]
}

const COUNT_TYPES = [
  { value: 'full', label: 'Full Count' },
  { value: 'cycle', label: 'Cycle Count' },
  { value: 'spot', label: 'Spot Check' },
]

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700' },
  completed: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  reviewed: { bg: 'bg-green-100', text: 'text-green-700' },
}

export default function CountsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  const crud = useAdminCRUD<InventoryCount>({
    apiBase: '/api/inventory/counts',
    locationId: employee?.location?.id,
    resourceName: 'count',
    parseResponse: (data) => data.counts || [],
  })

  const {
    items: allCounts,
    isLoading,
    showModal: showNewModal,
    loadItems,
    openAddModal,
    closeModal,
  } = crud

  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([])

  // Selected count for detail view
  const [selectedCountId, setSelectedCountId] = useState<string | null>(null)
  const [countDetail, setCountDetail] = useState<CountDetail | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  // Count entries being edited
  const [editedItems, setEditedItems] = useState<Record<string, string>>({})

  // Filter (client-side)
  const [statusFilter, setStatusFilter] = useState('')

  const counts = useMemo(() => {
    if (!statusFilter) return allCounts
    return allCounts.filter(c => c.status === statusFilter)
  }, [allCounts, statusFilter])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory/counts')
      return
    }
  }, [isAuthenticated, router])

  // Load counts + storage locations
  useEffect(() => {
    if (employee?.location?.id) {
      loadItems()
      fetch(`/api/inventory/storage-locations?locationId=${employee.location.id}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => { if (data) setStorageLocations(data.storageLocations || []) })
        .catch(() => {})
    }
  }, [employee?.location?.id, loadItems])

  // Load count detail
  useEffect(() => {
    if (selectedCountId) {
      loadCountDetail(selectedCountId)
    } else {
      setCountDetail(null)
    }
  }, [selectedCountId])

  const loadCountDetail = async (id: string) => {
    setIsLoadingDetail(true)
    try {
      const res = await fetch(`/api/inventory/counts/${id}`)
      if (res.ok) {
        const data = await res.json()
        setCountDetail(data.count)
        setEditedItems({})
      } else {
        toast.error('Failed to load count details')
      }
    } catch (error) {
      console.error('Failed to load count detail:', error)
      toast.error('Failed to load count details')
    } finally {
      setIsLoadingDetail(false)
    }
  }

  const handleSaveItems = async () => {
    if (!countDetail) return

    const itemUpdates = Object.entries(editedItems)
      .filter(([, value]) => value !== '')
      .map(([itemId, value]) => ({
        id: itemId,
        countedQty: parseFloat(value),
      }))

    if (itemUpdates.length === 0) {
      toast.warning('No items to save')
      return
    }

    try {
      const res = await fetch(`/api/inventory/counts/${countDetail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemUpdates }),
      })

      if (res.ok) {
        toast.success(`Saved ${itemUpdates.length} item(s)`)
        loadCountDetail(countDetail.id)
        loadItems() // Refresh list
      } else {
        toast.error('Failed to save counts')
      }
    } catch (error) {
      console.error('Failed to save counts:', error)
      toast.error('Failed to save counts')
    }
  }

  const handleCompleteCount = async () => {
    if (!countDetail) return

    // Check if all items are counted
    const uncounted = countDetail.items.filter(i => i.countedQty === null)
    if (uncounted.length > 0) {
      toast.warning(`${uncounted.length} item(s) not yet counted`)
      return
    }

    try {
      const res = await fetch(`/api/inventory/counts/${countDetail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })

      if (res.ok) {
        toast.success('Count completed')
        loadCountDetail(countDetail.id)
        loadItems()
      } else {
        toast.error('Failed to complete count')
      }
    } catch (error) {
      console.error('Failed to complete count:', error)
      toast.error('Failed to complete count')
    }
  }

  const handleApproveCount = async () => {
    if (!countDetail || !employee?.id) return

    try {
      const res = await fetch(`/api/inventory/counts/${countDetail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'reviewed',
          reviewedById: employee.id,
        }),
      })

      if (res.ok) {
        toast.success('Count approved - inventory updated')
        loadCountDetail(countDetail.id)
        loadItems()
      } else {
        toast.error('Failed to approve count')
      }
    } catch (error) {
      console.error('Failed to approve count:', error)
      toast.error('Failed to approve count')
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Group count items by category - structured for GroupedVirtuoso
  const { groups, groupCounts, flatItems } = useMemo(() => {
    if (!countDetail) return { groups: [], groupCounts: [], flatItems: [] }

    const grouped: Record<string, CountItem[]> = {}
    for (const item of countDetail.items) {
      const cat = item.inventoryItem.category || 'Uncategorized'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(item)
    }

    // Sort categories alphabetically
    const sortedCategories = Object.keys(grouped).sort()
    const groups = sortedCategories
    const groupCounts = sortedCategories.map(cat => grouped[cat].length)
    const flatItems = sortedCategories.flatMap(cat => grouped[cat])

    return { groups, groupCounts, flatItems }
  }, [countDetail])

  // Calculate progress
  const countProgress = useMemo(() => {
    if (!countDetail) return { counted: 0, total: 0, percent: 0 }
    const total = countDetail.items.length
    const counted = countDetail.items.filter(i => i.countedQty !== null).length
    return { counted, total, percent: total > 0 ? Math.round((counted / total) * 100) : 0 }
  }, [countDetail])

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Inventory Counts"
        subtitle="Physical inventory counts and reconciliation"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
        actions={
          <Button size="sm" onClick={openAddModal}>
            + New Count
          </Button>
        }
      />

      <div className="flex gap-6 h-[calc(100vh-16rem)]">
        {/* Left Panel - Count List */}
        <div className="w-80 flex-shrink-0 flex flex-col">

        {/* Status Filter */}
        <div className="mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </div>

        {/* Count List */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {isLoading ? (
            <p className="text-sm text-gray-500 p-4">Loading...</p>
          ) : counts.length === 0 ? (
            <p className="text-sm text-gray-500 p-4">No counts found</p>
          ) : (
            counts.map(count => {
              const statusStyle = STATUS_COLORS[count.status] || STATUS_COLORS.pending
              return (
                <button
                  key={count.id}
                  onClick={() => setSelectedCountId(count.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedCountId === count.id
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">
                      {COUNT_TYPES.find(t => t.value === count.countType)?.label || count.countType}
                    </span>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusStyle.bg} ${statusStyle.text}`}>
                      {count.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(count.countDate)} &middot; {count._count.items} items
                  </div>
                  {count.storageLocation && (
                    <div className="text-xs text-gray-500">
                      {count.storageLocation.name}
                    </div>
                  )}
                  {count.varianceValue !== null && count.status !== 'in_progress' && (
                    <div className={`text-xs mt-1 ${count.varianceValue < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      Variance: {formatCurrency(count.varianceValue)}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right Panel - Count Detail */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedCountId ? (
          <Card className="flex-1 flex items-center justify-center">
            <CardContent className="text-center text-gray-500">
              <p>Select a count to view details</p>
              <p className="text-sm mt-2">or create a new count</p>
            </CardContent>
          </Card>
        ) : isLoadingDetail ? (
          <Card className="flex-1 flex items-center justify-center">
            <CardContent className="text-gray-500">Loading count details...</CardContent>
          </Card>
        ) : countDetail ? (
          <Card className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <CardHeader className="flex-shrink-0 border-b">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>
                    {COUNT_TYPES.find(t => t.value === countDetail.countType)?.label || countDetail.countType}
                  </CardTitle>
                  <p className="text-sm text-gray-500 mt-1">
                    {formatDateTime(countDetail.countDate)}
                    {countDetail.storageLocation && ` • ${countDetail.storageLocation.name}`}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`px-2 py-1 text-sm font-medium rounded ${STATUS_COLORS[countDetail.status]?.bg} ${STATUS_COLORS[countDetail.status]?.text}`}>
                    {countDetail.status.replace('_', ' ')}
                  </span>
                  <p className="text-sm text-gray-500 mt-2">
                    {countProgress.counted}/{countProgress.total} counted ({countProgress.percent}%)
                  </p>
                </div>
              </div>
            </CardHeader>

            {/* Count Sheet - Virtualized */}
            <CardContent className="flex-1 overflow-hidden p-0">
              {flatItems.length === 0 ? (
                <div className="p-8 text-center text-gray-500">No items in this count</div>
              ) : (
                <GroupedVirtuoso
                  style={{ height: '100%' }}
                  groupCounts={groupCounts}
                  groupContent={(index) => (
                    <div className="bg-gray-100 px-4 py-2 font-medium text-sm text-gray-700 border-b">
                      {groups[index]}
                    </div>
                  )}
                  itemContent={(index) => {
                    const item = flatItems[index]
                    const isEditable = countDetail.status === 'in_progress'
                    const variance = item.variance
                    const hasVariance = variance !== null && variance !== 0

                    return (
                      <div className="flex items-center border-b hover:bg-gray-50 px-4 py-2">
                        {/* Item Name */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{item.inventoryItem.name}</div>
                          {item.inventoryItem.sku && (
                            <div className="text-xs text-gray-500">{item.inventoryItem.sku}</div>
                          )}
                        </div>

                        {/* Expected */}
                        <div className="w-28 text-right text-sm text-gray-600 flex-shrink-0">
                          {item.expectedQty.toFixed(2)} {item.inventoryItem.storageUnit}
                        </div>

                        {/* Counted */}
                        <div className="w-28 text-center flex-shrink-0">
                          {isEditable ? (
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={editedItems[item.id] ?? (item.countedQty?.toString() || '')}
                              onChange={(e) => setEditedItems(prev => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))}
                              className="w-20 text-center border rounded px-2 py-1 text-sm"
                              placeholder="0.00"
                            />
                          ) : (
                            <span className="text-sm">
                              {item.countedQty !== null ? item.countedQty.toFixed(2) : '-'}
                            </span>
                          )}
                        </div>

                        {/* Variance */}
                        <div className={`w-20 text-right text-sm font-medium flex-shrink-0 ${
                          hasVariance
                            ? variance! < 0 ? 'text-red-600' : 'text-green-600'
                            : 'text-gray-400'
                        }`}>
                          {variance !== null
                            ? `${variance >= 0 ? '+' : ''}${variance.toFixed(2)}`
                            : '-'
                          }
                        </div>
                      </div>
                    )
                  }}
                />
              )}
            </CardContent>

            {/* Footer Actions */}
            <div className="flex-shrink-0 border-t p-4 bg-gray-50">
              {countDetail.status === 'in_progress' && (
                <div className="flex gap-2">
                  <Button onClick={handleSaveItems} variant="outline" className="flex-1">
                    Save Progress
                  </Button>
                  <Button onClick={handleCompleteCount} className="flex-1">
                    Complete Count
                  </Button>
                </div>
              )}
              {countDetail.status === 'completed' && (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Variance:</p>
                    <p className={`font-bold ${countDetail.varianceValue && countDetail.varianceValue < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(countDetail.varianceValue || 0)}
                    </p>
                  </div>
                  <Button onClick={handleApproveCount}>
                    Approve & Update Inventory
                  </Button>
                </div>
              )}
              {countDetail.status === 'reviewed' && (
                <div className="text-center text-sm text-gray-500">
                  Approved and applied to inventory
                  {countDetail.reviewedAt && ` on ${formatDateTime(countDetail.reviewedAt)}`}
                </div>
              )}
            </div>
          </Card>
        ) : null}
      </div>

      {/* New Count Modal */}
      {showNewModal && (
        <NewCountModal
          locationId={employee?.location?.id || ''}
          employeeId={employee?.id || ''}
          storageLocations={storageLocations}
          onClose={closeModal}
          onCreated={(countId) => {
            closeModal()
            loadItems()
            setSelectedCountId(countId)
          }}
        />
      )}
      </div>
    </div>
  )
}

// New Count Modal
function NewCountModal({
  locationId,
  employeeId,
  storageLocations,
  onClose,
  onCreated,
}: {
  locationId: string
  employeeId: string
  storageLocations: StorageLocation[]
  onClose: () => void
  onCreated: (countId: string) => void
}) {
  const [countType, setCountType] = useState('full')
  const [storageLocationId, setStorageLocationId] = useState('')
  const [notes, setNotes] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    setIsCreating(true)
    try {
      const res = await fetch('/api/inventory/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          startedById: employeeId,
          countType,
          storageLocationId: storageLocationId || null,
          notes: notes || null,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success('Count created')
        onCreated(data.count.id)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create count')
      }
    } catch (error) {
      console.error('Failed to create count:', error)
      toast.error('Failed to create count')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="New Inventory Count" size="md">
        <div className="space-y-4">
          {/* Count Type */}
          <div>
            <label className="block text-sm text-gray-600 mb-2">Count Type *</label>
            <div className="grid grid-cols-3 gap-2">
              {COUNT_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setCountType(t.value)}
                  className={`px-3 py-2 text-sm font-medium rounded border ${
                    countType === t.value
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Storage Location Filter */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              Storage Location (optional)
            </label>
            <select
              value={storageLocationId}
              onChange={(e) => setStorageLocationId(e.target.value)}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">All Locations</option>
              {storageLocations.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} ({loc._count.inventoryItems} items)
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Filter count to items in a specific storage area
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border rounded px-3 py-2"
              rows={2}
              placeholder="Optional notes..."
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={onClose} disabled={isCreating} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreating} className="flex-1">
              {isCreating ? 'Creating...' : 'Start Count'}
            </Button>
          </div>
        </div>
    </Modal>
  )
}
