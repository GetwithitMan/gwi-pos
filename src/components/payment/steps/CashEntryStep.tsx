/**
 * Cash Entry Step
 *
 * Handles cash amount entry with quick buttons and change calculation.
 */

import React from 'react'

interface CashEntryStepProps {
  amountDue: number
  amountTendered: string
  customCashAmount: string
  onSetAmountTendered: (amount: string) => void
  onSetCustomCashAmount: (amount: string) => void
  onComplete: () => void
  onBack: () => void
  quickCashAmounts?: number[]
}

export function CashEntryStep({
  amountDue,
  amountTendered,
  customCashAmount,
  onSetAmountTendered,
  onSetCustomCashAmount,
  onComplete,
  onBack,
  quickCashAmounts,
}: CashEntryStepProps) {
  // Generate quick cash amounts if not provided
  const defaultQuickAmounts = React.useMemo(() => {
    const amounts: number[] = []
    amounts.push(amountDue) // Exact
    const roundTo5 = Math.ceil(amountDue / 5) * 5
    if (roundTo5 > amountDue) amounts.push(roundTo5)
    const roundTo10 = Math.ceil(amountDue / 10) * 10
    if (roundTo10 > roundTo5) amounts.push(roundTo10)
    const roundTo20 = Math.ceil(amountDue / 20) * 20
    if (roundTo20 > roundTo10) amounts.push(roundTo20)
    if (amountDue < 50 && !amounts.includes(50)) amounts.push(50)
    if (amountDue < 100 && !amounts.includes(100)) amounts.push(100)
    return [...new Set(amounts)].sort((a, b) => a - b).slice(0, 5)
  }, [amountDue])

  const amounts = quickCashAmounts || defaultQuickAmounts

  const tenderedAmount = parseFloat(amountTendered || customCashAmount || '0')
  // Change owed back to customer (never negative)
  const changeToReturn = Math.max(0, tenderedAmount - amountDue)
  const canComplete = tenderedAmount >= amountDue

  return (
    <div className="space-y-3">
      {/* Amount due display */}
      <div className="p-3 bg-green-50 rounded-lg mb-3">
        <div className="flex justify-between font-bold text-lg">
          <span>Amount Due:</span>
          <span className="text-green-600">${amountDue.toFixed(2)}</span>
        </div>
      </div>

      {/* Quick cash buttons */}
      <div className="grid grid-cols-4 gap-2">
        {amounts.map((amount) => (
          <button
            key={amount}
            onClick={() => {
              onSetAmountTendered(amount.toFixed(2))
              onSetCustomCashAmount('')
            }}
            className={`p-3 rounded-lg font-bold transition-all ${
              parseFloat(amountTendered) === amount
                ? 'bg-green-500 text-white ring-2 ring-green-300'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            ${amount.toFixed(0)}
          </button>
        ))}
      </div>

      {/* Custom amount input */}
      <div className="mt-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Custom Amount
        </label>
        <div className="flex gap-2 mt-1">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              $
            </span>
            <input
              type="number"
              value={customCashAmount}
              onChange={(e) => {
                onSetCustomCashAmount(e.target.value)
                onSetAmountTendered('')
              }}
              placeholder={`${amountDue.toFixed(2)}`}
              step="0.01"
              min={amountDue}
              className="w-full pl-7 pr-3 py-2 border rounded-lg text-lg"
            />
          </div>
        </div>

        {/* Change due display */}
        {changeToReturn > 0 && (
          <div className="mt-3 p-3 bg-yellow-50 rounded-lg">
            <div className="flex justify-between font-bold">
              <span>Change Due:</span>
              <span className="text-yellow-700">${changeToReturn.toFixed(2)}</span>
            </div>
          </div>
        )}

        {tenderedAmount > 0 && tenderedAmount < amountDue && (
          <div className="mt-3 p-3 bg-red-50 rounded-lg">
            <div className="text-red-700 text-sm">
              Amount tendered (${tenderedAmount.toFixed(2)}) is less than amount due
            </div>
          </div>
        )}
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
          onClick={onComplete}
          disabled={!canComplete}
          className={`flex-1 px-4 py-3 rounded-lg font-bold ${
            canComplete
              ? 'bg-green-500 hover:bg-green-600 text-white'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          Complete Payment
        </button>
      </div>
    </div>
  )
}
