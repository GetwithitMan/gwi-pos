'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'

// ─── Types ──────────────────────────────────────────────────────────────────

type SplitTab = 'even' | 'by_item' | 'by_seat' | 'custom'

interface OrderSummary {
  id: string
  orderNumber: number
  displayNumber: string | null
  status: string
  total: number
  subtotal: number
  taxTotal: number
  tabName: string | null
  tableId: string | null
  items: OrderItemSummary[]
}

interface OrderItemSummary {
  id: string
  name: string
  price: number
  quantity: number
  itemTotal: number
  seatNumber: number | null
  modifiers: { name: string; price: number }[]
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SplitOrderPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderId = searchParams.get('orderId')

  const employee = useAuthStore((s) => s.employee)
  const locationId = employee?.location?.id

  const [order, setOrder] = useState<OrderSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<SplitTab>('even')
  const [showConfirm, setShowConfirm] = useState(false)

  // Even split state
  const [evenWays, setEvenWays] = useState(2)

  // By-item split state: items assigned to "Split B" (remaining stay in parent)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())

  // Custom amount state
  const [customAmounts, setCustomAmounts] = useState<number[]>([0, 0])

  // ── Fetch order ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!orderId) {
      setLoading(false)
      return
    }

    async function fetchOrder() {
      try {
        const res = await fetch(`/api/orders/${orderId}`)
        if (!res.ok) throw new Error('Failed to fetch order')
        const data = await res.json()
        const o = data.data || data.order || data
        setOrder({
          id: o.id,
          orderNumber: o.orderNumber,
          displayNumber: o.displayNumber || String(o.orderNumber),
          status: o.status,
          total: Number(o.total),
          subtotal: Number(o.subtotal),
          taxTotal: Number(o.taxTotal),
          tabName: o.tabName,
          tableId: o.tableId,
          items: (o.items || [])
            .filter((i: any) => !i.deletedAt)
            .map((i: any) => ({
              id: i.id,
              name: i.name,
              price: Number(i.price),
              quantity: i.quantity,
              itemTotal: Number(i.itemTotal || i.price) * (i.quantity || 1),
              seatNumber: i.seatNumber,
              modifiers: (i.modifiers || []).map((m: any) => ({
                name: m.name,
                price: Number(m.price),
              })),
            })),
        })
      } catch (err) {
        console.error('Failed to load order for split:', err)
        toast.error('Failed to load order')
      } finally {
        setLoading(false)
      }
    }

    void fetchOrder()
  }, [orderId])

  // ── Even split calculations ─────────────────────────────────────────────

  const evenSplitAmount = useMemo(() => {
    if (!order) return 0
    return Math.round((order.total / evenWays) * 100) / 100
  }, [order, evenWays])

  const evenSplitRemainder = useMemo(() => {
    if (!order) return 0
    return Math.round((order.total - evenSplitAmount * evenWays) * 100) / 100
  }, [order, evenSplitAmount, evenWays])

  // ── By-item split calculations ──────────────────────────────────────────

  const toggleItem = useCallback((itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }, [])

  const splitAItems = useMemo(() => {
    if (!order) return []
    return order.items.filter((i) => !selectedItemIds.has(i.id))
  }, [order, selectedItemIds])

  const splitBItems = useMemo(() => {
    if (!order) return []
    return order.items.filter((i) => selectedItemIds.has(i.id))
  }, [order, selectedItemIds])

  const splitATotal = useMemo(
    () => splitAItems.reduce((sum, i) => sum + i.itemTotal, 0),
    [splitAItems]
  )

  const splitBTotal = useMemo(
    () => splitBItems.reduce((sum, i) => sum + i.itemTotal, 0),
    [splitBItems]
  )

  // ── By-seat calculations ────────────────────────────────────────────────

  const seatGroups = useMemo(() => {
    if (!order) return new Map<number, OrderItemSummary[]>()
    const groups = new Map<number, OrderItemSummary[]>()
    for (const item of order.items) {
      const seat = item.seatNumber ?? 0
      if (!groups.has(seat)) groups.set(seat, [])
      groups.get(seat)!.push(item)
    }
    return groups
  }, [order])

  const seatTotals = useMemo(() => {
    const totals = new Map<number, number>()
    for (const [seat, items] of seatGroups) {
      totals.set(seat, items.reduce((sum, i) => sum + i.itemTotal, 0))
    }
    return totals
  }, [seatGroups])

  // ── Custom amount helpers ───────────────────────────────────────────────

  const customRemaining = useMemo(() => {
    if (!order) return 0
    const total = customAmounts.reduce((sum, a) => sum + a, 0)
    return Math.round((order.total - total) * 100) / 100
  }, [order, customAmounts])

  const addCustomSplit = useCallback(() => {
    setCustomAmounts((prev) => [...prev, 0])
  }, [])

  const removeCustomSplit = useCallback((index: number) => {
    setCustomAmounts((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const updateCustomAmount = useCallback((index: number, value: string) => {
    const num = parseFloat(value) || 0
    setCustomAmounts((prev) => {
      const next = [...prev]
      next[index] = Math.max(0, num)
      return next
    })
  }, [])

  // ── Submit split ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!orderId || !order || !employee) return
    setSubmitting(true)

    try {
      let body: Record<string, unknown>

      if (activeTab === 'even') {
        body = {
          type: 'even',
          numWays: evenWays,
          employeeId: employee.id,
        }
      } else if (activeTab === 'by_item') {
        if (selectedItemIds.size === 0) {
          toast.error('Select at least one item to move to the new check')
          setSubmitting(false)
          return
        }
        if (selectedItemIds.size === order.items.length) {
          toast.error('Cannot move all items -- at least one must remain')
          setSubmitting(false)
          return
        }
        body = {
          type: 'by_item',
          itemIds: Array.from(selectedItemIds),
          employeeId: employee.id,
        }
      } else if (activeTab === 'by_seat') {
        body = {
          type: 'by_seat',
          employeeId: employee.id,
        }
      } else {
        // custom_amount -- send the first split amount
        const amount = customAmounts[0]
        if (amount <= 0) {
          toast.error('Enter a split amount greater than $0')
          setSubmitting(false)
          return
        }
        body = {
          type: 'custom_amount',
          amount,
          employeeId: employee.id,
        }
      }

      const res = await fetch(`/api/orders/${orderId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Split failed' }))
        toast.error(err.error || 'Failed to split order')
        setSubmitting(false)
        return
      }

      const result = await res.json()
      const splitData = result.data
      const message =
        splitData?.message ||
        `Order #${order.orderNumber} split successfully`

      toast.success(message)
      router.push('/orders')
    } catch (err) {
      console.error('Split submit error:', err)
      toast.error('An unexpected error occurred')
    } finally {
      setSubmitting(false)
      setShowConfirm(false)
    }
  }, [orderId, order, employee, activeTab, evenWays, selectedItemIds, customAmounts, router])

  // ── Validation ──────────────────────────────────────────────────────────

  const canSubmit = useMemo(() => {
    if (!order || submitting) return false
    if (activeTab === 'even') return evenWays >= 2 && evenWays <= 10
    if (activeTab === 'by_item') return selectedItemIds.size > 0 && selectedItemIds.size < order.items.length
    if (activeTab === 'by_seat') return seatGroups.size >= 2
    if (activeTab === 'custom') return customAmounts[0] > 0 && customRemaining >= 0
    return false
  }, [order, submitting, activeTab, evenWays, selectedItemIds, seatGroups, customAmounts, customRemaining])

  // ── Render ──────────────────────────────────────────────────────────────

  if (!orderId) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Order Selected</h2>
          <p className="text-gray-600 mb-4">Select an order to split from the orders page.</p>
          <Button variant="primary" onClick={() => router.push('/orders')}>
            Back to Orders
          </Button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-600">Loading order...</p>
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Order Not Found</h2>
          <p className="text-gray-600 mb-4">The order may have been closed or deleted.</p>
          <Button variant="primary" onClick={() => router.push('/orders')}>
            Back to Orders
          </Button>
        </div>
      </div>
    )
  }

  const tabs: { key: SplitTab; label: string }[] = [
    { key: 'even', label: 'Even Split' },
    { key: 'by_item', label: 'By Item' },
    { key: 'by_seat', label: 'By Seat' },
    { key: 'custom', label: 'Custom Amount' },
  ]

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/orders')}
            className="text-gray-500 hover:text-gray-900 transition-colors p-1"
            aria-label="Back to orders"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Split Order #{order.displayNumber || order.orderNumber}
            </h1>
            <p className="text-sm text-gray-500">
              {order.tabName ? `${order.tabName} - ` : ''}
              {order.items.length} item{order.items.length !== 1 ? 's' : ''} | Total: {formatCurrency(order.total)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => router.push('/orders')}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            isLoading={submitting}
            onClick={() => setShowConfirm(true)}
          >
            Split Order
          </Button>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-200 px-6 shrink-0">
        <nav className="flex gap-1" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'even' && (
          <EvenSplitPanel
            order={order}
            evenWays={evenWays}
            setEvenWays={setEvenWays}
            splitAmount={evenSplitAmount}
            remainder={evenSplitRemainder}
          />
        )}

        {activeTab === 'by_item' && (
          <ItemSplitPanel
            order={order}
            selectedItemIds={selectedItemIds}
            toggleItem={toggleItem}
            splitAItems={splitAItems}
            splitBItems={splitBItems}
            splitATotal={splitATotal}
            splitBTotal={splitBTotal}
          />
        )}

        {activeTab === 'by_seat' && (
          <SeatSplitPanel
            order={order}
            seatGroups={seatGroups}
            seatTotals={seatTotals}
          />
        )}

        {activeTab === 'custom' && (
          <CustomSplitPanel
            order={order}
            customAmounts={customAmounts}
            remaining={customRemaining}
            onUpdate={updateCustomAmount}
            onAdd={addCustomSplit}
            onRemove={removeCustomSplit}
          />
        )}
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Confirm Split"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            {activeTab === 'even' && `Split order into ${evenWays} even checks of ${formatCurrency(evenSplitAmount)} each?`}
            {activeTab === 'by_item' && `Move ${selectedItemIds.size} item${selectedItemIds.size !== 1 ? 's' : ''} (${formatCurrency(splitBTotal)}) to a new check?`}
            {activeTab === 'by_seat' && `Split order into ${seatGroups.size} checks by seat?`}
            {activeTab === 'custom' && `Create a split for ${formatCurrency(customAmounts[0])}?`}
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowConfirm(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleSubmit}
              isLoading={submitting}
            >
              Confirm Split
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-panels
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Even Split Panel ─────────────────────────────────────────────────────────

function EvenSplitPanel({
  order,
  evenWays,
  setEvenWays,
  splitAmount,
  remainder,
}: {
  order: OrderSummary
  evenWays: number
  setEvenWays: (n: number) => void
  splitAmount: number
  remainder: number
}) {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Number of Checks</h3>
        <div className="flex items-center justify-center gap-4 mb-6">
          <button
            className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-xl font-bold transition-colors disabled:opacity-40"
            onClick={() => setEvenWays(Math.max(2, evenWays - 1))}
            disabled={evenWays <= 2}
          >
            -
          </button>
          <span className="text-5xl font-bold text-gray-900 w-16 text-center tabular-nums">{evenWays}</span>
          <button
            className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-xl font-bold transition-colors disabled:opacity-40"
            onClick={() => setEvenWays(Math.min(10, evenWays + 1))}
            disabled={evenWays >= 10}
          >
            +
          </button>
        </div>

        {/* Quick pick */}
        <div className="flex flex-wrap gap-2 justify-center mb-6">
          {[2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => setEvenWays(n)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                evenWays === n
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {n} ways
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Split Preview</h3>
        <div className="space-y-3">
          {Array.from({ length: evenWays }, (_, i) => {
            const amount = i === 0 && remainder !== 0 ? splitAmount + remainder : splitAmount
            return (
              <div key={i} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">Check {i + 1}</span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(amount)}</span>
              </div>
            )
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between">
          <span className="text-sm font-medium text-gray-500">Order Total</span>
          <span className="text-sm font-bold text-gray-900">{formatCurrency(order.total)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Item Split Panel ─────────────────────────────────────────────────────────

function ItemSplitPanel({
  order,
  selectedItemIds,
  toggleItem,
  splitAItems,
  splitBItems,
  splitATotal,
  splitBTotal,
}: {
  order: OrderSummary
  selectedItemIds: Set<string>
  toggleItem: (id: string) => void
  splitAItems: OrderItemSummary[]
  splitBItems: OrderItemSummary[]
  splitATotal: number
  splitBTotal: number
}) {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <p className="text-sm text-gray-600">
        Tap items to move them to the new check. Unselected items stay on the original.
      </p>
      <div className="grid grid-cols-2 gap-6">
        {/* Original Check */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Original Check</h3>
            <span className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(splitATotal)}</span>
          </div>
          <div className="space-y-2">
            {splitAItems.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-4 text-center">No items remaining</p>
            ) : (
              splitAItems.map((item) => (
                <ItemRow key={item.id} item={item} selected={false} onClick={() => toggleItem(item.id)} />
              ))
            )}
          </div>
        </div>

        {/* New Check */}
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-blue-900 uppercase tracking-wide">New Check</h3>
            <span className="text-sm font-bold text-blue-900 tabular-nums">{formatCurrency(splitBTotal)}</span>
          </div>
          <div className="space-y-2">
            {splitBItems.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-4 text-center">Tap items on the left to move here</p>
            ) : (
              splitBItems.map((item) => (
                <ItemRow key={item.id} item={item} selected onClick={() => toggleItem(item.id)} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ItemRow({
  item,
  selected,
  onClick,
}: {
  item: OrderItemSummary
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg transition-colors flex items-center justify-between group ${
        selected
          ? 'bg-blue-100 hover:bg-blue-200 border border-blue-300'
          : 'bg-gray-50 hover:bg-gray-100 border border-gray-200'
      }`}
    >
      <div>
        <p className="text-sm font-medium text-gray-900">{item.name}</p>
        {item.quantity > 1 && (
          <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
        )}
        {item.modifiers.length > 0 && (
          <p className="text-xs text-gray-400 mt-0.5">
            {item.modifiers.map((m) => m.name).join(', ')}
          </p>
        )}
      </div>
      <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(item.itemTotal)}</span>
    </button>
  )
}

// ─── Seat Split Panel ─────────────────────────────────────────────────────────

function SeatSplitPanel({
  order,
  seatGroups,
  seatTotals,
}: {
  order: OrderSummary
  seatGroups: Map<number, OrderItemSummary[]>
  seatTotals: Map<number, number>
}) {
  const sortedSeats = Array.from(seatGroups.keys()).sort((a, b) => a - b)
  const hasSufficientSeats = sortedSeats.filter((s) => s !== 0).length >= 2

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {!hasSufficientSeats && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          At least 2 seats with items are required for a seat split. Assign seats to items first.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sortedSeats.map((seat) => {
          const items = seatGroups.get(seat) || []
          const total = seatTotals.get(seat) || 0
          const seatLabel = seat === 0 ? 'Unassigned' : `Seat ${seat}`

          return (
            <div key={seat} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">{seatLabel}</h3>
                <span className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(total)}</span>
              </div>
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm text-gray-800">{item.name}</p>
                      {item.quantity > 1 && (
                        <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                      )}
                    </div>
                    <span className="text-sm text-gray-700 tabular-nums">{formatCurrency(item.itemTotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex justify-between">
        <span className="text-sm font-medium text-gray-500">Order Total</span>
        <span className="text-sm font-bold text-gray-900">{formatCurrency(order.total)}</span>
      </div>
    </div>
  )
}

// ─── Custom Amount Split Panel ────────────────────────────────────────────────

function CustomSplitPanel({
  order,
  customAmounts,
  remaining,
  onUpdate,
  onAdd,
  onRemove,
}: {
  order: OrderSummary
  customAmounts: number[]
  remaining: number
  onUpdate: (index: number, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Split Amounts</h3>
        <div className="space-y-3">
          {customAmounts.map((amount, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-500 w-20">Check {i + 1}</span>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount || ''}
                  onChange={(e) => onUpdate(i, e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 tabular-nums"
                />
              </div>
              {customAmounts.length > 2 && (
                <button
                  onClick={() => onRemove(i)}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                  aria-label="Remove split"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={onAdd}
          className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
        >
          + Add another split
        </button>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Order Total</span>
          <span className="text-sm font-bold text-gray-900">{formatCurrency(order.total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Split Total</span>
          <span className="text-sm font-semibold text-gray-900 tabular-nums">
            {formatCurrency(customAmounts.reduce((s, a) => s + a, 0))}
          </span>
        </div>
        <div className="pt-3 border-t border-gray-200 flex justify-between">
          <span className="text-sm font-medium text-gray-700">Remaining Balance</span>
          <span
            className={`text-sm font-bold tabular-nums ${
              remaining < 0 ? 'text-red-600' : remaining === 0 ? 'text-green-600' : 'text-gray-900'
            }`}
          >
            {formatCurrency(remaining)}
          </span>
        </div>
        {remaining < 0 && (
          <p className="text-xs text-red-600">Split amounts exceed the order total</p>
        )}
      </div>
    </div>
  )
}
