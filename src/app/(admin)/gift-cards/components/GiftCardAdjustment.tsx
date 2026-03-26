'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

interface GiftCardAdjustmentProps {
  cardId: string
  currentBalance: number
  onSuccess: () => void
  onCancel: () => void
}

export function GiftCardAdjustment({ cardId, currentBalance, onSuccess, onCancel }: GiftCardAdjustmentProps) {
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const numAmount = parseFloat(amount)
    if (!numAmount || numAmount <= 0) {
      toast.error('Enter a positive amount')
      return
    }
    if (!reason.trim()) {
      toast.error('Reason is required for balance adjustments')
      return
    }

    const adjustedAmount = direction === 'debit' ? -numAmount : numAmount

    // Check if debit would exceed balance
    if (direction === 'debit' && numAmount > currentBalance) {
      toast.error(`Cannot debit ${formatCurrency(numAmount)} — current balance is ${formatCurrency(currentBalance)}`)
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(`/api/gift-cards/${cardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust',
          amount: adjustedAmount,
          notes: reason.trim(),
        }),
      })

      if (response.ok) {
        toast.success(`Balance adjusted by ${direction === 'credit' ? '+' : '-'}${formatCurrency(numAmount)}`)
        onSuccess()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to adjust balance')
      }
    } catch (error) {
      toast.error('Failed to adjust balance')
    } finally {
      setSubmitting(false)
    }
  }

  const previewBalance = (() => {
    const num = parseFloat(amount) || 0
    return direction === 'credit'
      ? currentBalance + num
      : Math.max(0, currentBalance - num)
  })()

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Adjust Balance</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Direction toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDirection('credit')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              direction === 'credit'
                ? 'bg-green-100 text-green-700 border-2 border-green-300'
                : 'bg-gray-50 text-gray-600 border-2 border-transparent hover:bg-gray-100'
            }`}
          >
            + Credit
          </button>
          <button
            type="button"
            onClick={() => setDirection('debit')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              direction === 'debit'
                ? 'bg-red-100 text-red-700 border-2 border-red-300'
                : 'bg-gray-50 text-gray-600 border-2 border-transparent hover:bg-gray-100'
            }`}
          >
            - Debit
          </button>
        </div>

        {/* Amount input */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-2 text-gray-400">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="0.00"
              step="0.01"
              min="0.01"
              required
            />
          </div>
        </div>

        {/* Preview */}
        {amount && parseFloat(amount) > 0 && (
          <div className="p-2 rounded-lg bg-gray-50 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Current:</span>
              <span className="font-medium">{formatCurrency(currentBalance)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{direction === 'credit' ? 'Add' : 'Remove'}:</span>
              <span className={`font-medium ${direction === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                {direction === 'credit' ? '+' : '-'}{formatCurrency(parseFloat(amount) || 0)}
              </span>
            </div>
            <div className="flex justify-between border-t border-gray-200 mt-1 pt-1">
              <span className="text-gray-500 font-medium">New balance:</span>
              <span className="font-bold">{formatCurrency(previewBalance)}</span>
            </div>
          </div>
        )}

        {/* Reason */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Reason (required)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            placeholder="Reason for adjustment..."
            rows={2}
            required
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={direction === 'credit' ? 'primary' : 'danger'}
            size="sm"
            className="flex-1"
            disabled={submitting}
          >
            {submitting ? 'Adjusting...' : `Apply ${direction === 'credit' ? 'Credit' : 'Debit'}`}
          </Button>
        </div>
      </form>
    </Card>
  )
}
