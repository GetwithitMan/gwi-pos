/**
 * Tip Entry Step
 *
 * Displays tip percentage buttons and custom tip input.
 * Calculates tip amount based on subtotal or total.
 */

import React from 'react'

interface TipEntryStepProps {
  subtotal: number
  tipAmount: number
  customTip: string
  onSetTipAmount: (amount: number) => void
  onSetCustomTip: (value: string) => void
  onContinue: () => void
  onBack: () => void
  tipPercentages?: number[]
  calculateOn?: 'subtotal' | 'total'
  total?: number
}

export function TipEntryStep({
  subtotal,
  tipAmount,
  customTip,
  onSetTipAmount,
  onSetCustomTip,
  onContinue,
  onBack,
  tipPercentages = [15, 18, 20, 25],
  calculateOn = 'subtotal',
  total,
}: TipEntryStepProps) {
  const baseAmount = calculateOn === 'total' && total ? total : subtotal

  const calculateTip = (percent: number) => {
    return Math.round(baseAmount * (percent / 100) * 100) / 100
  }

  const handleCustomTipChange = (value: string) => {
    onSetCustomTip(value)
    const amount = parseFloat(value)
    if (!isNaN(amount) && amount >= 0) {
      onSetTipAmount(amount)
    }
  }

  const totalWithTip = subtotal + tipAmount

  return (
    <div className="space-y-3">
      <div className="text-center text-gray-600 mb-3">
        Add a tip? (calculated on {calculateOn === 'total' ? 'total' : 'subtotal'})
      </div>

      {/* Percentage buttons */}
      <div className="grid grid-cols-4 gap-2">
        {tipPercentages.map((percent) => {
          const amount = calculateTip(percent)
          const isSelected = Math.abs(tipAmount - amount) < 0.01
          return (
            <button
              key={percent}
              onClick={() => onSetTipAmount(amount)}
              className={`p-3 rounded-lg font-bold transition-all ${
                isSelected
                  ? 'bg-green-500 text-white ring-2 ring-green-300'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              <div className="text-sm">{percent}%</div>
              <div className="text-xs mt-1">${amount.toFixed(2)}</div>
            </button>
          )
        })}
      </div>

      {/* No tip and custom tip */}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => {
            onSetTipAmount(0)
            onSetCustomTip('')
          }}
          className={`px-4 py-2 rounded-lg font-bold transition-all ${
            tipAmount === 0
              ? 'bg-gray-500 text-white'
              : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
          }`}
        >
          No Tip
        </button>

        <div className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              $
            </span>
            <input
              type="number"
              value={customTip}
              onChange={(e) => handleCustomTipChange(e.target.value)}
              placeholder="Custom"
              step="0.01"
              min="0"
              className="w-full pl-7 pr-3 py-2 border rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Total preview */}
      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <div className="flex justify-between font-bold">
          <span>Total with Tip:</span>
          <span className="text-blue-600">${totalWithTip.toFixed(2)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-4">
        <button
          onClick={onBack}
          className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
