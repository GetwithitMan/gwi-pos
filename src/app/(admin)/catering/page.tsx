'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CateringItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
  volumeDiscountPct: number
  discountedLineTotal: number
  specialInstructions: string | null
}

interface CateringOrder {
  id: string
  locationId: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  eventDate: string
  eventTime: string | null
  guestCount: number
  deliveryAddress: string | null
  notes: string | null
  status: string
  subtotal: number
  volumeDiscount: number
  serviceFee: number
  deliveryFee: number
  taxTotal: number
  total: number
  depositRequired: number
  depositPaid: number
  items: CateringItem[]
  createdAt: string
  quotedAt: string | null
  confirmedAt: string | null
  prepStartedAt: string | null
  deliveredAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

const STATUS_LABELS: Record<string, string> = {
  inquiry: 'Inquiry',
  quoted: 'Quoted',
  confirmed: 'Confirmed',
  in_preparation: 'In Prep',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATUS_COLORS: Record<string, string> = {
  inquiry: 'bg-gray-100 text-gray-800',
  quoted: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-indigo-100 text-indigo-800',
  in_preparation: 'bg-amber-100 text-amber-800',
  delivered: 'bg-teal-100 text-teal-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

const NEXT_STATUS: Record<string, { label: string; status: string } | null> = {
  inquiry: { label: 'Send Quote', status: 'quoted' },
  quoted: { label: 'Confirm Order', status: 'confirmed' },
  confirmed: { label: 'Start Prep', status: 'in_preparation' },
  in_preparation: { label: 'Mark Delivered', status: 'delivered' },
  delivered: { label: 'Complete', status: 'completed' },
  completed: null,
  cancelled: null,
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CateringPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/catering' })
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)

  const [orders, setOrders] = useState<CateringOrder[]>([])
  const [selectedOrder, setSelectedOrder] = useState<CateringOrder | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // New order form state
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    eventDate: '',
    eventTime: '',
    guestCount: 25,
    deliveryAddress: '',
    notes: '',
  })
  const [formItems, setFormItems] = useState<Array<{ name: string; quantity: number; unitPrice: number; specialInstructions: string }>>([
    { name: '', quantity: 1, unitPrice: 0, specialInstructions: '' },
  ])

  const loadOrders = useCallback(async () => {
    if (!locationId) return
    try {
      setIsLoading(true)
      const params = new URLSearchParams({ locationId, limit: '100' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/catering?${params}`)
      if (!res.ok) throw new Error('Failed to load orders')
      const json = await res.json()
      setOrders(json.data.orders)
    } catch {
      toast.error('Failed to load catering orders')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, statusFilter])

  useEffect(() => {
    if (hydrated && locationId) loadOrders()
  }, [hydrated, locationId, loadOrders])

  const loadOrderDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/catering/${id}`)
      if (!res.ok) throw new Error('Failed to load order')
      const json = await res.json()
      setSelectedOrder(json.data)
    } catch {
      toast.error('Failed to load order details')
    }
  }

  const advanceStatus = async (orderId: string, newStatus: string) => {
    try {
      setIsSubmitting(true)
      const res = await fetch(`/api/catering/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, employeeId: employee?.id }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || 'Failed to update status')
      }
      const json = await res.json()
      setSelectedOrder(json.data)
      loadOrders()
      toast.success(`Order moved to ${STATUS_LABELS[newStatus] || newStatus}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setIsSubmitting(false)
    }
  }

  const cancelOrder = async (orderId: string) => {
    if (!confirm('Are you sure you want to cancel this catering order?')) return
    try {
      const res = await fetch(`/api/catering/${orderId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: 'Cancelled by staff', employeeId: employee?.id }),
      })
      if (!res.ok) throw new Error('Failed to cancel order')
      setSelectedOrder(null)
      loadOrders()
      toast.success('Catering order cancelled')
    } catch {
      toast.error('Failed to cancel order')
    }
  }

  const createOrder = async () => {
    if (!locationId) return
    const validItems = formItems.filter(i => i.name.trim() && i.quantity > 0 && i.unitPrice > 0)
    if (!form.customerName.trim() || !form.eventDate || validItems.length === 0) {
      toast.error('Please fill in customer name, event date, and at least one item')
      return
    }
    try {
      setIsSubmitting(true)
      const res = await fetch('/api/catering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          customerName: form.customerName.trim(),
          customerPhone: form.customerPhone.trim() || undefined,
          customerEmail: form.customerEmail.trim() || undefined,
          eventDate: form.eventDate,
          eventTime: form.eventTime || undefined,
          guestCount: form.guestCount,
          deliveryAddress: form.deliveryAddress.trim() || undefined,
          notes: form.notes.trim() || undefined,
          items: validItems.map(i => ({
            name: i.name.trim(),
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            specialInstructions: i.specialInstructions.trim() || undefined,
          })),
          employeeId: employee?.id,
        }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || 'Failed to create order')
      }
      setShowCreateModal(false)
      setForm({ customerName: '', customerPhone: '', customerEmail: '', eventDate: '', eventTime: '', guestCount: 25, deliveryAddress: '', notes: '' })
      setFormItems([{ name: '', quantity: 1, unitPrice: 0, specialInstructions: '' }])
      loadOrders()
      toast.success('Catering order created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create order')
    } finally {
      setIsSubmitting(false)
    }
  }

  const addFormItem = () => {
    setFormItems(prev => [...prev, { name: '', quantity: 1, unitPrice: 0, specialInstructions: '' }])
  }

  const updateFormItem = (idx: number, field: string, value: string | number) => {
    setFormItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  const removeFormItem = (idx: number) => {
    if (formItems.length <= 1) return
    setFormItems(prev => prev.filter((_, i) => i !== idx))
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Catering Orders"
        subtitle="Manage catering inquiries, quotes, and fulfillment"
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            + New Catering Order
          </Button>
        }
      />

      <div className="max-w-7xl mx-auto mt-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
            {['all', 'inquiry', 'quoted', 'confirmed', 'in_preparation', 'delivered', 'completed'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === s ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {s === 'all' ? 'All' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Orders List */}
          <div className="lg:col-span-1 space-y-2">
            {isLoading ? (
              <div className="bg-white rounded-xl border p-8 text-center text-gray-500">Loading...</div>
            ) : orders.length === 0 ? (
              <div className="bg-white rounded-xl border p-8 text-center text-gray-500">
                No catering orders found.
              </div>
            ) : (
              orders.map(order => (
                <button
                  key={order.id}
                  onClick={() => loadOrderDetail(order.id)}
                  className={`w-full text-left bg-white rounded-xl border p-4 transition-colors hover:border-indigo-300 ${
                    selectedOrder?.id === order.id ? 'border-indigo-500 ring-1 ring-indigo-200' : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium text-sm text-gray-900">{order.customerName}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100'}`}>
                      {STATUS_LABELS[order.status] || order.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(order.eventDate)} | {order.guestCount} guests | {formatCurrency(Number(order.total))}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Order Detail */}
          <div className="lg:col-span-2">
            {selectedOrder ? (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-gray-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">{selectedOrder.customerName}</h2>
                      <div className="flex flex-wrap gap-3 mt-1 text-sm text-gray-600">
                        {selectedOrder.customerPhone && <span>{selectedOrder.customerPhone}</span>}
                        {selectedOrder.customerEmail && <span>{selectedOrder.customerEmail}</span>}
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[selectedOrder.status]}`}>
                      {STATUS_LABELS[selectedOrder.status]}
                    </span>
                  </div>
                </div>

                {/* Event Details */}
                <div className="p-6 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Event Details</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-gray-500">Date</div>
                      <div className="text-sm font-medium">{formatDate(selectedOrder.eventDate)}</div>
                    </div>
                    {selectedOrder.eventTime && (
                      <div>
                        <div className="text-xs text-gray-500">Time</div>
                        <div className="text-sm font-medium">{selectedOrder.eventTime}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-gray-500">Guests</div>
                      <div className="text-sm font-medium">{selectedOrder.guestCount}</div>
                    </div>
                    {selectedOrder.deliveryAddress && (
                      <div className="col-span-2">
                        <div className="text-xs text-gray-500">Delivery Address</div>
                        <div className="text-sm font-medium">{selectedOrder.deliveryAddress}</div>
                      </div>
                    )}
                  </div>
                  {selectedOrder.notes && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-500">Notes</div>
                      <div className="text-sm text-gray-700 mt-1">{selectedOrder.notes}</div>
                    </div>
                  )}
                </div>

                {/* Items */}
                <div className="p-6 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Items</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-100">
                        <th className="pb-2 pr-4">Item</th>
                        <th className="pb-2 pr-4 text-right">Qty</th>
                        <th className="pb-2 pr-4 text-right">Unit Price</th>
                        <th className="pb-2 pr-4 text-right">Discount</th>
                        <th className="pb-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items.map((item, idx) => (
                        <tr key={item.id || idx} className="border-b border-gray-50">
                          <td className="py-2 pr-4">
                            <div className="text-gray-900">{item.name}</div>
                            {item.specialInstructions && (
                              <div className="text-xs text-gray-500 italic">{item.specialInstructions}</div>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right">{item.quantity}</td>
                          <td className="py-2 pr-4 text-right">{formatCurrency(Number(item.unitPrice))}</td>
                          <td className="py-2 pr-4 text-right">
                            {Number(item.volumeDiscountPct) > 0 ? (
                              <span className="text-green-600">{Number(item.volumeDiscountPct)}%</span>
                            ) : '-'}
                          </td>
                          <td className="py-2 text-right font-medium">{formatCurrency(Number(item.discountedLineTotal))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Financials */}
                <div className="p-6 border-b border-gray-100">
                  <div className="max-w-xs ml-auto space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Subtotal</span>
                      <span>{formatCurrency(Number(selectedOrder.subtotal))}</span>
                    </div>
                    {Number(selectedOrder.volumeDiscount) > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Volume Discount</span>
                        <span>-{formatCurrency(Number(selectedOrder.volumeDiscount))}</span>
                      </div>
                    )}
                    {Number(selectedOrder.serviceFee) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Service Fee</span>
                        <span>{formatCurrency(Number(selectedOrder.serviceFee))}</span>
                      </div>
                    )}
                    {Number(selectedOrder.deliveryFee) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Delivery Fee</span>
                        <span>{formatCurrency(Number(selectedOrder.deliveryFee))}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600">Tax</span>
                      <span>{formatCurrency(Number(selectedOrder.taxTotal))}</span>
                    </div>
                    <div className="flex justify-between font-bold text-base pt-2 border-t border-gray-200">
                      <span>Total</span>
                      <span>{formatCurrency(Number(selectedOrder.total))}</span>
                    </div>
                    {Number(selectedOrder.depositRequired) > 0 && (
                      <div className="flex justify-between text-xs pt-1">
                        <span className="text-gray-500">Deposit Required</span>
                        <span className={Number(selectedOrder.depositPaid) >= Number(selectedOrder.depositRequired) ? 'text-green-600' : 'text-amber-600'}>
                          {formatCurrency(Number(selectedOrder.depositPaid))} / {formatCurrency(Number(selectedOrder.depositRequired))}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="p-6 flex flex-wrap gap-3">
                  {NEXT_STATUS[selectedOrder.status] && (
                    <Button
                      variant="primary"
                      onClick={() => advanceStatus(selectedOrder.id, NEXT_STATUS[selectedOrder.status]!.status)}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Processing...' : NEXT_STATUS[selectedOrder.status]!.label}
                    </Button>
                  )}
                  {!['completed', 'cancelled'].includes(selectedOrder.status) && (
                    <Button
                      variant="outline"
                      onClick={() => cancelOrder(selectedOrder.id)}
                    >
                      Cancel Order
                    </Button>
                  )}
                </div>

                {/* Timeline */}
                <div className="p-6 bg-gray-50 border-t border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Timeline</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex gap-3">
                      <span className="text-gray-400 w-28 flex-shrink-0">Created</span>
                      <span className="text-gray-700">{new Date(selectedOrder.createdAt).toLocaleString()}</span>
                    </div>
                    {selectedOrder.quotedAt && (
                      <div className="flex gap-3">
                        <span className="text-gray-400 w-28 flex-shrink-0">Quoted</span>
                        <span className="text-gray-700">{new Date(selectedOrder.quotedAt).toLocaleString()}</span>
                      </div>
                    )}
                    {selectedOrder.confirmedAt && (
                      <div className="flex gap-3">
                        <span className="text-gray-400 w-28 flex-shrink-0">Confirmed</span>
                        <span className="text-gray-700">{new Date(selectedOrder.confirmedAt).toLocaleString()}</span>
                      </div>
                    )}
                    {selectedOrder.prepStartedAt && (
                      <div className="flex gap-3">
                        <span className="text-gray-400 w-28 flex-shrink-0">Prep Started</span>
                        <span className="text-gray-700">{new Date(selectedOrder.prepStartedAt).toLocaleString()}</span>
                      </div>
                    )}
                    {selectedOrder.deliveredAt && (
                      <div className="flex gap-3">
                        <span className="text-gray-400 w-28 flex-shrink-0">Delivered</span>
                        <span className="text-gray-700">{new Date(selectedOrder.deliveredAt).toLocaleString()}</span>
                      </div>
                    )}
                    {selectedOrder.completedAt && (
                      <div className="flex gap-3">
                        <span className="text-gray-400 w-28 flex-shrink-0">Completed</span>
                        <span className="text-gray-700">{new Date(selectedOrder.completedAt).toLocaleString()}</span>
                      </div>
                    )}
                    {selectedOrder.cancelledAt && (
                      <div className="flex gap-3">
                        <span className="text-red-400 w-28 flex-shrink-0">Cancelled</span>
                        <span className="text-red-700">
                          {new Date(selectedOrder.cancelledAt).toLocaleString()}
                          {selectedOrder.cancelReason && ` - ${selectedOrder.cancelReason}`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
                Select a catering order to view details, or create a new one.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Catering Order Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="New Catering Order" size="lg">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Customer Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
              <input
                type="text"
                value={form.customerName}
                onChange={e => setForm(p => ({ ...p, customerName: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={form.customerPhone}
                onChange={e => setForm(p => ({ ...p, customerPhone: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="(555) 555-5555"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.customerEmail}
                onChange={e => setForm(p => ({ ...p, customerEmail: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Guest Count *</label>
              <input
                type="number"
                value={form.guestCount}
                onChange={e => setForm(p => ({ ...p, guestCount: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                min={1}
              />
            </div>
          </div>

          {/* Event Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Date *</label>
              <input
                type="date"
                value={form.eventDate}
                onChange={e => setForm(p => ({ ...p, eventDate: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Time</label>
              <input
                type="time"
                value={form.eventTime}
                onChange={e => setForm(p => ({ ...p, eventTime: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Address</label>
            <input
              type="text"
              value={form.deliveryAddress}
              onChange={e => setForm(p => ({ ...p, deliveryAddress: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder="Leave blank for pickup"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              rows={2}
              placeholder="Dietary restrictions, setup instructions, etc."
            />
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Items *</label>
              <button
                onClick={addFormItem}
                className="text-xs text-indigo-600 font-medium hover:text-indigo-700"
              >
                + Add Item
              </button>
            </div>
            <div className="space-y-2">
              {formItems.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <input
                    type="text"
                    value={item.name}
                    onChange={e => updateFormItem(idx, 'name', e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                    placeholder="Item name"
                  />
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={e => updateFormItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                    className="w-20 px-3 py-2 border rounded-lg text-sm text-right"
                    placeholder="Qty"
                    min={1}
                  />
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      value={item.unitPrice || ''}
                      onChange={e => updateFormItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                      className="w-24 pl-7 pr-3 py-2 border rounded-lg text-sm text-right"
                      placeholder="Price"
                      step="0.01"
                    />
                  </div>
                  {formItems.length > 1 && (
                    <button
                      onClick={() => removeFormItem(idx)}
                      className="px-2 py-2 text-red-400 hover:text-red-600"
                    >
                      X
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Volume discounts: 10+ items = 10% off, 25+ = 15% off, 50+ = 20% off (per line item)
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-2 justify-end pt-4 border-t">
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={createOrder} disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Order'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
