'use client'

import { useState, useEffect } from 'react'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'
import TipEntryRow from '@/components/tips/TipEntryRow'

interface ClosedOrder {
  id: string
  orderNumber: number
  tabName: string | null
  total: number
  tipTotal: number
  closedAt: string | null
  employee: { id: string; name: string }
  payments: {
    id: string
    amount: number
    tipAmount: number
    totalAmount: number
    paymentMethod: string
    cardBrand: string | null
    cardLast4: string | null
  }[]
  needsTip: boolean
  hasCardPayment: boolean
}

type DatePreset = 'today' | 'yesterday' | 'this_week'

function toLocalDateString(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDateRange(preset: DatePreset) {
  const now = new Date()
  if (preset === 'today') {
    return { dateFrom: toLocalDateString(now) }
  }
  if (preset === 'yesterday') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    return { dateFrom: toLocalDateString(y), dateTo: toLocalDateString(y) }
  }
  const start = new Date(now)
  start.setDate(start.getDate() - start.getDay())
  return { dateFrom: toLocalDateString(start) }
}

interface TipAdjustmentOverlayProps {
  isOpen: boolean
  onClose: () => void
  locationId?: string
  employeeId?: string
}

export default function TipAdjustmentOverlay({ isOpen, onClose, locationId, employeeId }: TipAdjustmentOverlayProps) {
  const [orders, setOrders] = useState<ClosedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [datePreset, setDatePreset] = useState<DatePreset>('today')
  const [showAll, setShowAll] = useState(false)
  const [tipEdits, setTipEdits] = useState<Record<string, { paymentId: string; amount: number }>>({})
  const [statuses, setStatuses] = useState<Record<string, 'pending' | 'adjusted' | 'error'>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  async function doFetch(loc: string, preset: DatePreset, cursorVal: string | null, append: boolean) {
    setLoading(true)
    try {
      const { dateFrom, dateTo } = getDateRange(preset)
      const params = new URLSearchParams({
        locationId: loc,
        tipStatus: showAll ? 'all' : 'needs_tip',
        sortBy: 'newest',
        limit: '50',
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
        ...(cursorVal ? { cursor: cursorVal } : {}),
      })
      const res = await fetch(`/api/orders/closed?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const raw = await res.json()
      const data = raw.data ?? raw
      setOrders(prev => append ? [...prev, ...data.orders] : data.orders)
      setCursor(data.pagination.nextCursor)
      setHasMore(data.pagination.hasMore)
    } catch {
      toast.error('Failed to load closed orders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen || !locationId) return
    setCursor(null)
    setTipEdits({})
    setStatuses({})
    setErrors({})
    doFetch(locationId, datePreset, null, false)
  }, [isOpen, datePreset, showAll, locationId])

  function handleLoadMore() {
    if (locationId && cursor) {
      doFetch(locationId, datePreset, cursor, true)
    }
  }

  function handleTipChange(orderId: string, paymentId: string, amount: number) {
    setTipEdits(prev => ({ ...prev, [orderId]: { paymentId, amount } }))
  }

  const editedCount = Object.values(tipEdits).filter(e => e.amount > 0).length
  const totalTipsEntered = Object.values(tipEdits).reduce((sum, e) => sum + e.amount, 0)

  async function handleSaveAll() {
    if (!employeeId || editedCount === 0) return
    setSaving(true)

    const adjustments = Object.entries(tipEdits)
      .filter(([, e]) => e.amount > 0)
      .map(([orderId, e]) => ({
        orderId,
        paymentId: e.paymentId,
        tipAmount: e.amount,
      }))

    try {
      const res = await fetch('/api/orders/batch-adjust-tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustments, employeeId }),
      })

      if (!res.ok) throw new Error('Failed to save')
      const raw = await res.json()
      const data = raw.data ?? raw

      const newStatuses: Record<string, 'pending' | 'adjusted' | 'error'> = {}
      const newErrors: Record<string, string> = {}

      adjustments.forEach(adj => {
        const err = data.data.errors?.find((e: { orderId: string }) => e.orderId === adj.orderId)
        if (err) {
          newStatuses[adj.orderId] = 'error'
          newErrors[adj.orderId] = err.error
        } else {
          newStatuses[adj.orderId] = 'adjusted'
        }
      })

      setStatuses(prev => ({ ...prev, ...newStatuses }))
      setErrors(prev => ({ ...prev, ...newErrors }))

      const errCount = data.data.errors?.length || 0
      if (errCount === 0) {
        toast.success(`${data.data.adjusted} tips saved — ${formatCurrency(data.data.totalTips)} total`)
      } else {
        toast.warning(`${data.data.adjusted} saved, ${errCount} failed`)
      }
    } catch {
      toast.error('Failed to save tips')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="4xl">
      <div className="-m-5 bg-[rgba(15,15,30,0.98)] overflow-y-auto rounded-b-2xl" style={{ maxHeight: 'calc(90vh - 1rem)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[rgba(15,15,30,0.95)] backdrop-blur-xl border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-white">Tip Adjustments</h1>
              <p className="text-xs text-white/40">{showAll ? 'All card orders' : 'Card orders needing tips'}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Show All toggle */}
            <button
              onClick={() => setShowAll(prev => !prev)}
              className="flex items-center gap-2 text-xs text-white/60"
            >
              <span>{showAll ? 'All Tips' : 'Needs Tip'}</span>
              <div className={`w-9 h-5 rounded-full transition-colors relative ${showAll ? 'bg-indigo-600' : 'bg-white/15'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${showAll ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </button>

            {/* Date preset pills */}
            <div className="flex gap-2">
              {(['today', 'yesterday', 'this_week'] as DatePreset[]).map(preset => (
                <button
                  key={preset}
                  onClick={() => setDatePreset(preset)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    datePreset === preset
                      ? 'bg-indigo-600/40 text-white border border-indigo-500/50'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  {preset === 'today' ? 'Today' : preset === 'yesterday' ? 'Yesterday' : 'This Week'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-4 pb-24">
        {/* Column headers */}
        <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-white/40 uppercase tracking-wider">
          <div className="w-16 text-center">Order</div>
          <div className="flex-1">Tab / Name</div>
          <div className="w-20 text-right">Total</div>
          <div className="w-24 text-center">Card</div>
          <div className="w-28 text-center">Tip</div>
          <div className="w-8" />
        </div>

        {/* Rows */}
        <div className="space-y-2">
          {loading && orders.length === 0 ? (
            <div className="text-center py-16 text-white/40">Loading orders...</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-white/40 text-lg">No orders need tips</div>
              <div className="text-white/30 text-sm mt-1">All card orders have tips entered</div>
            </div>
          ) : (
            orders.map(order => {
              const cardPayment = order.payments.find(p =>
                ['credit', 'debit'].includes(p.paymentMethod)
              )
              if (!cardPayment) return null
              return (
                <TipEntryRow
                  key={order.id}
                  orderId={order.id}
                  orderNumber={order.orderNumber}
                  tabName={order.tabName}
                  total={order.total}
                  cardLast4={cardPayment.cardLast4}
                  cardBrand={cardPayment.cardBrand}
                  paymentId={cardPayment.id}
                  currentTip={cardPayment.tipAmount}
                  employeeName={order.employee.name}
                  closedAt={order.closedAt}
                  onTipChange={handleTipChange}
                  status={statuses[order.id] || 'pending'}
                  errorMessage={errors[order.id]}
                />
              )
            })
          )}
        </div>

        {/* Load more */}
        {hasMore && (
          <div className="text-center py-4">
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm border border-white/10 transition-colors"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      {orders.length > 0 && (
        <div className="sticky bottom-0 z-10 bg-[rgba(15,15,30,0.95)] backdrop-blur-xl border-t border-white/10">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="text-sm text-white/60">
              <span className="font-semibold text-white">{editedCount}</span> tips entered
              <span className="mx-2">·</span>
              <span className="font-semibold text-emerald-400">{formatCurrency(totalTipsEntered)}</span> total
            </div>
            <button
              onClick={handleSaveAll}
              disabled={saving || editedCount === 0}
              className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                editedCount > 0
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving...' : `Save All (${editedCount})`}
            </button>
          </div>
        </div>
      )}
      </div>
    </Modal>
  )
}
