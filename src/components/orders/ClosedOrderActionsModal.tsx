'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { hasPermission } from '@/lib/auth-utils'
import { useAuthStore } from '@/stores/auth-store'

interface Payment {
  id: string
  amount: number
  tipAmount: number
  totalAmount: number
  paymentMethod: string
  cardBrand: string | null
  cardLast4: string | null
  status?: string
  datacapRecordNo?: string | null
}

interface ClosedOrder {
  id: string
  orderNumber: number
  displayNumber?: string
  tabName: string | null
  status: string
  total: number
  subtotal: number
  taxTotal: number
  tipTotal?: number
  closedAt?: string | null
  createdAt: string
  employee: { id: string; name: string }
  payments?: Payment[]
}

interface ClosedOrderActionsModalProps {
  isOpen: boolean
  onClose: () => void
  order: ClosedOrder
  employeeId: string
  employeePermissions: string[]
  onActionComplete: () => void
  onOpenTipAdjustment?: () => void
  currentOrderId?: string
}

const REOPEN_REASONS = [
  'Adjust payment',
  'Add items',
  'Customer dispute',
  'Manager correction',
]

const VOID_REASONS = [
  'Customer dispute',
  'Duplicate charge',
  'Wrong amount',
  'Fraud',
  'Manager correction',
]

type ActionStep = 'select' | 'reason' | 'pin' | 'amount'
type ActionType = 'reopen' | 'void' | 'rerun' | null

export function ClosedOrderActionsModal({
  isOpen,
  onClose,
  order,
  employeeId,
  employeePermissions,
  onActionComplete,
  onOpenTipAdjustment,
  currentOrderId,
}: ClosedOrderActionsModalProps) {
  const locationId = useAuthStore(s => s.locationId)
  const [action, setAction] = useState<ActionType>(null)
  const [step, setStep] = useState<ActionStep>('select')
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [rerunAmount, setRerunAmount] = useState('')
  const [sameAgainLoading, setSameAgainLoading] = useState(false)

  const canVoid = hasPermission(employeePermissions, 'manager.void_payments')
  const canReopen = hasPermission(employeePermissions, 'manager.void_orders')
  const activePayments = order.payments?.filter(p => p.status !== 'voided') || []
  const voidedPayments = order.payments?.filter(p => p.status === 'voided') || []

  const reset = () => {
    setAction(null)
    setStep('select')
    setReason('')
    setPin('')
    setPinError('')
    setSelectedPaymentId(null)
    setRerunAmount('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSameAgain = async () => {
    if (!currentOrderId) {
      toast.error('Open an order first to add items')
      return
    }
    setSameAgainLoading(true)
    try {
      // Fetch the closed order's full details to get items
      const orderRes = await fetch(`/api/orders/${order.id}`)
      if (!orderRes.ok) {
        toast.error('Failed to load order details')
        setSameAgainLoading(false)
        return
      }
      const orderData = await orderRes.json()
      const sourceItems = orderData.items || orderData.data?.items || []

      const itemsPayload = sourceItems
        .filter((item: any) => item.status === 'active' || item.status === 'sent')
        .map((item: any) => ({
          menuItemId: item.menuItemId,
          name: item.name,
          price: Number(item.price),
          quantity: item.quantity,
          modifiers: (item.modifiers || []).map((m: any) => ({
            modifierId: m.modifierId,
            name: m.name,
            price: Number(m.price),
            preModifier: m.preModifier || null,
            depth: m.depth || 0,
          })),
          specialNotes: item.specialNotes || undefined,
        }))

      if (itemsPayload.length === 0) {
        toast.error('No items to reorder')
        setSameAgainLoading(false)
        return
      }

      const addRes = await fetch(`/api/orders/${currentOrderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsPayload }),
      })
      if (!addRes.ok) {
        const errData = await addRes.json()
        toast.error(errData.error || 'Failed to add items')
        setSameAgainLoading(false)
        return
      }
      toast.success(`Added ${itemsPayload.length} item${itemsPayload.length !== 1 ? 's' : ''} to current order`)
      handleClose()
      onActionComplete()
    } catch {
      toast.error('Failed to add items')
    }
    setSameAgainLoading(false)
  }

  const verifyPin = async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, locationId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPinError(data.error || 'Invalid PIN')
        return null
      }
      return data.employee?.id || data.employeeId || data.data?.employeeId
    } catch {
      setPinError('Failed to verify PIN')
      return null
    }
  }

  const executeReopen = async () => {
    setLoading(true)
    const managerId = await verifyPin()
    if (!managerId) { setLoading(false); return }

    try {
      const res = await fetch(`/api/orders/${order.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, managerId }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to reopen order')
        setLoading(false)
        return
      }
      toast.success(`Order #${order.orderNumber} reopened`)
      handleClose()
      onActionComplete()
    } catch {
      toast.error('Failed to reopen order')
    }
    setLoading(false)
  }

  const executeVoidPayment = async () => {
    if (!selectedPaymentId) return
    setLoading(true)
    const managerId = await verifyPin()
    if (!managerId) { setLoading(false); return }

    try {
      const res = await fetch(`/api/orders/${order.id}/void-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: selectedPaymentId, reason, managerId }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to void payment')
        setLoading(false)
        return
      }
      toast.success('Payment voided successfully')
      handleClose()
      onActionComplete()
    } catch {
      toast.error('Failed to void payment')
    }
    setLoading(false)
  }

  const executeRerun = async () => {
    if (!selectedPaymentId) return
    setLoading(true)
    const managerId = await verifyPin()
    if (!managerId) { setLoading(false); return }

    const amount = parseFloat(rerunAmount)
    if (isNaN(amount) || amount <= 0) {
      setPinError('Enter a valid amount')
      setLoading(false)
      return
    }

    // Phase 1: Create a new payment record (actual Datacap call in Phase 2)
    try {
      const res = await fetch(`/api/orders/${order.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments: [{
            method: 'credit',
            amount,
            tipAmount: 0,
            cardBrand: voidedPayments.find(p => p.id === selectedPaymentId)?.cardBrand || 'Unknown',
            cardLast4: voidedPayments.find(p => p.id === selectedPaymentId)?.cardLast4 || '0000',
          }],
          employeeId: managerId,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to re-run payment')
        setLoading(false)
        return
      }
      toast.success(`Re-charged ${formatCurrency(amount)} to card`)
      handleClose()
      onActionComplete()
    } catch {
      toast.error('Failed to re-run payment')
    }
    setLoading(false)
  }

  const handleExecute = () => {
    if (action === 'reopen') executeReopen()
    else if (action === 'void') executeVoidPayment()
    else if (action === 'rerun') executeRerun()
  }

  const getPaymentStatusBanner = (payment: Payment) => {
    if (!payment.datacapRecordNo) {
      return { text: 'Card must be present for void/refund', color: 'text-amber-400 bg-amber-900/30' }
    }
    // Check if same day (simple heuristic — before midnight)
    const paymentDate = order.closedAt ? new Date(order.closedAt).toDateString() : ''
    const today = new Date().toDateString()
    if (paymentDate === today) {
      return { text: 'Void available (full reversal, no charge to card)', color: 'text-green-400 bg-green-900/30' }
    }
    return { text: 'Settled — refund will take 3-5 business days', color: 'text-blue-400 bg-blue-900/30' }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg">
      <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              Order #{order.displayNumber || order.orderNumber}
              {order.tabName && <span className="text-slate-400 ml-2">· {order.tabName}</span>}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {order.closedAt ? `Closed ${new Date(order.closedAt).toLocaleString()}` : `Created ${new Date(order.createdAt).toLocaleString()}`}
              {' · '}{order.employee.name}
            </p>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        {/* Order Summary */}
        <div className="px-6 py-3 border-b border-white/10">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Subtotal</span>
            <span className="text-white">{formatCurrency(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Tax</span>
            <span className="text-white">{formatCurrency(order.taxTotal)}</span>
          </div>
          {(order.tipTotal ?? 0) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Tip</span>
              <span className="text-white">{formatCurrency(order.tipTotal || 0)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold mt-1 pt-1 border-t border-white/10">
            <span className="text-white">Total</span>
            <span className="text-green-400">{formatCurrency(order.total)}</span>
          </div>

          {/* Payment details */}
          {activePayments.length > 0 && (
            <div className="mt-2 space-y-1">
              {activePayments.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs text-slate-300">
                  <span>
                    {p.paymentMethod === 'cash' ? '💵 Cash' : `💳 ${p.cardBrand || 'Card'} ****${p.cardLast4 || '????'}`}
                  </span>
                  <span>{formatCurrency(p.totalAmount)}</span>
                </div>
              ))}
            </div>
          )}
          {voidedPayments.length > 0 && (
            <div className="mt-1 space-y-1">
              {voidedPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs text-red-400 line-through opacity-60">
                  <span>
                    {p.paymentMethod === 'cash' ? '💵 Cash' : `💳 ${p.cardBrand || 'Card'} ****${p.cardLast4 || '????'}`}
                  </span>
                  <span>{formatCurrency(p.totalAmount)} (voided)</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Area */}
        <div className="px-6 py-4 max-h-[50vh] overflow-y-auto">
          {step === 'select' && (
            <div className="space-y-2">
              {canReopen && (
                <button
                  onClick={() => { setAction('reopen'); setStep('reason') }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left"
                >
                  <span className="text-2xl">🔓</span>
                  <div>
                    <div className="font-bold text-white">Reopen Order</div>
                    <div className="text-xs text-slate-400">Reopen to adjust items or payment</div>
                  </div>
                </button>
              )}

              {canVoid && activePayments.length > 0 && (
                <button
                  onClick={() => {
                    setAction('void')
                    if (activePayments.length === 1) {
                      setSelectedPaymentId(activePayments[0].id)
                      setStep('reason')
                    } else {
                      setStep('reason') // Will show payment selector in reason step
                    }
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left"
                >
                  <span className="text-2xl">🚫</span>
                  <div>
                    <div className="font-bold text-white">Void Payment</div>
                    <div className="text-xs text-slate-400">Void a payment on this order</div>
                  </div>
                </button>
              )}

              {canVoid && voidedPayments.some(p => p.datacapRecordNo) && (
                <button
                  onClick={() => {
                    setAction('rerun')
                    const rerunnable = voidedPayments.find(p => p.datacapRecordNo)
                    if (rerunnable) {
                      setSelectedPaymentId(rerunnable.id)
                      setRerunAmount(String(order.total))
                    }
                    setStep('amount')
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left"
                >
                  <span className="text-2xl">🔄</span>
                  <div>
                    <div className="font-bold text-white">Re-run Payment</div>
                    <div className="text-xs text-slate-400">Re-charge a voided card for a new amount</div>
                  </div>
                </button>
              )}

              {onOpenTipAdjustment && (
                <button
                  onClick={() => { handleClose(); onOpenTipAdjustment() }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left"
                >
                  <span className="text-2xl">💰</span>
                  <div>
                    <div className="font-bold text-white">Adjust Tip</div>
                    <div className="text-xs text-slate-400">Modify tip amount on this order</div>
                  </div>
                </button>
              )}

              {currentOrderId && (
                <button
                  onClick={handleSameAgain}
                  disabled={sameAgainLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="text-2xl">🔄</span>
                  <div>
                    <div className="font-bold text-white">{sameAgainLoading ? 'Adding Items...' : 'Same Again'}</div>
                    <div className="text-xs text-slate-400">Add these items to current order</div>
                  </div>
                </button>
              )}

              {!canReopen && !canVoid && !onOpenTipAdjustment && !currentOrderId && (
                <p className="text-center text-slate-400 py-4">No actions available for your role</p>
              )}
            </div>
          )}

          {/* Reason step */}
          {step === 'reason' && (
            <div className="space-y-3">
              <h3 className="font-bold text-white text-sm">
                {action === 'reopen' ? 'Reason for Reopening' : 'Reason for Void'}
              </h3>

              {/* Payment selector for void with multiple payments */}
              {action === 'void' && activePayments.length > 1 && (
                <div className="space-y-2 mb-3">
                  <p className="text-xs text-slate-400">Select payment to void:</p>
                  {activePayments.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPaymentId(p.id)}
                      className={`w-full flex items-center justify-between p-2 rounded-lg border text-sm transition-colors ${
                        selectedPaymentId === p.id
                          ? 'border-red-500 bg-red-900/20 text-white'
                          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <span>{p.paymentMethod === 'cash' ? '💵 Cash' : `💳 ${p.cardBrand || 'Card'} ****${p.cardLast4}`}</span>
                      <span className="font-bold">{formatCurrency(p.totalAmount)}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Datacap status banner for void */}
              {action === 'void' && selectedPaymentId && (() => {
                const payment = activePayments.find(p => p.id === selectedPaymentId)
                if (!payment || payment.paymentMethod === 'cash') return null
                const banner = getPaymentStatusBanner(payment)
                return (
                  <div className={`px-3 py-2 rounded-lg text-xs font-medium ${banner.color}`}>
                    {banner.text}
                  </div>
                )
              })()}

              {/* Reason buttons */}
              <div className="space-y-1.5">
                {(action === 'reopen' ? REOPEN_REASONS : VOID_REASONS).map(r => (
                  <button
                    key={r}
                    onClick={() => setReason(r)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      reason === r
                        ? 'bg-indigo-600 text-white font-bold'
                        : 'bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={reset} className="flex-1 py-2 rounded-lg bg-white/10 text-slate-300 text-sm font-medium hover:bg-white/15">
                  Back
                </button>
                <button
                  onClick={() => setStep('pin')}
                  disabled={!reason || (action === 'void' && !selectedPaymentId)}
                  className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Amount step (re-run) */}
          {step === 'amount' && action === 'rerun' && (
            <div className="space-y-3">
              <h3 className="font-bold text-white text-sm">Re-run Payment Amount</h3>

              {selectedPaymentId && (() => {
                const payment = voidedPayments.find(p => p.id === selectedPaymentId)
                if (!payment) return null
                return (
                  <div className="px-3 py-2 rounded-lg text-xs font-medium text-amber-400 bg-amber-900/30">
                    This will charge <span className="font-bold">****{payment.cardLast4}</span> ({payment.cardBrand}) for the new amount.
                    To charge a different card, the card must be present.
                  </div>
                )
              })()}

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Amount to charge</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={rerunAmount}
                    onChange={(e) => setRerunAmount(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white text-lg font-bold focus:outline-none focus:border-indigo-500"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={reset} className="flex-1 py-2 rounded-lg bg-white/10 text-slate-300 text-sm font-medium hover:bg-white/15">
                  Back
                </button>
                <button
                  onClick={() => setStep('pin')}
                  disabled={!rerunAmount || parseFloat(rerunAmount) <= 0}
                  className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* PIN step */}
          {step === 'pin' && (
            <div className="space-y-3">
              <h3 className="font-bold text-white text-sm">Manager PIN Required</h3>
              <p className="text-xs text-slate-400">
                {action === 'reopen' && `Reopening order #${order.orderNumber}: "${reason}"`}
                {action === 'void' && `Voiding payment: "${reason}"`}
                {action === 'rerun' && `Re-charging ${formatCurrency(parseFloat(rerunAmount) || 0)}`}
              </p>

              <div className="flex justify-center gap-2">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-2xl font-bold ${
                      pin.length > i ? 'border-indigo-500 bg-indigo-900/30 text-white' : 'border-white/20 bg-white/5 text-transparent'
                    }`}
                  >
                    {pin.length > i ? '•' : ''}
                  </div>
                ))}
              </div>

              {pinError && <p className="text-center text-red-400 text-xs">{pinError}</p>}

              {/* Number pad */}
              <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((key, idx) => {
                  if (key === null) return <div key={idx} />
                  if (key === 'del') {
                    return (
                      <button
                        key={idx}
                        onClick={() => { setPin(p => p.slice(0, -1)); setPinError('') }}
                        className="py-3 rounded-lg bg-white/10 text-slate-300 text-sm font-bold hover:bg-white/15"
                      >
                        ←
                      </button>
                    )
                  }
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        if (pin.length < 4) {
                          setPin(p => p + key)
                          setPinError('')
                        }
                      }}
                      className="py-3 rounded-lg bg-white/10 text-white text-lg font-bold hover:bg-white/15"
                    >
                      {key}
                    </button>
                  )
                })}
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => { setStep(action === 'rerun' ? 'amount' : 'reason'); setPin(''); setPinError('') }} className="flex-1 py-2 rounded-lg bg-white/10 text-slate-300 text-sm font-medium hover:bg-white/15">
                  Back
                </button>
                <button
                  onClick={handleExecute}
                  disabled={pin.length !== 4 || loading}
                  className={`flex-1 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed ${
                    action === 'void' ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {loading ? 'Processing...' : action === 'reopen' ? 'Reopen Order' : action === 'void' ? 'Void Payment' : 'Re-run Payment'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
