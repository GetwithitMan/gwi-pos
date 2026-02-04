'use client'

import { useState } from 'react'
import { ManagerPinModal } from '@/components/auth/ManagerPinModal'
import { toast } from '@/stores/toast-store'
import { formatDateTime } from '@/lib/utils'

interface Order {
  id: string
  orderNumber: number
  status: string
  total: number
  closedAt?: string
  employee?: { firstName: string; lastName: string }
  tabName?: string
  customer?: { firstName: string; lastName: string }
}

interface ReopenOrderModalProps {
  isOpen: boolean
  onClose: () => void
  order: Order
  locationId: string
  onSuccess: () => void
}

const REOPEN_REASONS = [
  { value: 'forgot_items', label: 'Forgot to Add Items' },
  { value: 'customer_returned', label: 'Customer Returned' },
  { value: 'closed_by_mistake', label: 'Closed by Mistake' },
  { value: 'payment_issue', label: 'Payment Issue' },
  { value: 'tip_adjustment', label: 'Tip Adjustment Needed' },
  { value: 'other', label: 'Other (explain below)' },
]

export function ReopenOrderModal({
  isOpen,
  onClose,
  order,
  locationId,
  onSuccess,
}: ReopenOrderModalProps) {
  const [selectedReason, setSelectedReason] = useState('')
  const [notes, setNotes] = useState('')
  const [showPinModal, setShowPinModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleConfirm = () => {
    if (!selectedReason) {
      toast.error('Please select a reopen reason')
      return
    }
    if (selectedReason === 'other' && !notes.trim()) {
      toast.error('Please explain the reason for reopening')
      return
    }
    setShowPinModal(true)
  }

  const handlePinVerified = async (managerId: string, managerName: string) => {
    setIsSubmitting(true)
    setShowPinModal(false)

    try {
      const res = await fetch(`/api/orders/${order.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: selectedReason,
          notes: notes.trim(),
          managerId,
        }),
      })

      if (res.ok) {
        const { data } = await res.json()
        toast.success(`Order #${order.orderNumber} reopened by ${managerName}`)
        onSuccess()
        onClose()
      } else {
        const { error } = await res.json()
        toast.error(error || 'Failed to reopen order')
      }
    } catch (error) {
      console.error('Reopen order error:', error)
      toast.error('Failed to reopen order')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const closedByName = order.employee
    ? `${order.employee.firstName} ${order.employee.lastName}`
    : 'Unknown'

  const customerName = order.customer
    ? `${order.customer.firstName} ${order.customer.lastName}`
    : order.tabName || 'Guest'

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 rounded-xl p-6 w-full max-w-md border border-white/10">
          <h2 className="text-xl font-bold text-white mb-4">
            Reopen Order - #{order.orderNumber}
          </h2>

          <div className="space-y-4">
            {/* Order Info */}
            <div className="text-sm text-slate-400 space-y-1 bg-white/5 p-3 rounded-lg">
              <p>Customer: <span className="text-slate-300">{customerName}</span></p>
              <p>
                Current Status:{' '}
                <span className={`text-slate-300 font-semibold ${
                  order.status === 'closed' ? 'text-gray-300' :
                  order.status === 'paid' ? 'text-green-400' :
                  order.status === 'voided' ? 'text-red-400' : ''
                }`}>
                  {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                </span>
              </p>
              <p>Total: <span className="text-slate-300">${order.total.toFixed(2)}</span></p>
              {order.closedAt && (
                <p>
                  Closed At: <span className="text-slate-300">{formatDateTime(order.closedAt)}</span>
                </p>
              )}
              <p>Closed By: <span className="text-slate-300">{closedByName}</span></p>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="font-semibold">Warning</p>
                <p className="text-xs mt-1 text-amber-300">
                  Reopening this order will change its status to 'open' and it will appear
                  in the Open Orders panel. This should only be done if you need to make
                  changes to the order.
                </p>
              </div>
            </div>

            {/* Reopen Reason */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                Reopen Reason <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Select Reason</option>
                {REOPEN_REASONS.map((reason) => (
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
            <div className="flex items-center gap-2 text-sm text-indigo-400 bg-indigo-500/10 p-3 rounded-lg border border-indigo-500/20">
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
                className="flex-1 px-4 py-2 bg-indigo-600 rounded-lg text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Reopening...' : 'Reopen - PIN Required'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ManagerPinModal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onVerified={handlePinVerified}
        title="Manager Authorization Required"
        message="Enter manager PIN to reopen order"
        locationId={locationId}
      />
    </>
  )
}
