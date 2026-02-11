'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface InventoryItem {
  id: string
  name: string
  sku: string | null
  category: string | null
}

interface WasteEntry {
  id: string
  inventoryItemId: string
  inventoryItem: InventoryItem
  employeeId: string | null
  reason: string
  quantity: number
  unit: string
  costImpact: number | null
  notes: string | null
  wasteDate: string
  createdAt: string
}

const WASTE_REASONS = [
  { value: 'spoilage', label: 'Spoilage', color: 'bg-amber-100 text-amber-700' },
  { value: 'spill', label: 'Spill', color: 'bg-blue-100 text-blue-700' },
  { value: 'overcooked', label: 'Overcooked', color: 'bg-orange-100 text-orange-700' },
  { value: 'contamination', label: 'Contamination', color: 'bg-red-100 text-red-700' },
  { value: 'training', label: 'Training', color: 'bg-purple-100 text-purple-700' },
]

// Common units for autocomplete
const STORAGE_UNITS = ['oz', 'lb', 'g', 'kg', 'ml', 'L', 'each', 'slice', 'portion', 'cup', 'tbsp', 'tsp', 'fl oz']

export default function WastePage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [entries, setEntries] = useState<WasteEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })

  // Modal
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory/waste')
      return
    }
    loadWaste()
  }, [isAuthenticated, router])

  // Reload when filters change
  useEffect(() => {
    if (employee?.location?.id) {
      loadWaste()
    }
  }, [reason, startDate, endDate])

  const loadWaste = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)

    const params = new URLSearchParams({
      locationId: employee.location.id,
    })

    if (reason) params.set('reason', reason)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)

    try {
      const res = await fetch(`/api/inventory/waste?${params}`)
      if (res.ok) {
        const data = await res.json()
        setEntries(data.entries || [])
      } else {
        toast.error('Failed to load waste log')
      }
    } catch (error) {
      console.error('Failed to load waste log:', error)
      toast.error('Failed to load waste log')
    } finally {
      setIsLoading(false)
    }
  }

  // Filter by search locally
  const filteredEntries = useMemo(() => {
    if (!search) return entries
    const lower = search.toLowerCase()
    return entries.filter(e =>
      e.inventoryItem.name.toLowerCase().includes(lower) ||
      e.inventoryItem.sku?.toLowerCase().includes(lower)
    )
  }, [entries, search])

  // Calculate totals
  const totals = useMemo(() => {
    const totalCost = filteredEntries.reduce((sum, e) => sum + (e.costImpact || 0), 0)
    const byReason = WASTE_REASONS.map(r => ({
      ...r,
      count: filteredEntries.filter(e => e.reason === r.value).length,
      cost: filteredEntries.filter(e => e.reason === r.value).reduce((sum, e) => sum + (e.costImpact || 0), 0),
    })).filter(r => r.count > 0)
    return { totalCost, byReason }
  }, [filteredEntries])

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getReasonStyle = (reasonValue: string) => {
    const r = WASTE_REASONS.find(wr => wr.value === reasonValue)
    return r?.color || 'bg-gray-100 text-gray-700'
  }

  const getReasonLabel = (reasonValue: string) => {
    const r = WASTE_REASONS.find(wr => wr.value === reasonValue)
    return r?.label || reasonValue
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Waste Log"
        subtitle="Track and manage inventory waste"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
        actions={
          <Button onClick={() => setShowModal(true)}>
            + Log Waste
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-red-50">
          <CardContent className="p-4">
            <p className="text-sm text-red-600">Total Cost Impact</p>
            <p className="text-2xl font-bold text-red-700">{formatCurrency(totals.totalCost)}</p>
            <p className="text-sm text-red-600">{filteredEntries.length} entries</p>
          </CardContent>
        </Card>
        {totals.byReason.slice(0, 3).map(r => (
          <Card key={r.value} className="bg-gray-50">
            <CardContent className="p-4">
              <p className="text-sm text-gray-600">{r.label}</p>
              <p className="text-2xl font-bold text-gray-900">{r.count}</p>
              <p className="text-sm text-gray-600">{formatCurrency(r.cost)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Search Item</label>
              <input
                type="text"
                placeholder="Search by item name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="border rounded px-3 py-2 min-w-[150px]"
              >
                <option value="">All Reasons</option>
                {WASTE_REASONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border rounded px-3 py-2"
              />
            </div>
            <Button variant="outline" onClick={loadWaste}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Waste Table */}
      {isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            Loading waste log...
          </CardContent>
        </Card>
      ) : filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            No waste entries found for the selected filters.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost Impact</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredEntries.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {formatDateTime(entry.wasteDate)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{entry.inventoryItem.name}</div>
                      {entry.inventoryItem.sku && (
                        <div className="text-xs text-gray-500">{entry.inventoryItem.sku}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-red-600 font-medium whitespace-nowrap">
                      -{entry.quantity.toFixed(2)} {entry.unit}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${getReasonStyle(entry.reason)}`}>
                        {getReasonLabel(entry.reason)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-red-600 font-medium whitespace-nowrap">
                      {entry.costImpact !== null ? `-${formatCurrency(entry.costImpact)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">
                      {entry.notes || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals Row */}
              <tfoot className="bg-gray-50 border-t-2">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-sm font-medium text-gray-700">
                    Total ({filteredEntries.length} entries)
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-red-700 font-bold whitespace-nowrap">
                    -{formatCurrency(totals.totalCost)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Waste Entry Modal */}
      {showModal && (
        <WasteEntryModal
          locationId={employee?.location?.id || ''}
          employeeId={employee?.id || ''}
          onClose={() => setShowModal(false)}
          onSave={() => { setShowModal(false); loadWaste() }}
        />
      )}
    </div>
  )
}

// Waste Entry Modal
function WasteEntryModal({
  locationId,
  employeeId,
  onClose,
  onSave,
}: {
  locationId: string
  employeeId: string
  onClose: () => void
  onSave: () => void
}) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [isLoadingItems, setIsLoadingItems] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [search, setSearch] = useState('')

  const [form, setForm] = useState({
    inventoryItemId: '',
    reason: '',
    quantity: '',
    unit: '',
    notes: '',
  })

  // Load inventory items
  useEffect(() => {
    const loadItems = async () => {
      setIsLoadingItems(true)
      try {
        const res = await fetch(`/api/inventory/items?locationId=${locationId}&activeOnly=true`)
        if (res.ok) {
          const data = await res.json()
          setItems(data.items || [])
        }
      } catch (error) {
        console.error('Failed to load items:', error)
      } finally {
        setIsLoadingItems(false)
      }
    }
    loadItems()
  }, [locationId])

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!search) return items
    const lower = search.toLowerCase()
    return items.filter(i =>
      i.name.toLowerCase().includes(lower) ||
      i.sku?.toLowerCase().includes(lower)
    )
  }, [items, search])

  // Set unit when item selected
  useEffect(() => {
    if (form.inventoryItemId) {
      const item = items.find(i => i.id === form.inventoryItemId) as InventoryItem & { storageUnit?: string }
      if (item?.storageUnit) {
        setForm(f => ({ ...f, unit: item.storageUnit || '' }))
      }
    }
  }, [form.inventoryItemId, items])

  const handleSave = async () => {
    if (!form.inventoryItemId) {
      toast.error('Please select an item')
      return
    }
    if (!form.reason) {
      toast.error('Please select a reason')
      return
    }
    if (!form.quantity || parseFloat(form.quantity) <= 0) {
      toast.error('Please enter a valid quantity')
      return
    }
    if (!form.unit) {
      toast.error('Please enter a unit')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/inventory/waste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          inventoryItemId: form.inventoryItemId,
          employeeId,
          reason: form.reason,
          quantity: parseFloat(form.quantity),
          unit: form.unit,
          notes: form.notes || null,
        }),
      })

      if (res.ok) {
        toast.success('Waste entry logged')
        onSave()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to log waste')
      }
    } catch (error) {
      console.error('Failed to log waste:', error)
      toast.error('Failed to log waste')
    } finally {
      setIsSaving(false)
    }
  }

  const selectedItem = items.find(i => i.id === form.inventoryItemId) as (InventoryItem & { costPerUnit?: number }) | undefined

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Log Waste Entry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Item Selection */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Inventory Item *</label>
            <input
              type="text"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-2"
            />
            {isLoadingItems ? (
              <p className="text-sm text-gray-500">Loading items...</p>
            ) : (
              <div className="max-h-40 overflow-y-auto border rounded">
                {filteredItems.length === 0 ? (
                  <p className="p-2 text-sm text-gray-500">No items found</p>
                ) : (
                  filteredItems.slice(0, 20).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setForm(f => ({ ...f, inventoryItemId: item.id }))
                        setSearch(item.name)
                      }}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0 ${
                        form.inventoryItemId === item.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="font-medium">{item.name}</div>
                      {item.sku && <div className="text-xs text-gray-500">{item.sku}</div>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Reason *</label>
            <div className="grid grid-cols-2 gap-2">
              {WASTE_REASONS.map(r => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, reason: r.value }))}
                  className={`px-3 py-2 text-sm font-medium rounded border ${
                    form.reason === r.value
                      ? r.color + ' border-current'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quantity & Unit */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Quantity *</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.quantity}
                onChange={(e) => setForm(f => ({ ...f, quantity: e.target.value }))}
                className="w-full border rounded px-3 py-2"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Unit *</label>
              <input
                type="text"
                list="waste-units"
                value={form.unit}
                onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                className="w-full border rounded px-3 py-2"
                placeholder="oz, lb, each, etc."
              />
            </div>
          </div>

          {/* Cost Preview */}
          {selectedItem && form.quantity && selectedItem.costPerUnit && (
            <div className="p-3 bg-red-50 rounded">
              <p className="text-sm text-red-600">
                Estimated Cost Impact:{' '}
                <span className="font-bold">
                  -{formatCurrency(parseFloat(form.quantity) * selectedItem.costPerUnit)}
                </span>
              </p>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full border rounded px-3 py-2"
              rows={2}
              placeholder="Additional details..."
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={onClose} disabled={isSaving} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? 'Saving...' : 'Log Waste'}
            </Button>
          </div>

          {/* Unit autocomplete datalist */}
          <datalist id="waste-units">
            {STORAGE_UNITS.map(u => <option key={u} value={u} />)}
          </datalist>
        </CardContent>
      </Card>
    </div>
  )
}
