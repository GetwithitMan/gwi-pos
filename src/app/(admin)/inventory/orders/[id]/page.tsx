'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { BarcodeScanField } from '@/components/admin/BarcodeScanField'

interface VendorOrderLineItem {
  id: string
  inventoryItemId: string
  inventoryItemName: string
  quantity: number
  unit: string
  estimatedCost: number
  receivedQty: number
  actualCost: number | null
  inventoryItem?: {
    currentStock: number
    storageUnit?: string
  } | null
}

interface VendorOrderDetail {
  id: string
  orderNumber: string
  vendorId: string
  vendorName: string
  status: string
  orderDate: string
  expectedDelivery: string | null
  notes: string | null
  createdByName: string | null
  linkedInvoiceId: string | null
  lineItems: VendorOrderLineItem[]
  createdAt: string
}

interface ReceiveItem {
  lineItemId: string
  inventoryItemId: string
  itemName: string
  orderedQty: number
  alreadyReceived: number
  remaining: number
  unit: string
  receivedQty: string
  actualCost: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-900',
  sent: 'bg-blue-50 text-blue-700',
  confirmed: 'bg-purple-50 text-purple-700',
  partially_received: 'bg-yellow-50 text-yellow-700',
  received: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

function getLineItemStatus(ordered: number, received: number): { label: string; color: string } {
  if (received <= 0) return { label: 'Not Received', color: 'bg-gray-100 text-gray-600' }
  if (received >= ordered) return { label: 'Fully Received', color: 'bg-green-100 text-green-700' }
  return { label: 'Partially Received', color: 'bg-yellow-100 text-yellow-700' }
}

export default function PurchaseOrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orderId = params.id as string
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: `/login?redirect=/inventory/orders/${orderId}` })
  const locationId = employee?.location?.id

  const [order, setOrder] = useState<VendorOrderDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  // Receive state
  const [receiving, setReceiving] = useState(false)
  const [receiveItems, setReceiveItems] = useState<ReceiveItem[]>([])
  const [receiveNotes, setReceiveNotes] = useState('')
  const [createInvoice, setCreateInvoice] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadOrder = useCallback(async () => {
    if (!locationId || !employee?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ locationId, employeeId: employee.id })
      const res = await fetch(`/api/inventory/orders/${orderId}?${params}`)
      if (res.status === 404) {
        router.replace('/inventory/orders')
        return
      }
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setOrder(data.data?.order || data.data || data)
    } catch {
      setError('Failed to load purchase order')
      toast.error('Failed to load purchase order')
    } finally {
      setIsLoading(false)
    }
  }, [orderId, locationId, employee?.id, router])

  useEffect(() => { loadOrder() }, [loadOrder])

  const openReceivePanel = () => {
    if (!order) return
    const items: ReceiveItem[] = order.lineItems
      .filter(li => li.receivedQty < li.quantity)
      .map(li => ({
        lineItemId: li.id,
        inventoryItemId: li.inventoryItemId,
        itemName: li.inventoryItemName,
        orderedQty: li.quantity,
        alreadyReceived: li.receivedQty,
        remaining: li.quantity - li.receivedQty,
        unit: li.unit,
        receivedQty: '',
        actualCost: li.actualCost !== null ? String(li.actualCost) : li.estimatedCost ? String(li.estimatedCost) : '',
      }))
    setReceiveItems(items)
    setReceiveNotes('')
    setCreateInvoice(false)
    setReceiving(true)
  }

  const handleSubmitOrder = async () => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(`/api/inventory/orders/${orderId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, employeeId: employee.id }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to submit')
      }
      toast.success('Purchase order submitted to vendor')
      loadOrder()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit order')
    }
  }

  const handleCancelOrder = async () => {
    if (!locationId || !employee?.id) return
    if (!confirm('Are you sure you want to cancel this purchase order?')) return
    try {
      const res = await fetch(`/api/inventory/orders/${orderId}?locationId=${locationId}&employeeId=${employee.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to cancel')
      }
      toast.success('Purchase order cancelled')
      router.push('/inventory/orders')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel order')
    }
  }

  const handleReceiveSubmit = async () => {
    if (!locationId || !employee?.id) return
    const itemsToReceive = receiveItems.filter(ri => ri.receivedQty && parseFloat(ri.receivedQty) > 0)
    if (itemsToReceive.length === 0) {
      toast.error('Enter quantities for at least one item')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/inventory/orders/${orderId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: employee.id,
          notes: receiveNotes || undefined,
          createInvoice,
          items: itemsToReceive.map(ri => ({
            lineItemId: ri.lineItemId,
            receivedQty: parseFloat(ri.receivedQty),
            actualCost: ri.actualCost ? parseFloat(ri.actualCost) : undefined,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to record receipt')
      }

      toast.success('Shipment received successfully')
      setReceiving(false)
      loadOrder()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record receipt')
    } finally {
      setSubmitting(false)
    }
  }

  const updateReceiveItem = (index: number, field: 'receivedQty' | 'actualCost', value: string) => {
    setReceiveItems(prev => prev.map((ri, i) =>
      i === index ? { ...ri, [field]: value } : ri
    ))
  }

  const estimatedTotal = order?.lineItems.reduce((sum, li) => sum + (li.quantity * li.estimatedCost), 0) ?? 0

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <Card>
          <CardContent className="p-8 text-center text-gray-900">Loading...</CardContent>
        </Card>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <Card>
          <CardContent className="p-8 text-center text-red-500">
            {error || 'Purchase order not found'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const canReceive = ['draft', 'sent', 'confirmed', 'partially_received'].includes(order.status)

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <Link href="/inventory/orders" className="text-sm text-blue-600 hover:underline mb-2 inline-block">
          &larr; Purchase Orders
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900">PO #{order.orderNumber}</h1>
          <span className={`inline-block px-3 py-1 rounded text-sm font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100'}`}>
            {order.status.replace('_', ' ')}
          </span>
          <span className="text-gray-900 text-sm">{order.vendorName}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        {order.status === 'draft' && (
          <Button onClick={handleSubmitOrder}>
            Submit to Vendor
          </Button>
        )}
        {canReceive && (
          <Button variant="outline" onClick={openReceivePanel}>
            Receive Shipment
          </Button>
        )}
        {order.status === 'draft' && (
          <Button variant="outline" onClick={handleCancelOrder} className="text-red-600 border-red-300 hover:bg-red-50">
            Cancel Order
          </Button>
        )}
      </div>

      {/* PO Info Card */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Order Information</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-900">Vendor</p>
              <p className="font-medium text-gray-900">{order.vendorName}</p>
            </div>
            <div>
              <p className="text-gray-900">Order Date</p>
              <p className="font-medium text-gray-900">{new Date(order.orderDate).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-gray-900">Expected Delivery</p>
              <p className="font-medium text-gray-900">
                {order.expectedDelivery ? new Date(order.expectedDelivery).toLocaleDateString() : '—'}
              </p>
            </div>
            <div>
              <p className="text-gray-900">Created By</p>
              <p className="font-medium text-gray-900">{order.createdByName || '—'}</p>
            </div>
            {order.notes && (
              <div className="col-span-full">
                <p className="text-gray-900">Notes</p>
                <p className="font-medium text-gray-900">{order.notes}</p>
              </div>
            )}
          </div>
          {order.linkedInvoiceId && (
            <div className="mt-3 pt-3 border-t">
              <Link href={`/invoices/new?edit=${order.linkedInvoiceId}`} className="text-blue-600 hover:underline text-sm">
                View Linked Invoice &rarr;
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Line Items Table */}
      <Card className="mb-6">
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h2 className="font-semibold text-gray-900">Line Items</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Item</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">On Hand</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Ordered Qty</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Unit</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Est. Cost/Unit</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Received Qty</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {order.lineItems.map(li => {
                  const status = getLineItemStatus(li.quantity, li.receivedQty)
                  return (
                    <tr key={li.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {li.inventoryItemName}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 text-xs">
                        {li.inventoryItem?.currentStock != null
                          ? `${li.inventoryItem.currentStock} ${li.inventoryItem?.storageUnit ?? ''}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {li.quantity}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">
                        {li.unit}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {formatCurrency(li.estimatedCost)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        <span className={li.receivedQty > 0 ? 'text-green-700' : 'text-gray-900'}>
                          {li.receivedQty}
                        </span>
                        <span className="text-gray-900"> / {li.quantity}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2">
                <tr>
                  <td colSpan={4} className="px-4 py-3 font-semibold text-gray-900 text-right">
                    Estimated Total
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">
                    {formatCurrency(estimatedTotal)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Receive Shipment Panel */}
      {receiving && (
        <Card className="mb-6 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Receive Shipment</h2>
              <button onClick={() => setReceiving(false)} className="text-gray-900 hover:text-gray-600 text-lg">
                &times;
              </button>
            </div>

            {receiveItems.length === 0 ? (
              <p className="text-gray-900 text-sm py-4 text-center">All items have been fully received.</p>
            ) : (
              <>
                {/* Barcode Scan */}
                <div className="mb-4 p-3 bg-blue-50/50 rounded-lg">
                  <label className="block text-xs font-medium text-gray-900 mb-1">Scan Barcode to Find Line Item</label>
                  <BarcodeScanField
                    locationId={locationId || ''}
                    placeholder="Scan barcode to jump to line item..."
                    onResult={(result) => {
                      if (!result.inventoryItem) {
                        toast.warning('Scanned item is not an inventory item')
                        return
                      }
                      const idx = receiveItems.findIndex(
                        ri => ri.inventoryItemId === result.inventoryItem!.id
                      )
                      if (idx === -1) {
                        toast.warning('Item not in this purchase order')
                        return
                      }
                      // Pre-fill with packSize if case barcode
                      if (result.packSize > 1) {
                        updateReceiveItem(idx, 'receivedQty', String(result.packSize))
                        toast.success(`${result.inventoryItem.name} — pre-filled with pack size ${result.packSize}`)
                      } else {
                        toast.success(`Found: ${result.inventoryItem.name}`)
                      }
                      // Focus the receive qty input
                      setTimeout(() => {
                        const inputs = document.querySelectorAll<HTMLInputElement>('table input[type="number"]')
                        // Each row has 2 inputs (receivedQty, actualCost), so the receive input is at idx * 2
                        inputs[idx * 2]?.focus()
                        inputs[idx * 2]?.select()
                      }, 100)
                    }}
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">Item</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600">Ordered</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600">Already Received</th>
                        <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Receive Now</th>
                        <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Actual Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {receiveItems.map((ri, idx) => (
                        <tr key={ri.lineItemId}>
                          <td className="px-3 py-2 font-medium text-gray-900">
                            {ri.itemName}
                            <span className="text-xs text-gray-900 ml-1">({ri.unit})</span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">{ri.orderedQty}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{ri.alreadyReceived}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              max={ri.remaining}
                              step="0.01"
                              value={ri.receivedQty}
                              onChange={(e) => updateReceiveItem(idx, 'receivedQty', e.target.value)}
                              placeholder={String(ri.remaining)}
                              className="w-full border rounded px-2 py-1 text-center text-sm"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={ri.actualCost}
                              onChange={(e) => updateReceiveItem(idx, 'actualCost', e.target.value)}
                              className="w-full border rounded px-2 py-1 text-center text-sm"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">Notes</label>
                    <textarea
                      value={receiveNotes}
                      onChange={(e) => setReceiveNotes(e.target.value)}
                      rows={2}
                      placeholder="Delivery notes, discrepancies..."
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={createInvoice}
                      onChange={(e) => setCreateInvoice(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-gray-900">Create invoice from this receipt</span>
                  </label>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setReceiving(false)} disabled={submitting}>
                      Cancel
                    </Button>
                    <Button onClick={handleReceiveSubmit} disabled={submitting}>
                      {submitting ? 'Recording...' : 'Record Receipt'}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
