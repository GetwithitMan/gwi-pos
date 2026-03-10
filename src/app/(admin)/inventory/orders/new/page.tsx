'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'

interface Vendor {
  id: string
  name: string
  phone: string | null
  email: string | null
}

interface InventoryItem {
  id: string
  name: string
  sku: string | null
  purchaseUnit: string | null
  storageUnit: string | null
  lastInvoiceCost: number | null
  currentStock: number | null
  costPerUnit: number | null
}

interface LineItem {
  inventoryItemId: string
  itemName: string
  quantity: number
  unit: string
  estimatedCost: number
  storageUnit: string | null
  lastInvoiceCost: number | null
  currentStock: number | null
}

const UNIT_OPTIONS = ['each', 'case', 'lb', 'oz', 'kg', 'g', 'L', 'ml', 'gal']

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/inventory/orders/new' })
  const locationId = employee?.location?.id

  // URL params
  const preselectedVendorId = searchParams.get('vendor') || ''
  const fromReorder = searchParams.get('fromReorder') === '1'

  // State
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [form, setForm] = useState({
    vendorId: preselectedVendorId,
    orderNumber: '',
    expectedDelivery: '',
    notes: '',
  })
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Item search
  const [itemSearch, setItemSearch] = useState('')
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // Load vendors
  useEffect(() => {
    if (!locationId) return
    const load = async () => {
      try {
        const res = await fetch(`/api/inventory/vendors?locationId=${locationId}`)
        if (res.ok) {
          const data = await res.json()
          setVendors(data.data?.vendors || [])
        }
      } catch {
        // silent
      }
    }
    load()
  }, [locationId])

  // Set vendor from URL param once vendors load
  useEffect(() => {
    if (preselectedVendorId && vendors.length > 0) {
      setForm(f => ({ ...f, vendorId: preselectedVendorId }))
    }
  }, [preselectedVendorId, vendors])

  // Debounced item search
  const searchItems = useCallback(async (query: string) => {
    if (!locationId || query.length < 2) {
      setSearchResults([])
      return
    }
    setIsSearching(true)
    try {
      const params = new URLSearchParams({
        locationId,
        search: query,
        limit: '20',
        activeOnly: 'true',
      })
      const res = await fetch(`/api/inventory/items?${params}`)
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.data?.items || [])
      }
    } catch {
      // silent
    } finally {
      setIsSearching(false)
    }
  }, [locationId])

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (itemSearch.length < 2) {
      setSearchResults([])
      return
    }
    searchTimeoutRef.current = setTimeout(() => {
      searchItems(itemSearch)
    }, 300)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [itemSearch, searchItems])

  // Close search dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const addItem = (item: InventoryItem) => {
    // Don't add duplicates
    if (lineItems.some(li => li.inventoryItemId === item.id)) {
      toast.error('Item already added')
      return
    }
    setLineItems(prev => [...prev, {
      inventoryItemId: item.id,
      itemName: item.name,
      quantity: 1,
      unit: item.purchaseUnit || item.storageUnit || 'each',
      estimatedCost: item.lastInvoiceCost || item.costPerUnit || 0,
      storageUnit: item.storageUnit,
      lastInvoiceCost: item.lastInvoiceCost,
      currentStock: item.currentStock,
    }])
    setItemSearch('')
    setSearchResults([])
    setShowResults(false)
  }

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    setLineItems(prev => prev.map((li, i) =>
      i === index ? { ...li, [field]: value } : li
    ))
  }

  const removeLineItem = (index: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  const runningTotal = lineItems.reduce((sum, li) => sum + (li.quantity * li.estimatedCost), 0)

  const handleSubmit = async () => {
    if (!locationId || !employee?.id) return
    if (!form.vendorId) {
      setError('Please select a vendor')
      return
    }
    if (lineItems.length === 0) {
      setError('Please add at least one item')
      return
    }
    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/inventory/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: employee.id,
          vendorId: form.vendorId,
          orderNumber: form.orderNumber || undefined,
          expectedDelivery: form.expectedDelivery || undefined,
          notes: form.notes || undefined,
          lineItems: lineItems.map(li => ({
            inventoryItemId: li.inventoryItemId,
            quantity: li.quantity,
            unit: li.unit,
            estimatedCost: li.estimatedCost,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create purchase order')
      }

      const data = await res.json()
      const newId = data.data?.id || data.id
      toast.success('Purchase order created')
      router.push(`/inventory/orders/${newId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create purchase order')
    } finally {
      setSubmitting(false)
    }
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <Link href="/inventory/orders" className="text-sm text-blue-600 hover:underline mb-2 inline-block">
          &larr; Purchase Orders
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Purchase Order</h1>
        {fromReorder && (
          <p className="text-sm text-gray-900 mt-1">Creating from reorder suggestions</p>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: PO Details */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <h2 className="font-semibold text-gray-900">Order Details</h2>

              {/* Vendor Select */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Vendor *</label>
                <select
                  value={form.vendorId}
                  onChange={(e) => setForm(f => ({ ...f, vendorId: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select a vendor...</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

              {/* Order Number */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Order Number</label>
                <input
                  type="text"
                  value={form.orderNumber}
                  onChange={(e) => setForm(f => ({ ...f, orderNumber: e.target.value }))}
                  placeholder="Auto-generated"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* Expected Delivery */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Expected Delivery</label>
                <input
                  type="date"
                  value={form.expectedDelivery}
                  onChange={(e) => setForm(f => ({ ...f, expectedDelivery: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Special instructions, delivery notes..."
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={submitting || !form.vendorId || lineItems.length === 0}
            className="w-full min-h-[44px]"
          >
            {submitting ? 'Creating...' : 'Create Purchase Order'}
          </Button>
        </div>

        {/* Right Column: Line Items */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold text-gray-900 mb-4">Line Items</h2>

              {/* Item Search */}
              <div className="relative mb-4" ref={searchContainerRef}>
                <input
                  type="text"
                  value={itemSearch}
                  onChange={(e) => {
                    setItemSearch(e.target.value)
                    setShowResults(true)
                  }}
                  onFocus={() => setShowResults(true)}
                  placeholder="Search inventory items to add..."
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                {showResults && (itemSearch.length >= 2) && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {isSearching ? (
                      <p className="p-3 text-sm text-gray-900">Searching...</p>
                    ) : searchResults.length === 0 ? (
                      <p className="p-3 text-sm text-gray-900">No items found</p>
                    ) : (
                      searchResults.map(item => {
                        const alreadyAdded = lineItems.some(li => li.inventoryItemId === item.id)
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => addItem(item)}
                            className={`w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0 ${
                              alreadyAdded ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <div className="font-medium text-sm">{item.name}</div>
                                {item.sku && <div className="text-xs text-gray-900">{item.sku}</div>}
                              </div>
                              <div className="text-right text-xs text-gray-900">
                                {item.currentStock !== null && (
                                  <div>Stock: {item.currentStock} {item.storageUnit}</div>
                                )}
                                {item.lastInvoiceCost !== null && (
                                  <div>Last: {formatCurrency(item.lastInvoiceCost)}</div>
                                )}
                              </div>
                            </div>
                            {alreadyAdded && <span className="text-xs text-blue-600">Already added</span>}
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Line Items Table */}
              {lineItems.length === 0 ? (
                <div className="text-center py-8 text-gray-900 text-sm">
                  Search and add inventory items above
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Item</th>
                          <th className="text-center px-3 py-2 font-medium text-gray-600 w-24">Qty</th>
                          <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Unit</th>
                          <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Est. Cost</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600 w-24">Subtotal</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {lineItems.map((li, idx) => (
                          <tr key={li.inventoryItemId} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-900">{li.itemName}</div>
                              {li.currentStock !== null && (
                                <div className="text-xs text-gray-900">
                                  Stock: {li.currentStock} {li.storageUnit}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={li.quantity}
                                onChange={(e) => updateLineItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                className="w-full border rounded px-2 py-1 text-center text-sm"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={li.unit}
                                onChange={(e) => updateLineItem(idx, 'unit', e.target.value)}
                                className="w-full border rounded px-2 py-1 text-sm"
                              >
                                {[...new Set([
                                  li.unit,
                                  li.storageUnit,
                                  ...UNIT_OPTIONS,
                                ].filter(Boolean))].map(u => (
                                  <option key={u} value={u!}>{u}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={li.estimatedCost}
                                onChange={(e) => updateLineItem(idx, 'estimatedCost', parseFloat(e.target.value) || 0)}
                                className="w-full border rounded px-2 py-1 text-center text-sm"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-gray-900">
                              {formatCurrency(li.quantity * li.estimatedCost)}
                            </td>
                            <td className="px-1 py-2">
                              <button
                                onClick={() => removeLineItem(idx)}
                                className="text-red-500 hover:text-red-700 p-1"
                                title="Remove item"
                              >
                                &times;
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2">
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-right font-semibold text-gray-900">
                            Estimated Total ({lineItems.length} item{lineItems.length !== 1 ? 's' : ''})
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-gray-900">
                            {formatCurrency(runningTotal)}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
