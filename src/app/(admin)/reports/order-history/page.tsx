'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatDateTime, formatTime } from '@/lib/utils'
import { ReceiptModal } from '@/components/receipt'
import { AdjustTipModal } from '@/components/orders/AdjustTipModal'
import { VoidPaymentModal } from '@/components/orders/VoidPaymentModal'
import { ReopenOrderModal } from '@/components/orders/ReopenOrderModal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { WebReportBanner } from '@/components/admin/WebReportBanner'
import { useDataRetention } from '@/hooks/useDataRetention'
import { Modal } from '@/components/ui/modal'
import { ManagerPinModal } from '@/components/ui/manager-pin-modal'
import { toast } from '@/stores/toast-store'
import { getSharedSocket, releaseSharedSocket, isSharedSocketConnected } from '@/lib/shared-socket'

// ── List-level interfaces (unchanged) ──

interface Payment {
  id: string
  method: string
  paymentMethod: string
  amount: number
  tipAmount: number
  totalAmount: number
  cardLast4?: string
  cardBrand?: string
}

interface Order {
  id: string
  orderNumber: number
  orderType: string
  status: string
  tableName?: string
  tabName?: string
  guestCount: number
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
  cashTotal?: number
  employee?: { id: string; firstName: string; lastName: string }
  customer?: { id: string; firstName: string; lastName: string; phone?: string }
  itemCount: number
  payments: Payment[]
  createdAt: string
  closedAt?: string
}

interface Summary {
  orderCount: number
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
}

interface StatusBreakdown {
  status: string
  count: number
  total: number
}

interface TypeBreakdown {
  type: string
  count: number
  total: number
}

interface PaymentBreakdown {
  method: string
  count: number
  amount: number
  tips: number
}

// ── Detail-level interfaces ──

interface DetailModifier {
  name: string
  price: number
}

interface DetailItem {
  id: string
  name: string
  price: number
  quantity: number
  modifiers: DetailModifier[]
  status: string
  voidReason?: string
  pourSize?: string
  specialNotes?: string
  seatNumber?: number
  itemTotal: number
  addedBy?: { id: string; firstName: string; lastName: string } | null
  addedAt: string
}

interface DetailPayment {
  id: string
  method: string
  amount: number
  tipAmount: number
  totalAmount: number
  cardBrand?: string
  cardLast4?: string
  authCode?: string
  transactionId?: string
  entryMethod?: string
  datacapRecordNo?: string
  datacapSequenceNo?: string
  datacapRefNumber?: string
  amountRequested?: number
  amountAuthorized?: number
  amountTendered?: number
  changeGiven?: number
  status: string
  refunds: DetailRefund[]
}

interface DetailRefund {
  id: string
  refundAmount: number
  refundReason: string
  employeeName?: string | null
  datacapRefNo?: string
  createdAt: string
}

interface DetailVoid {
  id: string
  voidType: string
  itemId?: string
  itemName?: string
  amount: number
  reason: string
  wasMade: boolean
  employee: { id: string; firstName: string; lastName: string } | null
  approvedBy?: { id: string; firstName: string; lastName: string } | null
  createdAt: string
}

interface DetailDiscount {
  id: string
  name: string
  amount: number
  percent?: number
  appliedBy?: { id: string; firstName: string; lastName: string } | null
  reason?: string
  createdAt: string
}

interface DetailItemDiscount {
  id: string
  orderItemId: string
  amount: number
  percent?: number
  appliedBy?: { id: string; firstName: string; lastName: string } | null
  reason?: string
  itemName?: string
  createdAt: string
}

interface DetailTip {
  id: string
  amountCents: number
  sourceType: string
  kind: string
  primaryEmployee?: { id: string; firstName: string; lastName: string } | null
  tipGroupName?: string
  collectedAt: string
}

interface RemovedItem {
  id: string
  action: string
  details: Record<string, unknown>
  employeeName?: string | null
  timestamp: string
}

interface WalkoutRetryInfo {
  id: string
  status: string
  retryCount: number
  maxRetries: number
  nextRetryAt: string | null
  lastRetryError: string | null
  collectedAt: string | null
  writtenOffAt: string | null
  cardType: string | null
  cardLast4: string | null
  amount: number
  createdAt: string
}

interface OrderDetail {
  orderId: string
  orderNumber: number
  orderType: string
  status: string
  isWalkout?: boolean
  tableName?: string
  tabName?: string
  guestCount: number
  subtotal: number
  taxTotal: number
  tipTotal: number
  discountTotal: number
  total: number
  openedBy?: { id: string; firstName: string; lastName: string } | null
  closedBy?: { id: string; firstName: string; lastName: string } | null
  openedAt: string
  closedAt?: string
  items: DetailItem[]
  payments: DetailPayment[]
  voids: DetailVoid[]
  orderDiscounts: DetailDiscount[]
  itemDiscounts: DetailItemDiscount[]
  tipTransactions: DetailTip[]
  removedItems: RemovedItem[]
  taxRate?: number
  // Dual pricing
  cashSubtotal?: number
  cashTax?: number
  cashTotal?: number
  isDualPricing?: boolean
}

// ── Refund Reasons ──

const REFUND_REASONS = [
  { value: 'customer_request', label: 'Customer Request' },
  { value: 'wrong_item', label: 'Wrong Item Charged' },
  { value: 'duplicate_charge', label: 'Duplicate Charge' },
  { value: 'quality_issue', label: 'Quality Issue' },
  { value: 'overcharge', label: 'Overcharge' },
  { value: 'other', label: 'Other' },
]

// ── Refund Modal Component ──

function RefundModal({
  isOpen,
  onClose,
  payment,
  orderId,
  locationId,
  onSuccess,
}: {
  isOpen: boolean
  onClose: () => void
  payment: DetailPayment
  orderId: string
  locationId: string
  onSuccess: () => void
}) {
  const alreadyRefunded = payment.refunds.reduce((sum, r) => sum + r.refundAmount, 0)
  const maxRefundable = payment.amount - alreadyRefunded
  const [refundAmount, setRefundAmount] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [showPinModal, setShowPinModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setRefundAmount(maxRefundable.toFixed(2))
      setReason('')
      setNotes('')
    }
  }, [isOpen, maxRefundable])

  const handleSubmit = () => {
    if (!reason) {
      toast.error('Please select a reason')
      return
    }
    const amount = parseFloat(refundAmount)
    if (isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid refund amount')
      return
    }
    if (amount > maxRefundable) {
      toast.error(`Cannot exceed ${formatCurrency(maxRefundable)}`)
      return
    }
    setShowPinModal(true)
  }

  const handlePinVerified = async (managerId: string, managerName: string) => {
    setShowPinModal(false)
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/refund-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: payment.id,
          refundAmount: parseFloat(refundAmount),
          refundReason: reason,
          notes: notes.trim(),
          managerId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refund failed')
      toast.success(`Refund of ${formatCurrency(parseFloat(refundAmount))} processed by ${managerName}`)
      onSuccess()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refund failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Modal isOpen={isOpen && !showPinModal} onClose={onClose} title="Issue Refund" size="md">
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
            <p>Payment: <span className="font-medium">{payment.cardBrand || payment.method} {payment.cardLast4 ? `****${payment.cardLast4}` : ''}</span></p>
            <p>Original Amount: <span className="font-medium">{formatCurrency(payment.amount)}</span></p>
            {alreadyRefunded > 0 && (
              <p className="text-red-600">Already Refunded: {formatCurrency(alreadyRefunded)}</p>
            )}
            <p>Max Refundable: <span className="font-semibold">{formatCurrency(maxRefundable)}</span></p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Refund Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-900">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={maxRefundable.toFixed(2)}
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Reason *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select reason...</option>
              {REFUND_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Additional details..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting} className="flex-1">
              Cancel
            </Button>
            <Button variant="danger" onClick={handleSubmit} disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Processing...' : `Refund ${refundAmount ? formatCurrency(parseFloat(refundAmount) || 0) : ''}`}
            </Button>
          </div>
        </div>
      </Modal>

      <ManagerPinModal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onVerified={handlePinVerified}
        title="Manager Authorization Required"
        message="Enter manager PIN to process refund"
        locationId={locationId}
      />
    </>
  )
}

// ── Order Detail Panel (inline expandable) ──

function OrderDetailPanel({
  orderId,
  employeeId,
  locationId,
  detailCache,
  onCacheUpdate,
}: {
  orderId: string
  employeeId: string
  locationId: string
  detailCache: Map<string, OrderDetail>
  onCacheUpdate: (id: string, detail: OrderDetail) => void
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(detailCache.get(orderId) || null)
  const [isLoading, setIsLoading] = useState(!detail)
  const [error, setError] = useState<string | null>(null)
  const [showRemovedItems, setShowRemovedItems] = useState(false)
  const [refundPayment, setRefundPayment] = useState<DetailPayment | null>(null)
  const [walkoutRetries, setWalkoutRetries] = useState<WalkoutRetryInfo[]>([])

  useEffect(() => {
    if (!detail?.isWalkout) return
    const fetchRetries = async () => {
      try {
        const params = new URLSearchParams({ locationId, orderId })
        const res = await fetch(`/api/datacap/walkout-retry?${params}`)
        if (res.ok) {
          const json = await res.json()
          setWalkoutRetries(json.data || [])
        }
      } catch {
        // Silently fail - walkout info is supplementary
      }
    }
    fetchRetries()
  }, [detail?.isWalkout, locationId, orderId])

  useEffect(() => {
    if (detail) return
    const fetchDetail = async () => {
      try {
        const res = await fetch(`/api/reports/order-history/${orderId}?employeeId=${employeeId}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Failed to load (${res.status})`)
        }
        const { data } = await res.json()
        setDetail(data)
        onCacheUpdate(orderId, data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load order detail')
      } finally {
        setIsLoading(false)
      }
    }
    fetchDetail()
  }, [orderId, employeeId, detail, onCacheUpdate])

  const handleRefundSuccess = useCallback(() => {
    // Invalidate cache and reload
    setDetail(null)
    setIsLoading(true)
    setError(null)
  }, [])

  if (isLoading) {
    return (
      <tr>
        <td colSpan={11} className="p-0">
          <div className="bg-gray-50 border-t border-b border-gray-200 p-6 text-center text-gray-900">
            Loading order details...
          </div>
        </td>
      </tr>
    )
  }

  if (error) {
    return (
      <tr>
        <td colSpan={11} className="p-0">
          <div className="bg-red-50 border-t border-b border-red-200 p-6 text-center text-red-600">
            {error}
          </div>
        </td>
      </tr>
    )
  }

  if (!detail) return null

  const formatEmployeeName = (emp?: { firstName: string; lastName: string } | null) =>
    emp ? `${emp.firstName} ${emp.lastName.charAt(0)}.` : 'Unknown'

  const soldCount = detail.items.filter(i => i.status === 'active').length
  const voidedCount = detail.items.filter(i => i.status === 'voided' || i.status === 'comped').length
  const tipPct = detail.subtotal > 0 && detail.tipTotal > 0
    ? Math.round((detail.tipTotal / detail.subtotal) * 100)
    : 0

  return (
    <>
      <tr>
        <td colSpan={11} className="p-0">
          <div className="bg-gray-100 border-t border-b border-gray-200 py-6 flex justify-center">
            {/* Receipt card */}
            <div className="w-full max-w-[480px] font-mono text-[13px] leading-relaxed text-gray-800">
              {/* Torn top edge */}
              <div
                className="h-4 bg-[#fefdfb]"
                style={{
                  maskImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 120 8\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 8 Q5 0 10 8 Q15 0 20 8 Q25 0 30 8 Q35 0 40 8 Q45 0 50 8 Q55 0 60 8 Q65 0 70 8 Q75 0 80 8 Q85 0 90 8 Q95 0 100 8 Q105 0 110 8 Q115 0 120 8 L120 8 L0 8Z\' fill=\'black\'/%3E%3C/svg%3E")',
                  maskSize: '120px 8px',
                  maskRepeat: 'repeat-x',
                  maskPosition: 'bottom',
                  WebkitMaskImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 120 8\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 8 Q5 0 10 8 Q15 0 20 8 Q25 0 30 8 Q35 0 40 8 Q45 0 50 8 Q55 0 60 8 Q65 0 70 8 Q75 0 80 8 Q85 0 90 8 Q95 0 100 8 Q105 0 110 8 Q115 0 120 8 L120 8 L0 8Z\' fill=\'black\'/%3E%3C/svg%3E")',
                  WebkitMaskSize: '120px 8px',
                  WebkitMaskRepeat: 'repeat-x',
                  WebkitMaskPosition: 'bottom',
                }}
              />

              <div className="bg-[#fefdfb] shadow-lg px-6 pb-5 pt-2">
                {/* ── Header ── */}
                <div className="border-y-2 border-gray-400 py-2 text-center">
                  <h3 className="text-lg font-bold tracking-wide">Ticket #{detail.orderNumber}</h3>
                </div>
                <div className="text-center text-[11px] text-gray-900 py-2 space-y-0.5">
                  {(detail.tableName || detail.tabName) && (
                    <p className="text-gray-600">
                      {detail.tableName && `Table: ${detail.tableName}`}
                      {detail.tableName && detail.tabName && ' · '}
                      {detail.tabName && `Tab: ${detail.tabName}`}
                    </p>
                  )}
                  <p>
                    Assigned: <span className="font-semibold text-gray-900">{formatEmployeeName(detail.openedBy)}</span>
                    {' | '}Sold: <span className="font-semibold">{soldCount}</span>
                    {voidedCount > 0 && <>{' | '}Voided: <span className="font-semibold text-red-600">{voidedCount}</span></>}
                  </p>
                  <p>
                    Opened: {formatTime(detail.openedAt)}
                    {detail.closedAt && ` | Closed: ${formatTime(detail.closedAt)}`}
                  </p>
                </div>
                <div className="border-y-2 border-gray-400 py-0.5 mb-3" />

                {/* ── Walkout Retry Status ── */}
                {detail.isWalkout && (
                  <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 font-sans">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-red-600 text-xs font-bold uppercase tracking-wider">Walkout</span>
                    </div>
                    {walkoutRetries.length === 0 ? (
                      <p className="text-[11px] text-gray-900">No retry records found.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {walkoutRetries.map(retry => {
                          const statusStyles: Record<string, string> = {
                            pending: 'bg-yellow-100 text-yellow-800',
                            collected: 'bg-green-100 text-green-800',
                            exhausted: 'bg-red-100 text-red-800',
                            written_off: 'bg-gray-100 text-gray-600',
                          }
                          const statusLabels: Record<string, string> = {
                            pending: 'Pending',
                            collected: 'Collected',
                            exhausted: 'Exhausted',
                            written_off: 'Written Off',
                          }
                          return (
                            <div key={retry.id} className="text-[11px]">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusStyles[retry.status] || 'bg-gray-100 text-gray-600'}`}>
                                  {statusLabels[retry.status] || retry.status}
                                </span>
                                <span className="text-gray-900 font-medium">{formatCurrency(retry.amount)}</span>
                                {retry.cardType && retry.cardLast4 && (
                                  <span className="text-gray-900">{retry.cardType} ****{retry.cardLast4}</span>
                                )}
                              </div>
                              <div className="text-gray-900 mt-0.5 space-y-0.5">
                                <p>Retries: {retry.retryCount} / {retry.maxRetries}</p>
                                {retry.nextRetryAt && retry.status === 'pending' && (
                                  <p>Next retry: {new Date(retry.nextRetryAt).toLocaleString()}</p>
                                )}
                                {retry.lastRetryError && (
                                  <p className="text-red-500 truncate max-w-[360px]">Last error: {retry.lastRetryError}</p>
                                )}
                                {retry.collectedAt && (
                                  <p className="text-green-600">Collected: {new Date(retry.collectedAt).toLocaleString()}</p>
                                )}
                                {retry.writtenOffAt && (
                                  <p>Written off: {new Date(retry.writtenOffAt).toLocaleString()}</p>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Items ── */}
                <div className="space-y-2.5">
                  {detail.items.map(item => {
                    const isVoided = item.status === 'voided'
                    const isComped = item.status === 'comped'
                    const isStruck = isVoided || isComped
                    return (
                      <div key={item.id}>
                        {/* Item name + price */}
                        <div className={`flex justify-between gap-2 ${isStruck ? 'line-through text-gray-900' : ''}`}>
                          <span className="flex-1 min-w-0">
                            {item.name}
                            {item.pourSize ? ` (${item.pourSize})` : ''}
                            {item.quantity > 1 ? ` (${item.quantity})` : ''}
                            {isVoided && (
                              <span className="ml-1.5 text-[10px] font-bold text-red-600 bg-red-100 px-1 py-px rounded-sm" style={{ textDecoration: 'none' }}>VOID</span>
                            )}
                            {isComped && (
                              <span className="ml-1.5 text-[10px] font-bold text-amber-700 bg-amber-100 px-1 py-px rounded-sm" style={{ textDecoration: 'none' }}>COMP</span>
                            )}
                          </span>
                          <span className="tabular-nums whitespace-nowrap">{formatCurrency(item.itemTotal)}</span>
                        </div>
                        {/* Quantity breakdown */}
                        {item.quantity > 1 && (
                          <div className="text-[11px] text-gray-900 pl-3">
                            ({item.quantity} &times; {formatCurrency(item.price)})
                          </div>
                        )}
                        {/* Modifiers */}
                        {item.modifiers.map((mod, i) => (
                          <div key={i} className={`flex justify-between pl-3 text-[11px] ${isStruck ? 'line-through text-gray-900' : 'text-gray-600'}`}>
                            <span>{mod.name}</span>
                            {mod.price !== 0 && (
                              <span className="tabular-nums">{formatCurrency(mod.price)}</span>
                            )}
                          </div>
                        ))}
                        {/* Special notes */}
                        {item.specialNotes && (
                          <div className="text-[11px] text-blue-600 pl-3 italic">&quot;{item.specialNotes}&quot;</div>
                        )}
                        {/* Item discounts */}
                        {detail.itemDiscounts
                          .filter(d => d.orderItemId === item.id)
                          .map(d => (
                            <div key={d.id} className="text-[11px] text-green-700 pl-3">
                              Discount: -{formatCurrency(d.amount)}
                              {d.percent ? ` (${Number(d.percent)}%)` : ''}
                              {d.appliedBy ? ` by ${formatEmployeeName(d.appliedBy)}` : ''}
                            </div>
                          ))}
                        {/* Void/comp reason */}
                        {isVoided && item.voidReason && (
                          <div className="text-[11px] text-red-500 pl-3">Reason: {item.voidReason}</div>
                        )}
                        {/* Added by */}
                        <div className="text-[11px] text-gray-900 pl-3">
                          &rarr; {formatEmployeeName(item.addedBy)}  {formatTime(item.addedAt)}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* ── Removed items toggle ── */}
                {detail.removedItems.length > 0 && (
                  <div className="mt-3">
                    <div className="border-t border-dashed border-gray-300 pt-2" />
                    <label className="flex items-center gap-2 text-[11px] text-gray-900 cursor-pointer select-none font-sans">
                      <input
                        type="checkbox"
                        checked={showRemovedItems}
                        onChange={(e) => setShowRemovedItems(e.target.checked)}
                        className="rounded border-gray-300 w-3.5 h-3.5"
                      />
                      Show removed items ({detail.removedItems.length})
                    </label>
                    {showRemovedItems && (
                      <div className="mt-2 bg-red-50/80 rounded px-3 py-2 space-y-1">
                        <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider">Removed before sending</p>
                        {detail.removedItems.map((ri) => (
                          <div key={ri.id} className="text-[11px] text-red-700 flex justify-between">
                            <span className="line-through">{(ri.details as Record<string, unknown>)?.itemName as string || ri.action}</span>
                            <span className="text-red-400">
                              {ri.employeeName && `${ri.employeeName} `}{formatTime(ri.timestamp)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Financials ── */}
                <div className="border-t border-dashed border-gray-300 mt-3 pt-2 space-y-0.5">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatCurrency(detail.subtotal)}</span>
                  </div>
                  {detail.discountTotal > 0 && (
                    <div className="flex justify-between text-green-700">
                      <span>Discounts</span>
                      <span className="tabular-nums">-{formatCurrency(detail.discountTotal)}</span>
                    </div>
                  )}
                  {detail.taxRate !== undefined && detail.taxRate > 0 ? (
                    <div className="flex justify-between text-gray-600">
                      <span>Tax ({(detail.taxRate * 100).toFixed(2)}%)</span>
                      <span className="tabular-nums">{formatCurrency(detail.taxTotal)}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between text-gray-600">
                      <span>Tax</span>
                      <span className="tabular-nums">{formatCurrency(detail.taxTotal)}</span>
                    </div>
                  )}
                  {detail.tipTotal > 0 && (
                    <div className="flex justify-between">
                      <span>{tipPct > 0 ? `Tip (${tipPct}%)` : 'Tip'}</span>
                      <span className="tabular-nums">{formatCurrency(detail.tipTotal)}</span>
                    </div>
                  )}
                </div>
                <div className="border-y-2 border-gray-400 my-2 py-1.5">
                  <div className="flex justify-between font-bold text-base">
                    <span>{detail.isDualPricing ? 'CARD TOTAL' : 'TOTAL'}{detail.tipTotal > 0 ? ' WITH TIP' : ''}</span>
                    <span className="tabular-nums">{formatCurrency(detail.total + detail.tipTotal)}</span>
                  </div>
                  {detail.isDualPricing && detail.cashTotal != null && (
                    <>
                      <div className="flex justify-between text-sm text-gray-600 mt-1">
                        <span>Cash Total</span>
                        <span className="tabular-nums">{formatCurrency(detail.cashTotal + detail.tipTotal)}</span>
                      </div>
                      {detail.cashSubtotal != null && (
                        <div className="flex justify-between text-xs text-gray-900">
                          <span>Cash Subtotal</span>
                          <span className="tabular-nums">{formatCurrency(detail.cashSubtotal)}</span>
                        </div>
                      )}
                      {detail.cashTax != null && (
                        <div className="flex justify-between text-xs text-gray-900">
                          <span>Cash Tax</span>
                          <span className="tabular-nums">{formatCurrency(detail.cashTax)}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* ── Payments ── */}
                {detail.payments.map(pmt => {
                  const pmtRefunded = pmt.refunds.reduce((s, r) => s + r.refundAmount, 0)
                  const isCard = pmt.method === 'credit' || pmt.method === 'debit'
                  return (
                    <div key={pmt.id} className="mb-2">
                      <div className="flex justify-between items-baseline">
                        <span>
                          {isCard
                            ? `${pmt.cardBrand || 'Card'} ****${pmt.cardLast4 || '????'}`
                            : pmt.method.charAt(0).toUpperCase() + pmt.method.slice(1)}
                          {pmt.entryMethod ? ` (${pmt.entryMethod})` : ''}
                        </span>
                        <span className="tabular-nums font-semibold">{formatCurrency(pmt.totalAmount)}</span>
                      </div>
                      {pmt.status === 'voided' && (
                        <div className="text-[11px] font-bold text-red-600 text-center">*** VOIDED ***</div>
                      )}
                      <div className="text-[11px] text-gray-900 space-y-px">
                        {pmt.authCode && <p>Auth: {pmt.authCode}</p>}
                        {pmt.transactionId && <p>Invoice #: {pmt.transactionId}</p>}
                        {pmt.datacapRecordNo && <p>Record: {pmt.datacapRecordNo}</p>}
                        {pmt.datacapRefNumber && <p>Ref: {pmt.datacapRefNumber}</p>}
                        {pmt.datacapSequenceNo && <p>Seq: {pmt.datacapSequenceNo}</p>}
                        {pmt.amountRequested != null && pmt.amountAuthorized != null && pmt.amountRequested !== pmt.amountAuthorized && (
                          <p className="text-amber-600 font-semibold">
                            Partial: Req {formatCurrency(pmt.amountRequested)} / Auth {formatCurrency(pmt.amountAuthorized)}
                          </p>
                        )}
                        {pmt.method === 'cash' && (
                          <>
                            {pmt.amountTendered != null && <p>Tendered: {formatCurrency(pmt.amountTendered)}</p>}
                            {pmt.changeGiven != null && <p>Change: {formatCurrency(pmt.changeGiven)}</p>}
                          </>
                        )}
                      </div>

                      {/* Refund history */}
                      {pmt.refunds.length > 0 && (
                        <div className="border-t border-dashed border-gray-200 mt-1.5 pt-1.5 space-y-0.5">
                          <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider">Refunds</p>
                          {pmt.refunds.map(ref => (
                            <div key={ref.id} className="text-[11px] text-gray-600 flex justify-between">
                              <span>
                                -{formatCurrency(ref.refundAmount)} &mdash; {ref.refundReason}
                                {ref.employeeName && ` (${ref.employeeName})`}
                              </span>
                              <span className="text-gray-600">{formatTime(ref.createdAt)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Refund button */}
                      {pmt.status !== 'voided' && pmt.amount > pmtRefunded && (
                        <div className="pt-1.5 font-sans">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-300 hover:bg-red-50 text-xs"
                            onClick={() => setRefundPayment(pmt)}
                          >
                            Issue Refund
                          </Button>
                        </div>
                      )}

                      <div className="border-t border-dashed border-gray-300 mt-2" />
                    </div>
                  )
                })}

                {/* ── Voids/Comps ── */}
                {detail.voids.length > 0 && (
                  <div className="space-y-1 mb-2">
                    <p className="text-[10px] font-bold text-gray-900 uppercase tracking-wider">Voids & Comps</p>
                    {detail.voids.map(v => (
                      <div key={v.id} className="flex justify-between text-[11px]">
                        <span>
                          <span className={v.voidType === 'comp' ? 'text-amber-700 font-bold' : 'text-red-700 font-bold'}>
                            {v.voidType === 'comp' ? 'COMP' : 'VOID'}
                          </span>
                          {v.itemName && ` ${v.itemName}`}
                          <span className="text-gray-600">
                            {' '}by {formatEmployeeName(v.employee)}
                            {v.approvedBy && ` (ok: ${formatEmployeeName(v.approvedBy)})`}
                            {v.wasMade && ' [made]'}
                          </span>
                        </span>
                        <span className="tabular-nums whitespace-nowrap ml-2">{formatCurrency(v.amount)}</span>
                      </div>
                    ))}
                    <div className="border-t border-dashed border-gray-300 mt-1" />
                  </div>
                )}

                {/* ── Order-level Discounts ── */}
                {detail.orderDiscounts.length > 0 && (
                  <div className="space-y-1 mb-2">
                    <p className="text-[10px] font-bold text-gray-900 uppercase tracking-wider">Discounts</p>
                    {detail.orderDiscounts.map(d => (
                      <div key={d.id} className="flex justify-between text-[11px] text-green-700">
                        <span>
                          {d.name}
                          {d.percent ? ` (${Number(d.percent)}%)` : ''}
                          {d.appliedBy && <span className="text-gray-600"> by {formatEmployeeName(d.appliedBy)}</span>}
                        </span>
                        <span className="tabular-nums ml-2">-{formatCurrency(d.amount)}</span>
                      </div>
                    ))}
                    <div className="border-t border-dashed border-gray-300 mt-1" />
                  </div>
                )}

                {/* ── Tip details ── */}
                {detail.tipTransactions.length > 0 && (
                  <div className="space-y-1 mb-2">
                    <p className="text-[10px] font-bold text-gray-900 uppercase tracking-wider">Tip Details</p>
                    {detail.tipTransactions.map(t => (
                      <div key={t.id} className="flex justify-between text-[11px]">
                        <span>
                          {t.kind === 'service_charge' ? 'Svc Charge' : t.kind === 'auto_gratuity' ? 'Auto Grat' : 'Tip'}
                          <span className="text-gray-600"> ({t.sourceType})</span>
                          {t.primaryEmployee && <span className="text-gray-600"> {formatEmployeeName(t.primaryEmployee)}</span>}
                        </span>
                        <span className="tabular-nums ml-2">{formatCurrency(t.amountCents)}</span>
                      </div>
                    ))}
                    <div className="border-t border-dashed border-gray-300 mt-1" />
                  </div>
                )}

                {/* Footer */}
                <div className="text-center text-[11px] text-gray-900 pt-1 pb-2 space-y-0.5">
                  {detail.payments.length > 0 && (
                    <div>Paid by: {(() => {
                      const methods = [...new Set(detail.payments.map(p => {
                        if (p.method === 'credit' || p.method === 'debit') return 'Card'
                        return p.method.charAt(0).toUpperCase() + p.method.slice(1)
                      }))]
                      return methods.join(' + ')
                    })()}</div>
                  )}
                  <div>Served by: {formatEmployeeName(detail.openedBy)}</div>
                </div>
              </div>

              {/* Torn bottom edge */}
              <div
                className="h-4 bg-[#fefdfb]"
                style={{
                  maskImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 120 8\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0 Q5 8 10 0 Q15 8 20 0 Q25 8 30 0 Q35 8 40 0 Q45 8 50 0 Q55 8 60 0 Q65 8 70 0 Q75 8 80 0 Q85 8 90 0 Q95 8 100 0 Q105 8 110 0 Q115 8 120 0 L120 0 L0 0Z\' fill=\'black\'/%3E%3C/svg%3E")',
                  maskSize: '120px 8px',
                  maskRepeat: 'repeat-x',
                  maskPosition: 'top',
                  WebkitMaskImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 120 8\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0 Q5 8 10 0 Q15 8 20 0 Q25 8 30 0 Q35 8 40 0 Q45 8 50 0 Q55 8 60 0 Q65 8 70 0 Q75 8 80 0 Q85 8 90 0 Q95 8 100 0 Q105 8 110 0 Q115 8 120 0 L120 0 L0 0Z\' fill=\'black\'/%3E%3C/svg%3E")',
                  WebkitMaskSize: '120px 8px',
                  WebkitMaskRepeat: 'repeat-x',
                  WebkitMaskPosition: 'top',
                }}
              />
            </div>
          </div>
        </td>
      </tr>

      {/* Refund Modal */}
      {refundPayment && (
        <RefundModal
          isOpen={!!refundPayment}
          onClose={() => setRefundPayment(null)}
          payment={refundPayment}
          orderId={orderId}
          locationId={locationId}
          onSuccess={handleRefundSuccess}
        />
      )}
    </>
  )
}

// ── Main Page Component ──

export default function OrderHistoryPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports/order-history' })
  const employee = useAuthStore(s => s.employee)
  const { retentionDays, venueSlug } = useDataRetention()
  const [orders, setOrders] = useState<Order[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown[]>([])
  const [typeBreakdown, setTypeBreakdown] = useState<TypeBreakdown[]>([])
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdown[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // Filters
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [status, setStatus] = useState('')
  const [orderType, setOrderType] = useState('')
  const [search, setSearch] = useState('')

  // Receipt modal
  const [showReceipt, setShowReceipt] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  // Action modals
  const [showAdjustTip, setShowAdjustTip] = useState(false)
  const [showVoidPayment, setShowVoidPayment] = useState(false)
  const [showReopenOrder, setShowReopenOrder] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null)

  // Expanded order detail
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const detailCacheRef = useRef<Map<string, OrderDetail>>(new Map())

  const handleCacheUpdate = useCallback((id: string, detail: OrderDetail) => {
    detailCacheRef.current.set(id, detail)
  }, [])

  const loadOrders = useCallback(async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        employeeId: employee.id,
        page: page.toString(),
        limit: '50',
      })
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (status) params.set('status', status)
      if (orderType) params.set('orderType', orderType)
      if (search) params.set('search', search)

      const res = await fetch(`/api/reports/order-history?${params}`)
      if (res.ok) {
        const data = await res.json()
        setOrders(data.data.orders)
        setSummary(data.data.summary)
        setStatusBreakdown(data.data.statusBreakdown)
        setTypeBreakdown(data.data.typeBreakdown)
        setPaymentBreakdown(data.data.paymentBreakdown)
        setTotalPages(data.data.pagination.totalPages)
      }
    } catch (error) {
      console.error('Failed to load orders:', error)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, employee?.id, page, startDate, endDate, status, orderType, search])

  // Load on filter/page change
  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  // Live updates: socket events + 30s auto-refresh
  const loadOrdersRef = useRef(loadOrders)
  loadOrdersRef.current = loadOrders

  useEffect(() => {
    if (!employee?.location?.id) return

    const socket = getSharedSocket()
    const debounceTimer = { current: null as ReturnType<typeof setTimeout> | null }

    const debouncedRefresh = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => loadOrdersRef.current(), 500)
    }

    socket.on('orders:list-changed', debouncedRefresh)
    socket.on('order:totals-updated', debouncedRefresh)
    socket.on('order:created', debouncedRefresh)
    socket.on('order:updated', debouncedRefresh)
    socket.on('order:closed', debouncedRefresh)
    socket.on('connect', () => loadOrdersRef.current())

    // Fallback polling every 30 seconds (only when socket disconnected)
    const interval = setInterval(() => {
      if (isSharedSocketConnected()) return
      loadOrdersRef.current()
    }, 30_000)

    return () => {
      socket.off('orders:list-changed', debouncedRefresh)
      socket.off('order:totals-updated', debouncedRefresh)
      socket.off('order:created', debouncedRefresh)
      socket.off('order:updated', debouncedRefresh)
      socket.off('order:closed', debouncedRefresh)
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      clearInterval(interval)
      releaseSharedSocket()
    }
  }, [employee?.location?.id])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    loadOrders()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800'
      case 'closed': return 'bg-gray-100 text-gray-800'
      case 'open': return 'bg-blue-100 text-blue-800'
      case 'voided': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getOrderTypeLabel = (type: string) => {
    switch (type) {
      case 'dine_in': return 'Dine In'
      case 'takeout': return 'Takeout'
      case 'delivery': return 'Delivery'
      case 'bar_tab': return 'Bar Tab'
      default: return type
    }
  }

  const toggleExpanded = (orderId: string) => {
    setExpandedOrderId(prev => prev === orderId ? null : orderId)
  }

  const handleExportCsv = useCallback(async () => {
    if (!employee?.location?.id) return
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        employeeId: employee.id,
        format: 'csv',
      })
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (status) params.set('status', status)
      if (orderType) params.set('orderType', orderType)
      if (search) params.set('search', search)

      const res = await fetch(`/api/reports/order-history?${params}`)
      if (!res.ok) {
        toast.error('Failed to export orders')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `order-history-${startDate || 'all'}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to export orders')
    }
  }, [employee?.location?.id, employee?.id, startDate, endDate, status, orderType, search])

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Order History"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
        actions={
          <button
            onClick={handleExportCsv}
            disabled={orders.length === 0}
            className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
          >
            Export CSV
          </button>
        }
      />

      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Order History</h1>
          <p className="text-gray-600">View and search past orders</p>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <form onSubmit={handleSearch} className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="border rounded px-3 py-2"
                >
                  <option value="">All</option>
                  <option value="open">Open</option>
                  <option value="paid">Paid</option>
                  <option value="closed">Closed</option>
                  <option value="voided">Voided</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Type</label>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                  className="border rounded px-3 py-2"
                >
                  <option value="">All</option>
                  <option value="dine_in">Dine In</option>
                  <option value="takeout">Takeout</option>
                  <option value="delivery">Delivery</option>
                  <option value="bar_tab">Bar Tab</option>
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm text-gray-600 mb-1">Search</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Order #, table, customer..."
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
              <Button type="submit">Search</Button>
            </form>
          </CardContent>
        </Card>

        <WebReportBanner
          startDate={startDate}
          endDate={endDate}
          reportType="order-history"
          retentionDays={retentionDays}
          venueSlug={venueSlug}
        />

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{summary.orderCount}</p>
                <p className="text-sm text-gray-600">Orders</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{formatCurrency(summary.subtotal)}</p>
                <p className="text-sm text-gray-600">Subtotal</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-red-600">-{formatCurrency(summary.discountTotal)}</p>
                <p className="text-sm text-gray-600">Discounts</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{formatCurrency(summary.taxTotal)}</p>
                <p className="text-sm text-gray-600">Tax</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.total)}</p>
                <p className="text-sm text-gray-600">Total</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Breakdowns Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Status Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By Status</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {statusBreakdown.map(s => (
                <div key={s.status} className="flex justify-between py-1 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs capitalize ${getStatusColor(s.status)}`}>
                    {s.status}
                  </span>
                  <span>{s.count} orders ({formatCurrency(s.total)})</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Type Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By Order Type</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {typeBreakdown.map(t => (
                <div key={t.type} className="flex justify-between py-1 text-sm">
                  <span>{getOrderTypeLabel(t.type)}</span>
                  <span>{t.count} ({formatCurrency(t.total)})</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Payment Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By Payment Method</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {paymentBreakdown.map(p => (
                <div key={p.method} className="flex justify-between py-1 text-sm">
                  <span className="capitalize">{p.method}</span>
                  <span>{formatCurrency(p.amount)} + {formatCurrency(p.tips)} tips</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Orders Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-gray-900">Loading orders...</div>
            ) : orders.length === 0 ? (
              <div className="p-8 text-center text-gray-900">No orders found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Order #</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Type</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Table/Tab</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Server</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Customer</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Items</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Total</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Payment</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Status</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Date</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.map(order => (
                      <Fragment key={order.id}>
                        <tr
                          className={`hover:bg-gray-50 cursor-pointer transition-colors ${expandedOrderId === order.id ? 'bg-blue-50 hover:bg-blue-50' : ''}`}
                          onClick={() => toggleExpanded(order.id)}
                        >
                          <td className="p-3 font-mono">
                            <span className="flex items-center gap-1">
                              <svg
                                className={`w-3 h-3 text-gray-900 transition-transform ${expandedOrderId === order.id ? 'rotate-90' : ''}`}
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                              </svg>
                              #{order.orderNumber}
                            </span>
                          </td>
                          <td className="p-3 text-sm">{getOrderTypeLabel(order.orderType)}</td>
                          <td className="p-3 text-sm">{order.tableName || order.tabName || '-'}</td>
                          <td className="p-3 text-sm">
                            {order.employee ? `${order.employee.firstName} ${order.employee.lastName}` : '-'}
                          </td>
                          <td className="p-3 text-sm">{order.customer ? `${order.customer.firstName} ${order.customer.lastName}` : '-'}</td>
                          <td className="p-3 text-sm text-right">{order.itemCount}</td>
                          <td className="p-3 text-sm text-right font-medium">{formatCurrency(
                            // Show actual collected amount when paid, otherwise card total
                            order.payments.length > 0
                              ? order.payments.reduce((sum, p) => sum + p.totalAmount, 0)
                              : order.total
                          )}</td>
                          <td className="p-3 text-sm text-gray-900">
                            {order.payments.length > 0 ? order.payments.map((p, i) => (
                              <span key={i}>
                                {i > 0 && ', '}
                                {p.paymentMethod === 'credit' || p.paymentMethod === 'debit'
                                  ? `${p.cardBrand || 'Card'}${p.cardLast4 ? ` ****${p.cardLast4}` : ''}`
                                  : p.paymentMethod.charAt(0).toUpperCase() + p.paymentMethod.slice(1)}
                              </span>
                            )) : '-'}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded text-xs capitalize ${getStatusColor(order.status)}`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="p-3 text-sm text-gray-900">
                            {formatDateTime(order.createdAt)}
                          </td>
                          <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-2">
                              {/* Quick Receipt Button */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedOrderId(order.id)
                                  setShowReceipt(true)
                                }}
                                title="Reprint Receipt"
                              >
                                🖨️
                              </Button>

                              {/* Actions Dropdown */}
                              <div className="relative group">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="px-2"
                                >
                                  ⋮
                                </Button>

                                {/* Dropdown Menu */}
                                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 hidden group-hover:block">
                                  <div className="py-1">
                                    {/* Adjust Tip - only for paid/closed orders with payments */}
                                    {(order.status === 'paid' || order.status === 'closed') && order.payments.length > 0 && (
                                      <button
                                        onClick={() => {
                                          setSelectedOrder(order)
                                          setSelectedPayment(order.payments[0])
                                          setShowAdjustTip(true)
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2"
                                      >
                                        💵 Adjust Tip
                                      </button>
                                    )}

                                    {/* Void Payment - only for paid/closed orders with payments */}
                                    {(order.status === 'paid' || order.status === 'closed') && order.payments.length > 0 && (
                                      <button
                                        onClick={() => {
                                          setSelectedOrder(order)
                                          setSelectedPayment(order.payments[0])
                                          setShowVoidPayment(true)
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2 text-red-600"
                                      >
                                        ⛔ Void Payment
                                      </button>
                                    )}

                                    {/* Reopen Order - only for closed/paid orders */}
                                    {(order.status === 'closed' || order.status === 'paid') && (
                                      <button
                                        onClick={() => {
                                          setSelectedOrder(order)
                                          setShowReopenOrder(true)
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2"
                                      >
                                        🔓 Reopen Order
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {expandedOrderId === order.id && employee && (
                          <OrderDetailPanel
                            key={`detail-${order.id}`}
                            orderId={order.id}
                            employeeId={employee.id}
                            locationId={employee.location?.id || ''}
                            detailCache={detailCacheRef.current}
                            onCacheUpdate={handleCacheUpdate}
                          />
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </Button>
            <span className="px-4 py-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Receipt Modal */}
      <ReceiptModal
        isOpen={showReceipt && !!selectedOrderId}
        orderId={selectedOrderId}
        locationId={employee?.location?.id || ''}
        onClose={() => {
          setShowReceipt(false)
          setSelectedOrderId(null)
        }}
      />

      {/* Adjust Tip Modal */}
      {selectedOrder && selectedPayment && (
        <AdjustTipModal
          isOpen={showAdjustTip}
          onClose={() => {
            setShowAdjustTip(false)
            setSelectedOrder(null)
            setSelectedPayment(null)
          }}
          order={selectedOrder}
          payment={selectedPayment}
          locationId={employee?.location?.id || ''}
          onSuccess={() => {
            loadOrders() // Reload orders after adjustment
          }}
        />
      )}

      {/* Void Payment Modal */}
      {selectedOrder && selectedPayment && (
        <VoidPaymentModal
          isOpen={showVoidPayment}
          onClose={() => {
            setShowVoidPayment(false)
            setSelectedOrder(null)
            setSelectedPayment(null)
          }}
          order={selectedOrder}
          payment={selectedPayment}
          locationId={employee?.location?.id || ''}
          onSuccess={() => {
            loadOrders() // Reload orders after void
          }}
        />
      )}

      {/* Reopen Order Modal */}
      {selectedOrder && (
        <ReopenOrderModal
          isOpen={showReopenOrder}
          onClose={() => {
            setShowReopenOrder(false)
            setSelectedOrder(null)
          }}
          order={selectedOrder}
          locationId={employee?.location?.id || ''}
          onSuccess={() => {
            loadOrders() // Reload orders after reopen
          }}
        />
      )}
    </div>
  )
}
