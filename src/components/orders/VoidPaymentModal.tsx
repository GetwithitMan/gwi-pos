'use client'

import { useState } from 'react'
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
}: VoidPaymentModalProps) {
  const [selectedReason, setSelectedReason] = useState('')
  const [notes, setNotes] = useState('')
  const [showPinModal, setShowPinModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleConfirm = () => {
    if (!selectedReason) {
      toast.error('Please select a void reason')
      return
    }
    if (selectedReason === 'other' && !notes.trim()) {
      toast.error('Please explain the reason for voiding')
      return
    }
    setShowPinModal(true)
  }

  const handlePinVerified = async (managerId: string, managerName: string) => {
    setIsSubmitting(true)
    setShowPinModal(false)

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
        const { data } = await res.json()
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
            Void Payment - Order #{order.orderNumber}
          </h2>

          <div className="space-y-4">
            {/* Warning */}
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

            {/* Void Reason */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                Void Reason <span className="text-red-400">*</span>
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
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting || !selectedReason || (selectedReason === 'other' && !notes.trim())}
                className="flex-1 px-4 py-2 bg-red-600 rounded-lg text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Voiding...' : 'Void - PIN Required'}
              </button>
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
