'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TierModifier {
  id: string
  name: string
  price: number
}

interface CakeTier {
  id: string
  tierNumber: number
  size: string
  flavor: string
  filling: string | null
  frosting: string | null
  shape: string | null
  servings: number | null
  notes: string | null
  modifiers: TierModifier[]
}

interface CakePayment {
  id: string
  type: string
  amount: number
  status: string
  paidAt: string | null
  createdAt: string
}

interface TimelineEntry {
  id: string
  action: string
  note: string | null
  employeeName: string | null
  createdAt: string
}

interface CakeOrderDetail {
  id: string
  orderNumber: number
  status: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  eventDate: string
  eventTime: string | null
  deliveryAddress: string | null
  deliveryNotes: string | null
  allergies: string | null
  cakeMessage: string | null
  notes: string | null
  subtotal: number | null
  rushFee: number | null
  setupFee: number | null
  deliveryFee: number | null
  taxTotal: number | null
  total: number | null
  depositRequired: number | null
  depositPaid: number
  quoteExpiresAt: string | null
  tiers: CakeTier[]
  payments: CakePayment[]
  timeline: TimelineEntry[]
  createdAt: string
  updatedAt: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  quoted: 'Quoted',
  approved: 'Approved',
  deposit_paid: 'Deposit Paid',
  in_production: 'In Production',
  ready: 'Ready',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-gray-100 text-gray-800',
  quoted: 'bg-blue-100 text-blue-800',
  approved: 'bg-purple-100 text-purple-800',
  deposit_paid: 'bg-indigo-100 text-indigo-800',
  in_production: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  delivered: 'bg-teal-100 text-teal-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
}

// Status → possible actions
const STATUS_ACTIONS: Record<string, Array<{ label: string; action: string; variant: 'primary' | 'outline' | 'danger' }>> = {
  submitted: [
    { label: 'Create Quote', action: 'create_quote', variant: 'primary' },
  ],
  quoted: [
    { label: 'Approve', action: 'approve', variant: 'primary' },
  ],
  approved: [
    { label: 'Request Payment', action: 'request_payment', variant: 'primary' },
  ],
  deposit_paid: [
    { label: 'Start Production', action: 'start_production', variant: 'primary' },
  ],
  in_production: [
    { label: 'Mark Ready', action: 'mark_ready', variant: 'primary' },
  ],
  ready: [
    { label: 'Mark Delivered', action: 'mark_delivered', variant: 'primary' },
    { label: 'Mark Completed', action: 'complete', variant: 'outline' },
  ],
  delivered: [
    { label: 'Complete', action: 'complete', variant: 'primary' },
  ],
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CakeOrderDetailPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/settings/cake-orders' })
  const employee = useAuthStore(s => s.employee)
  const params = useParams()
  const router = useRouter()
  const orderId = params.id as string

  const [order, setOrder] = useState<CakeOrderDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const loadOrder = useCallback(async () => {
    try {
      setIsLoading(true)
      const res = await fetch(`/api/cake-orders/${orderId}`)
      if (!res.ok) throw new Error('Failed to load order')
      const json = await res.json()
      const data = json.data as CakeOrderDetail
      setOrder(data)
      setNotes(data.notes || '')
      setNotesDirty(false)
    } catch {
      toast.error('Failed to load cake order')
    } finally {
      setIsLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    if (hydrated && orderId) loadOrder()
  }, [hydrated, orderId, loadOrder])

  // Socket-driven auto-refresh for real-time updates
  const cakeEvents = useMemo(() => ['cake-orders:updated', 'cake-orders:list-changed'], [])
  useReportAutoRefresh({
    onRefresh: loadOrder,
    events: cakeEvents,
    debounceMs: 2000,
    enabled: hydrated && !!orderId,
  })

  const performAction = async (action: string) => {
    if (!order) return
    try {
      setIsSubmitting(true)
      const res = await fetch(`/api/cake-orders/${order.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, employeeId: employee?.id }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || 'Action failed')
      }
      toast.success('Order updated')
      loadOrder()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const saveNotes = async () => {
    if (!order) return
    try {
      const res = await fetch(`/api/cake-orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, employeeId: employee?.id }),
      })
      if (!res.ok) throw new Error('Failed to save notes')
      setNotesDirty(false)
      toast.success('Notes saved')
    } catch {
      toast.error('Failed to save notes')
    }
  }

  const cancelOrder = async () => {
    if (!order) return
    try {
      setIsSubmitting(true)
      const res = await fetch(`/api/cake-orders/${order.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason: cancelReason, employeeId: employee?.id }),
      })
      if (!res.ok) throw new Error('Failed to cancel order')
      setShowCancelModal(false)
      setCancelReason('')
      toast.success('Order cancelled')
      loadOrder()
    } catch {
      toast.error('Failed to cancel order')
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <AdminPageHeader
          title="Cake Order"
          subtitle="Loading..."
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Cake Orders', href: '/settings/cake-orders' },
          ]}
          backHref="/settings/cake-orders"
        />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <AdminPageHeader
          title="Order Not Found"
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Cake Orders', href: '/settings/cake-orders' },
          ]}
          backHref="/settings/cake-orders"
        />
        <div className="max-w-4xl mx-auto mt-6">
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
            This cake order could not be found.
          </div>
        </div>
      </div>
    )
  }

  const actions = STATUS_ACTIONS[order.status] || []

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title={`CK-${order.orderNumber}`}
        subtitle={`${order.customerName} — ${formatDate(order.eventDate)}`}
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Cake Orders', href: '/settings/cake-orders' },
        ]}
        backHref="/settings/cake-orders"
      />

      <div className="max-w-4xl mx-auto mt-6 space-y-6">
        {/* Status + Actions Bar */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center justify-between gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-800'}`}>
            {STATUS_LABELS[order.status] || order.status}
          </span>
          <div className="flex flex-wrap gap-2">
            {actions.map(a => (
              <Button
                key={a.action}
                variant={a.variant === 'danger' ? 'danger' : a.variant === 'primary' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => performAction(a.action)}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Processing...' : a.label}
              </Button>
            ))}
            {!['completed', 'cancelled'].includes(order.status) && (
              <Button variant="danger" size="sm" onClick={() => setShowCancelModal(true)}>
                Cancel Order
              </Button>
            )}
          </div>
        </div>

        {/* Customer Info */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Customer</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-gray-500">Name</div>
                <div className="text-sm font-medium text-gray-900">{order.customerName}</div>
              </div>
              {order.customerPhone && (
                <div>
                  <div className="text-xs text-gray-500">Phone</div>
                  <div className="text-sm font-medium text-gray-900">{order.customerPhone}</div>
                </div>
              )}
              {order.customerEmail && (
                <div>
                  <div className="text-xs text-gray-500">Email</div>
                  <div className="text-sm font-medium text-gray-900">{order.customerEmail}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-gray-500">Event Date</div>
                <div className="text-sm font-medium text-gray-900">{formatDate(order.eventDate)}</div>
              </div>
              {order.eventTime && (
                <div>
                  <div className="text-xs text-gray-500">Event Time</div>
                  <div className="text-sm font-medium text-gray-900">{order.eventTime}</div>
                </div>
              )}
              {order.deliveryAddress && (
                <div className="col-span-2">
                  <div className="text-xs text-gray-500">Delivery Address</div>
                  <div className="text-sm font-medium text-gray-900">{order.deliveryAddress}</div>
                </div>
              )}
            </div>
            {order.allergies && (
              <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <div className="text-xs font-semibold text-red-700">Allergies</div>
                <div className="text-sm text-red-800">{order.allergies}</div>
              </div>
            )}
            {order.cakeMessage && (
              <div className="mt-3">
                <div className="text-xs text-gray-500">Cake Message</div>
                <div className="text-sm font-medium text-gray-900 italic">&quot;{order.cakeMessage}&quot;</div>
              </div>
            )}
          </div>

          {/* Tiers / Cake Configuration */}
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Cake Configuration ({order.tiers.length} {order.tiers.length === 1 ? 'tier' : 'tiers'})
            </h3>
            <div className="space-y-4">
              {order.tiers.map(tier => (
                <div key={tier.id} className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-900">Tier {tier.tierNumber}</span>
                    <span className="text-xs text-gray-500">{tier.size} {tier.shape && `(${tier.shape})`}</span>
                    {tier.servings && (
                      <span className="text-xs text-gray-500">| {tier.servings} servings</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500">Flavor:</span>{' '}
                      <span className="text-gray-900">{tier.flavor}</span>
                    </div>
                    {tier.filling && (
                      <div>
                        <span className="text-gray-500">Filling:</span>{' '}
                        <span className="text-gray-900">{tier.filling}</span>
                      </div>
                    )}
                    {tier.frosting && (
                      <div>
                        <span className="text-gray-500">Frosting:</span>{' '}
                        <span className="text-gray-900">{tier.frosting}</span>
                      </div>
                    )}
                  </div>
                  {tier.modifiers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tier.modifiers.map(mod => (
                        <span key={mod.id} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-white border border-gray-200 text-gray-700">
                          {mod.name}
                          {mod.price > 0 && <span className="ml-1 text-gray-400">+{formatCurrency(mod.price)}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  {tier.notes && (
                    <div className="mt-2 text-xs text-gray-600 italic">{tier.notes}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Quote / Financials */}
          {order.total != null && (
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Quote</h3>
              <div className="max-w-xs ml-auto space-y-1 text-sm">
                {order.subtotal != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="text-gray-900">{formatCurrency(Number(order.subtotal))}</span>
                  </div>
                )}
                {Number(order.rushFee) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Rush Fee</span>
                    <span className="text-gray-900">{formatCurrency(Number(order.rushFee))}</span>
                  </div>
                )}
                {Number(order.setupFee) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Setup Fee</span>
                    <span className="text-gray-900">{formatCurrency(Number(order.setupFee))}</span>
                  </div>
                )}
                {Number(order.deliveryFee) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Delivery Fee</span>
                    <span className="text-gray-900">{formatCurrency(Number(order.deliveryFee))}</span>
                  </div>
                )}
                {order.taxTotal != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax</span>
                    <span className="text-gray-900">{formatCurrency(Number(order.taxTotal))}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-2 border-t border-gray-200">
                  <span>Total</span>
                  <span>{formatCurrency(Number(order.total))}</span>
                </div>
                {order.depositRequired != null && Number(order.depositRequired) > 0 && (
                  <div className="flex justify-between text-xs pt-1">
                    <span className="text-gray-500">Deposit</span>
                    <span className={Number(order.depositPaid) >= Number(order.depositRequired) ? 'text-green-600' : 'text-amber-600'}>
                      {formatCurrency(Number(order.depositPaid))} / {formatCurrency(Number(order.depositRequired))}
                    </span>
                  </div>
                )}
                {order.quoteExpiresAt && (
                  <div className="flex justify-between text-xs pt-1">
                    <span className="text-gray-500">Quote Expires</span>
                    <span className="text-gray-700">{formatDate(order.quoteExpiresAt)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Payments */}
          {order.payments.length > 0 && (
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Payments</h3>
              <div className="space-y-2">
                {order.payments.map(pmt => (
                  <div key={pmt.id} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                    <div>
                      <span className="font-medium text-gray-900 capitalize">{pmt.type.replace(/_/g, ' ')}</span>
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                        pmt.status === 'completed' ? 'bg-green-50 text-green-700'
                          : pmt.status === 'pending' ? 'bg-yellow-50 text-yellow-700'
                          : 'bg-gray-50 text-gray-600'
                      }`}>
                        {pmt.status}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-medium text-gray-900">{formatCurrency(Number(pmt.amount))}</span>
                      {pmt.paidAt && (
                        <div className="text-xs text-gray-500">{new Date(pmt.paidAt).toLocaleDateString()}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes (editable) */}
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Notes</h3>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setNotesDirty(true) }}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Add internal notes about this order..."
            />
            {notesDirty && (
              <div className="flex justify-end mt-2">
                <Button variant="outline" size="sm" onClick={saveNotes}>
                  Save Notes
                </Button>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="p-6 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Timeline</h3>
            {order.timeline.length === 0 ? (
              <div className="text-sm text-gray-500">No activity yet.</div>
            ) : (
              <div className="space-y-3">
                {order.timeline.map(entry => (
                  <div key={entry.id} className="flex gap-3 text-sm">
                    <div className="w-2 h-2 mt-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                    <div>
                      <div className="text-gray-900">
                        <span className="font-medium capitalize">{entry.action.replace(/_/g, ' ')}</span>
                        {entry.employeeName && <span className="text-gray-500"> by {entry.employeeName}</span>}
                      </div>
                      {entry.note && <div className="text-gray-600 text-xs">{entry.note}</div>}
                      <div className="text-xs text-gray-400">{new Date(entry.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cancel Modal */}
      <Modal isOpen={showCancelModal} onClose={() => setShowCancelModal(false)} title="Cancel Cake Order" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to cancel order <span className="font-semibold">CK-{order.orderNumber}</span> for{' '}
            <span className="font-semibold">{order.customerName}</span>?
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Cancellation Reason</label>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Enter reason for cancellation..."
            />
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-gray-200">
            <Button variant="outline" onClick={() => setShowCancelModal(false)}>
              Keep Order
            </Button>
            <Button variant="danger" onClick={cancelOrder} disabled={isSubmitting || !cancelReason.trim()}>
              {isSubmitting ? 'Cancelling...' : 'Cancel Order'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
