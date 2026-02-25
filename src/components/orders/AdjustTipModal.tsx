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
}

interface Order {
  id: string
  orderNumber: number
  total: number
  subtotal: number
  taxTotal: number
  tabName?: string
  customer?: { firstName: string; lastName: string }
}

interface AdjustTipModalProps {
  isOpen: boolean
  onClose: () => void
  order: Order
  payment: Payment
  locationId: string
  onSuccess: () => void
}

export function AdjustTipModal({
  isOpen,
  onClose,
  order,
  payment,
  locationId,
  onSuccess,
}: AdjustTipModalProps) {
  const [newTipAmount, setNewTipAmount] = useState(payment.tipAmount)
  const [reason, setReason] = useState('')
  const [showPinModal, setShowPinModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const subtotal = order.subtotal
  const originalTipPercent = subtotal > 0 ? Math.round((payment.tipAmount / subtotal) * 100) : 0
  const newTipPercent = subtotal > 0 ? Math.round((newTipAmount / subtotal) * 100) : 0

  const handleQuickSelect = (percentage: number) => {
    setNewTipAmount(Number((subtotal * percentage).toFixed(2)))
  }

  const handleConfirm = () => {
    if (!reason.trim()) {
      toast.error('Reason is required')
      return
    }
    if (newTipAmount === payment.tipAmount) {
      toast.error('Tip amount unchanged')
      return
    }
    if (newTipAmount < 0) {
      toast.error('Tip amount cannot be negative')
      return
    }
    setShowPinModal(true)
  }

  const handlePinVerified = async (managerId: string, managerName: string) => {
    setIsSubmitting(true)
    setShowPinModal(false)

    try {
      const res = await fetch(`/api/orders/${order.id}/adjust-tip`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: payment.id,
          newTipAmount,
          reason,
          managerId,
        }),
      })

      if (res.ok) {
        const { data } = await res.json()
        toast.success(
          `Tip adjusted from $${payment.tipAmount.toFixed(2)} to $${newTipAmount.toFixed(2)} by ${managerName}`
        )
        onSuccess()
        onClose()
      } else {
        const { error } = await res.json()
        toast.error(error || 'Failed to adjust tip')
      }
    } catch (error) {
      console.error('Adjust tip error:', error)
      toast.error('Failed to adjust tip')
    } finally {
      setIsSubmitting(false)
    }
  }

  const customerName = order.customer
    ? `${order.customer.firstName} ${order.customer.lastName}`
    : order.tabName || 'Guest'

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="md">
        <div className="bg-slate-900 rounded-xl p-6 border border-white/10">
          <h2 className="text-xl font-bold text-white mb-4">
            Adjust Tip - Order #{order.orderNumber}
          </h2>

          <div className="space-y-4">
            {/* Order Info */}
            <div className="text-sm text-slate-400 space-y-1 bg-white/5 p-3 rounded-lg">
              <p>Customer: <span className="text-slate-300">{customerName}</span></p>
              <p>Original Total: <span className="text-slate-300">${order.total.toFixed(2)}</span></p>
              <p>
                Original Tip: <span className="text-slate-300">${payment.tipAmount.toFixed(2)} ({originalTipPercent}%)</span>
              </p>
            </div>

            {/* New Tip Amount */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                New Tip Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="9999.99"
                  value={newTipAmount}
                  onChange={(e) => setNewTipAmount(Number(e.target.value))}
                  onKeyDown={(e) => { if (['e','E','+','-'].includes(e.key)) e.preventDefault() }}
                  className="w-full pl-8 pr-16 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                  {newTipPercent}%
                </span>
              </div>
            </div>

            {/* Quick Select Buttons */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Quick Select:</label>
              <div className="grid grid-cols-5 gap-2">
                {[0.15, 0.18, 0.20, 0.22, 0.25].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleQuickSelect(pct)}
                    className="px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-slate-300 hover:bg-white/10 hover:border-indigo-500 transition-colors"
                  >
                    {pct * 100}%
                  </button>
                ))}
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                Reason <span className="text-red-400">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
                rows={3}
                placeholder="Customer requested change, entered incorrectly, etc."
              />
            </div>

            {/* Warning */}
            <div className="flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
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
                disabled={isSubmitting || !reason.trim()}
                className="flex-1 px-4 py-2 bg-indigo-600 rounded-lg text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Adjusting...' : 'Confirm - PIN Required'}
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
        message="Enter manager PIN to adjust tip"
        locationId={locationId}
      />
    </>
  )
}
