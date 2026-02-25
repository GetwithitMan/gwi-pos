'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

interface TipPromptSelectorProps {
  orderAmount: number
  tipDollarAmountThreshold: number   // Under this, show $ amounts (default: 15)
  tipDollarSuggestions: number[]     // e.g., [1, 2, 3]
  tipPercentSuggestions: number[]    // e.g., [18, 20, 25]
  requireCustomForZeroTip: boolean   // Must tap Custom → enter 0 to skip
  onSelectTip: (amount: number) => void
  onCancel?: () => void
}

/**
 * Tip Prompt Selector — smart tip buttons based on order amount.
 *
 * Under threshold ($15 default): Show dollar amounts ($1, $2, $3, Custom)
 * Over threshold: Show percentages (18%, 20%, 25%, Custom)
 * No "No Tip" button — customer must tap Custom → enter 0 to skip tip.
 */
export function TipPromptSelector({
  orderAmount,
  tipDollarAmountThreshold,
  tipDollarSuggestions,
  tipPercentSuggestions,
  requireCustomForZeroTip,
  onSelectTip,
  onCancel,
}: TipPromptSelectorProps) {
  const [showCustom, setShowCustom] = useState(false)
  const [customAmount, setCustomAmount] = useState('')

  const isUnderThreshold = orderAmount < tipDollarAmountThreshold

  const handleCustomSubmit = () => {
    const amount = parseFloat(customAmount) || 0
    onSelectTip(amount)
  }

  if (showCustom) {
    return (
      <div className="flex flex-col items-center gap-4 p-4">
        <p className="text-sm text-gray-600">Enter tip amount</p>
        <div className="relative w-48">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">$</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            aria-label="Custom tip amount"
            className="w-full pl-8 pr-3 py-3 text-2xl text-center border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            autoFocus
            placeholder="0.00"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowCustom(false)}>
            Back
          </Button>
          <Button variant="primary" onClick={handleCustomSubmit}>
            {parseFloat(customAmount) > 0
              ? `Add ${formatCurrency(parseFloat(customAmount))} Tip`
              : 'No Tip'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <div className="text-center mb-2">
        <p className="text-sm text-gray-500">Order Total</p>
        <p className="text-2xl font-bold">{formatCurrency(orderAmount)}</p>
      </div>

      <p className="text-sm font-medium text-gray-700">Add a tip?</p>

      <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
        {isUnderThreshold ? (
          // Dollar amount buttons (under threshold)
          <>
            {tipDollarSuggestions.map((dollars) => (
              <Button
                key={dollars}
                variant="outline"
                className="py-6 text-lg font-semibold"
                onClick={() => onSelectTip(dollars)}
              >
                {formatCurrency(dollars)}
              </Button>
            ))}
            <Button
              variant="outline"
              className="py-6 text-lg font-semibold"
              onClick={() => setShowCustom(true)}
            >
              Custom
            </Button>
          </>
        ) : (
          // Percentage buttons (over threshold)
          <>
            {tipPercentSuggestions.map((percent) => {
              const tipAmount = Math.round(orderAmount * (percent / 100) * 100) / 100
              return (
                <Button
                  key={percent}
                  variant="outline"
                  className="py-6 flex flex-col items-center"
                  onClick={() => onSelectTip(tipAmount)}
                >
                  <span className="text-lg font-semibold">{percent}%</span>
                  <span className="text-xs text-gray-500">{formatCurrency(tipAmount)}</span>
                </Button>
              )
            })}
            <Button
              variant="outline"
              className="py-6 text-lg font-semibold"
              onClick={() => setShowCustom(true)}
            >
              Custom
            </Button>
          </>
        )}
      </div>

      {/* No "No Tip" button when requireCustomForZeroTip is true */}
      {!requireCustomForZeroTip && (
        <Button
          variant="ghost"
          className="text-sm text-gray-400"
          onClick={() => onSelectTip(0)}
        >
          No Tip
        </Button>
      )}

      {onCancel && (
        <Button variant="ghost" className="text-sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  )
}
