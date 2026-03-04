'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

interface Vendor {
  id: string
  name: string
}

interface InventoryItemOption {
  id: string
  name: string
  purchaseUnit: string
  purchaseCost: number
  storageUnit: string
  costPerUnit: number
}

interface LineItem {
  key: string // client-side key for React
  inventoryItemId: string
  inventoryItemName: string
  description: string
  quantity: string
  unit: string
  unitCost: string
  previousCost: number | null
}

function generateKey() {
  return Math.random().toString(36).slice(2, 10)
}

function emptyLineItem(): LineItem {
  return {
    key: generateKey(),
    inventoryItemId: '',
    inventoryItemName: '',
    description: '',
    quantity: '',
    unit: 'each',
    unitCost: '',
    previousCost: null,
  }
}

export default function NewInvoicePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('edit')

  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/invoices/new' })
  const locationId = employee?.location?.id

  // Form state
  const [vendorId, setVendorId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [deliveryDate, setDeliveryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem()])
  const [isSaving, setIsSaving] = useState(false)
  const [isReadOnly, setIsReadOnly] = useState(false)

  // Lookup data
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null)

  // Load vendors and inventory items
  useEffect(() => {
    if (!locationId) return

    fetch(`/api/inventory/vendors?locationId=${locationId}`)
      .then(r => r.json())
      .then(data => setVendors(data.data?.vendors || []))
      .catch(() => {})

    fetch(`/api/ingredients?locationId=${locationId}&requestingEmployeeId=${employee?.id}&baseOnly=true`)
      .then(r => r.json())
      .then(data => {
        // Map ingredients to inventory item format for the dropdown
        const items: InventoryItemOption[] = (data.data || [])
          .filter((ing: Record<string, unknown>) => ing.inventoryItemId)
          .map((ing: Record<string, unknown>) => ({
            id: (ing.inventoryItem as Record<string, unknown>)?.id || ing.inventoryItemId,
            name: ing.name as string,
            purchaseUnit: (ing.purchaseUnit as string) || 'each',
            purchaseCost: (ing.purchaseCost as number) || 0,
            storageUnit: ((ing.inventoryItem as Record<string, unknown>)?.storageUnit as string) || 'each',
            costPerUnit: 0,
          }))
        setInventoryItems(items)
      })
      .catch(() => {})
  }, [locationId, employee?.id])

  // Load existing invoice if editing
  useEffect(() => {
    if (!editId || !locationId || !employee?.id) return

    fetch(`/api/invoices/${editId}?locationId=${locationId}&requestingEmployeeId=${employee.id}`)
      .then(r => r.json())
      .then(data => {
        const inv = data.data?.invoice
        if (!inv) return

        setVendorId(inv.vendorId || '')
        setInvoiceNumber(inv.invoiceNumber || '')
        setInvoiceDate(new Date(inv.invoiceDate).toISOString().split('T')[0])
        setDeliveryDate(inv.deliveryDate ? new Date(inv.deliveryDate).toISOString().split('T')[0] : '')
        setNotes(inv.notes || '')
        setIsReadOnly(inv.status !== 'draft')

        if (inv.lineItems?.length > 0) {
          setLineItems(inv.lineItems.map((li: Record<string, unknown>) => ({
            key: generateKey(),
            inventoryItemId: (li.inventoryItemId as string) || '',
            inventoryItemName: ((li.inventoryItem as Record<string, unknown>)?.name as string) || '',
            description: (li.description as string) || '',
            quantity: String(li.quantity || ''),
            unit: (li.unit as string) || 'each',
            unitCost: String(li.unitCost || ''),
            previousCost: (li.previousCost as number) ?? null,
          })))
        }
      })
      .catch(() => toast.error('Failed to load invoice'))
  }, [editId, locationId, employee?.id])

  const addLineItem = () => {
    setLineItems(prev => [...prev, emptyLineItem()])
  }

  const removeLineItem = (key: string) => {
    setLineItems(prev => prev.length > 1 ? prev.filter(li => li.key !== key) : prev)
  }

  const updateLineItem = (key: string, field: keyof LineItem, value: string) => {
    setLineItems(prev => prev.map(li => li.key === key ? { ...li, [field]: value } : li))
  }

  const selectInventoryItem = (lineKey: string, item: InventoryItemOption) => {
    setLineItems(prev => prev.map(li => {
      if (li.key !== lineKey) return li
      return {
        ...li,
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        unit: item.purchaseUnit,
        previousCost: item.purchaseCost,
        description: '',
      }
    }))
    setActiveSearchIndex(null)
    setSearchQuery('')
  }

  const filteredInventoryItems = useMemo(() => {
    if (!searchQuery) return inventoryItems.slice(0, 20)
    const q = searchQuery.toLowerCase()
    return inventoryItems.filter(i => i.name.toLowerCase().includes(q)).slice(0, 20)
  }, [inventoryItems, searchQuery])

  const subtotal = useMemo(() => {
    return lineItems.reduce((sum, li) => {
      const qty = parseFloat(li.quantity) || 0
      const cost = parseFloat(li.unitCost) || 0
      return sum + qty * cost
    }, 0)
  }, [lineItems])

  const handleSave = async (andPost: boolean) => {
    if (!locationId || !employee?.id) return

    if (!invoiceDate) {
      toast.error('Invoice date is required')
      return
    }
    if (lineItems.every(li => !li.inventoryItemId && !li.description)) {
      toast.error('Add at least one line item')
      return
    }

    setIsSaving(true)
    try {
      // Create the invoice
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          requestingEmployeeId: employee.id,
          vendorId: vendorId || undefined,
          invoiceNumber,
          invoiceDate,
          deliveryDate: deliveryDate || undefined,
          notes,
          lineItems: lineItems
            .filter(li => li.inventoryItemId || li.description)
            .map(li => ({
              inventoryItemId: li.inventoryItemId || undefined,
              description: li.description || undefined,
              quantity: parseFloat(li.quantity) || 0,
              unit: li.unit,
              unitCost: parseFloat(li.unitCost) || 0,
            })),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create invoice')
      }

      const data = await res.json()
      const invoiceId = data.data.invoice.id

      if (andPost) {
        // Post immediately
        const postRes = await fetch(`/api/invoices/${invoiceId}/post`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locationId, requestingEmployeeId: employee.id }),
        })
        if (!postRes.ok) {
          const err = await postRes.json()
          throw new Error(err.error || 'Invoice saved but failed to post')
        }
        const postData = await postRes.json()
        const result = postData.data
        toast.success(
          `Invoice posted. ${result.costsUpdated} costs updated, ${result.recipesRecalculated} recipes recalculated.`
        )
      } else {
        toast.success('Invoice saved as draft')
      }

      router.push('/invoices')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save invoice')
    } finally {
      setIsSaving(false)
    }
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title={editId ? (isReadOnly ? 'View Invoice' : 'Edit Invoice') : 'New Invoice'}
        breadcrumbs={[
          { label: 'Inventory', href: '/inventory' },
          { label: 'Invoices', href: '/invoices' },
        ]}
        backHref="/invoices"
      />

      {/* Invoice Info */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Invoice Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Vendor</label>
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                disabled={isReadOnly}
              >
                <option value="">Select vendor...</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Invoice #</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="e.g., INV-001234"
                disabled={isReadOnly}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Invoice Date *</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                disabled={isReadOnly}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Delivery Date</label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                disabled={isReadOnly}
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm text-gray-600 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              rows={2}
              placeholder="Optional notes..."
              disabled={isReadOnly}
            />
          </div>
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Line Items</CardTitle>
            {!isReadOnly && (
              <Button variant="outline" size="sm" onClick={addLineItem}>
                + Add Item
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 px-1">
              <div className="col-span-4">Item</div>
              <div className="col-span-2">Quantity</div>
              <div className="col-span-1">Unit</div>
              <div className="col-span-2">Unit Cost</div>
              <div className="col-span-2 text-right">Total</div>
              <div className="col-span-1" />
            </div>

            {lineItems.map((li, idx) => {
              const qty = parseFloat(li.quantity) || 0
              const cost = parseFloat(li.unitCost) || 0
              const lineTotal = qty * cost
              const costChangePct = li.previousCost && li.previousCost > 0 && cost > 0
                ? ((cost - li.previousCost) / li.previousCost) * 100
                : null

              return (
                <div key={li.key} className="grid grid-cols-12 gap-2 items-start">
                  {/* Item selector */}
                  <div className="col-span-4 relative">
                    {li.inventoryItemId ? (
                      <div className="border rounded px-3 py-2 text-sm bg-gray-50 flex items-center justify-between">
                        <span className="truncate">{li.inventoryItemName}</span>
                        {!isReadOnly && (
                          <button
                            onClick={() => updateLineItem(li.key, 'inventoryItemId', '')}
                            className="text-gray-400 hover:text-gray-600 ml-2 shrink-0"
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    ) : (
                      <div>
                        <input
                          type="text"
                          value={activeSearchIndex === idx ? searchQuery : li.description}
                          onChange={(e) => {
                            setActiveSearchIndex(idx)
                            setSearchQuery(e.target.value)
                            updateLineItem(li.key, 'description', e.target.value)
                          }}
                          onFocus={() => setActiveSearchIndex(idx)}
                          onBlur={() => setTimeout(() => setActiveSearchIndex(null), 200)}
                          className="w-full border rounded px-3 py-2 text-sm"
                          placeholder="Search inventory or type description..."
                          disabled={isReadOnly}
                        />
                        {activeSearchIndex === idx && searchQuery && filteredInventoryItems.length > 0 && (
                          <div className="absolute z-20 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {filteredInventoryItems.map(item => (
                              <button
                                key={item.id}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => selectInventoryItem(li.key, item)}
                              >
                                <span>{item.name}</span>
                                <span className="text-xs text-gray-400">
                                  ${item.purchaseCost.toFixed(2)}/{item.purchaseUnit}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Quantity */}
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={li.quantity}
                      onChange={(e) => updateLineItem(li.key, 'quantity', e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm"
                      placeholder="0"
                      min="0"
                      step="any"
                      disabled={isReadOnly}
                    />
                  </div>

                  {/* Unit */}
                  <div className="col-span-1">
                    <input
                      type="text"
                      value={li.unit}
                      onChange={(e) => updateLineItem(li.key, 'unit', e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm text-gray-600"
                      disabled={isReadOnly}
                    />
                  </div>

                  {/* Unit Cost */}
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={li.unitCost}
                      onChange={(e) => updateLineItem(li.key, 'unitCost', e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm"
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      disabled={isReadOnly}
                    />
                    {li.previousCost !== null && li.previousCost > 0 && (
                      <div className="mt-0.5 flex items-center gap-1">
                        <span className="text-xs text-gray-400">
                          Was: ${li.previousCost.toFixed(2)}
                        </span>
                        {costChangePct !== null && Math.abs(costChangePct) > 0.5 && (
                          <span className={`text-xs font-medium px-1 rounded ${
                            costChangePct > 5 ? 'bg-red-100 text-red-700' :
                            costChangePct < -5 ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {costChangePct > 0 ? '↑' : '↓'}{Math.abs(costChangePct).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Line Total */}
                  <div className="col-span-2 text-right py-2">
                    <span className="text-sm font-medium">
                      ${lineTotal.toFixed(2)}
                    </span>
                  </div>

                  {/* Remove */}
                  <div className="col-span-1 text-center py-2">
                    {!isReadOnly && lineItems.length > 1 && (
                      <button
                        onClick={() => removeLineItem(li.key)}
                        className="text-gray-400 hover:text-red-500 text-lg"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Summary + Actions */}
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">
          Total: <span className="text-blue-600">${subtotal.toFixed(2)}</span>
        </div>

        {!isReadOnly && (
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => router.push('/invoices')}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSave(false)}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={() => handleSave(true)}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save & Post'}
            </Button>
          </div>
        )}

        {isReadOnly && (
          <Button
            variant="outline"
            onClick={() => router.push('/invoices')}
          >
            Back to Invoices
          </Button>
        )}
      </div>
    </div>
  )
}
