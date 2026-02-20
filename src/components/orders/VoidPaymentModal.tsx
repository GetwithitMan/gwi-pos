'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { ManagerPinModal } from '@/components/auth/ManagerPinModal'
import { toast } from '@/stores/toast-store'

interface Payment {
  id: string
  amount: number
  tipAmount: number
  totalAmount: number
  paymentMethod: string
  cardLast4?: string
  cardBrand?: string
  settledAt?: string | null
  datacapRecordNo?: string | null
}

interface PaymentReader {
  id: string
  name: string
  isActive: boolean
}

interface Order {
  id: string
  orderNumber: number
  total: number
  tabName?: string
  customer?: { firstName: string; lastName: string }
}

interface VoidPaymentModalProps {
  isOpen: boolean
  onClose: () => void
  order: Order
  payment: Payment
  locationId: string
  onSuccess: () => void
  readers?: PaymentReader[]
}

const VOID_REASONS = [
  { value: 'duplicate_charge', label: 'Duplicate Charge' },
  { value: 'customer_dispute', label: 'Customer Dispute' },
  { value: 'processing_error', label: 'Processing Error' },
  { value: 'wrong_amount', label: 'Wrong Amount Charged' },
  { value: 'manager_override', label: 'Manager Override' },
  { value: 'other', label: 'Other (explain below)' },
]

export function VoidPaymentModal({
  isOpen,
  onClose,
  order,
  payment,
  locationId,
  onSuccess,
  readers,
}: VoidPaymentModalProps) {
  const [selectedReason, setSelectedReason] = useState('')
  const [notes, setNotes] = useState('')
  const [showPinModal, setShowPinModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingAction, setPendingAction] = useState<'void' | 'refund'>('void')
  const [refundAmount, setRefundAmount] = useState<string>('')
  const [refundAmountError, setRefundAmountError] = useState('')
  const [selectedReaderId, setSelectedReaderId] = useState('')

  // Pre-fill refund amount when modal opens
  useEffect(() => {
    if (isOpen) {
      setRefundAmount(Number(payment?.amount || 0).toFixed(2))
      setRefundAmountError('')
      setPendingAction(payment?.settledAt ? 'refund' : 'void')
      setSelectedReaderId(readers?.find((r) => r.isActive)?.id ?? '')
    }
  }, [isOpen, payment?.amount, payment?.settledAt, readers])

  const isSettled = Boolean(payment.settledAt)
  const isCardPayment =
    payment.paymentMethod === 'credit' || payment.paymentMethod === 'debit'

  const handleConfirm = (action: 'void' | 'refund') => {
    if (!selectedReason) {
      toast.error('Please select a reason')
      return
    }
    if (selectedReason === 'other' && !notes.trim()) {
      toast.error('Please explain the reason')
      return
    }
    if (action === 'refund') {
      const amount = parseFloat(refundAmount)
      if (isNaN(amount) || amount <= 0) {
        setRefundAmountError('Enter a valid refund amount')
        return
      }
      if (amount > Number(payment.amount)) {
        setRefundAmountError(`Cannot exceed $${Number(payment.amount).toFixed(2)}`)
        return
      }
    }
    setPendingAction(action)
    setShowPinModal(true)
  }

  const handlePinVerified = async (managerId: string, managerName: string) => {
    setIsSubmitting(true)
    setShowPinModal(false)

    if (pendingAction === 'refund') {
      const amount = parseFloat(refundAmount)
      try {
        const res = await fetch(`/api/orders/${order.id}/refund-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentId: payment.id,
            refundAmount: amount,
            refundReason: selectedReason,
            notes: notes.trim(),
            managerId,
            readerId: selectedReaderId || undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Refund failed')
        toast.success(
          data.data.isPartial
            ? `Partial refund of $${amount.toFixed(2)} processed by ${managerName}`
            : `Full refund of $${amount.toFixed(2)} processed by ${managerName}`
        )
        onSuccess()
        onClose()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Refund failed')
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    // Existing void path
    try {
      const res = await fetch(`/api/orders/${order.id}/void-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: payment.id,
          reason: selectedReason,
          notes: notes.trim(),
          managerId,
        }),
      })

      if (res.ok) {
        toast.warning(
          `Payment voided - $${payment.totalAmount.toFixed(2)} by ${managerName}`
        )
        onSuccess()
        onClose()
      } else {
        const { error } = await res.json()
        toast.error(error || 'Failed to void payment')
      }
    } catch (error) {
      console.error('Void payment error:', error)
      toast.error('Failed to void payment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const paymentMethodDisplay = (() => {
    if (payment.paymentMethod === 'credit' || payment.paymentMethod === 'debit') {
      return `${payment.cardBrand || 'Card'} ****${payment.cardLast4 || '????'}`
    }
    return payment.paymentMethod.charAt(0).toUpperCase() + payment.paymentMethod.slice(1)
  })()

  const customerName = order.customer
    ? `${order.customer.firstName} ${order.customer.lastName}`
    : order.tabName || 'Guest'

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="md">
        <div className="bg-slate-900 rounded-xl p-6 border border-white/10">
          <h2 className="text-xl font-bold text-white mb-4">
            {isSettled ? 'Refund Payment' : 'Void Payment'} - Order #{order.orderNumber}
          </h2>

          <div className="space-y-4">
            {/* Warning — only shown for void path */}
            {!isSettled && (
              <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="font-semibold">WARNING: This cannot be undone</p>
                  <p className="text-xs mt-1 text-red-300">
                    This marks the payment as voided in the system. To process an actual refund,
                    you must do so through the payment processor separately.
                  </p>
                </div>
              </div>
            )}

            {/* Payment Info */}
            <div className="text-sm text-slate-400 space-y-1 bg-white/5 p-3 rounded-lg">
              <p>Customer: <span className="text-slate-300">{customerName}</span></p>
              <p>Order Total: <span className="text-slate-300">${order.total.toFixed(2)}</span></p>
              <p>Payment: <span className="text-slate-300">{paymentMethodDisplay}</span></p>
              <p>Amount: <span className="text-slate-300">${payment.amount.toFixed(2)}</span></p>
              <p>Tip: <span className="text-slate-300">${payment.tipAmount.toFixed(2)}</span></p>
              <p className="pt-1 border-t border-white/10">
                Total Payment: <span className="text-white font-semibold">${payment.totalAmount.toFixed(2)}</span>
              </p>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                {isSettled ? 'Refund Reason' : 'Void Reason'} <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select Reason</option>
                {VOID_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Additional Notes */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                Additional Notes {selectedReason === 'other' && <span className="text-red-400">*</span>}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                rows={3}
                placeholder="Provide additional details..."
              />
            </div>

            {/* Settled / Refund Section */}
            {isSettled && (
              <div className="space-y-3 border border-amber-500/30 rounded-lg p-3 bg-amber-500/5">
                <div className="flex items-start gap-2 text-sm text-amber-400">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>
                    This payment has been settled. A refund will be issued to the{' '}
                    {isCardPayment ? 'card' : 'original payment method'}.
                  </span>
                </div>

                {/* Refund Amount */}
                <div>
                  <label className="block text-sm text-slate-300 mb-1">
                    Refund Amount <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={Number(payment.amount).toFixed(2)}
                      value={refundAmount}
                      onChange={(e) => {
                        setRefundAmount(e.target.value)
                        setRefundAmountError('')
                      }}
                      className="w-full pl-7 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  {refundAmountError && (
                    <p className="text-xs text-red-400 mt-1">{refundAmountError}</p>
                  )}
                  <p className="text-xs text-slate-500 mt-1">
                    Min: $0.01 | Max: ${Number(payment.amount).toFixed(2)}
                  </p>
                  {refundAmount && parseFloat(refundAmount) > 0 && parseFloat(refundAmount) < Number(payment.amount) && (
                    <p className="text-xs text-amber-400 mt-1">
                      Partial refund — customer keeps $
                      {(Number(payment.amount) - parseFloat(refundAmount)).toFixed(2)} of the
                      original ${Number(payment.amount).toFixed(2)} charge
                    </p>
                  )}
                </div>

                {/* Reader selection (card payments only, when readers provided) */}
                {isCardPayment && readers && readers.length > 0 && (
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      Payment Reader
                    </label>
                    <select
                      value={selectedReaderId}
                      onChange={(e) => setSelectedReaderId(e.target.value)}
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="">None (card-not-present)</option>
                      {readers.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}{r.isActive ? ' (active)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Manager PIN Warning */}
            <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Requires Manager PIN</span>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>

              {isSettled ? (
                <>
                  {/* Primary: Refund */}
                  <button
                    type="button"
                    onClick={() => handleConfirm('refund')}
                    disabled={isSubmitting || !selectedReason || (selectedReason === 'other' && !notes.trim())}
                    className="flex-1 px-4 py-2 bg-amber-600 rounded-lg text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting && pendingAction === 'refund'
                      ? 'Refunding...'
                      : `Refund $${refundAmount || Number(payment.amount).toFixed(2)} - PIN`}
                  </button>
                  {/* Secondary: Void anyway */}
                  <button
                    type="button"
                    onClick={() => handleConfirm('void')}
                    disabled={isSubmitting || !selectedReason || (selectedReason === 'other' && !notes.trim())}
                    className="px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-slate-400 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    title="Override: void without processing refund through payment processor"
                  >
                    {isSubmitting && pendingAction === 'void' ? 'Voiding...' : 'Void Anyway'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleConfirm('void')}
                  disabled={isSubmitting || !selectedReason || (selectedReason === 'other' && !notes.trim())}
                  className="flex-1 px-4 py-2 bg-red-600 rounded-lg text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Voiding...' : 'Void - PIN Required'}
                </button>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <ManagerPinModal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onVerified={handlePinVerified}
        title="Manager Authorization Required"
        message="Enter manager PIN to void payment"
        locationId={locationId}
      />
    </>
  )
}
