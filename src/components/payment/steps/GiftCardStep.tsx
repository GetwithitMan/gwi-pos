/**
 * Gift Card Entry Step
 *
 * Handles gift card number entry, balance lookup, and payment processing.
 */

import React from 'react'

interface GiftCardInfo {
  cardNumber: string
  balance: number
  isActive: boolean
}

interface GiftCardStepProps {
  amountDue: number
  giftCardNumber: string
  giftCardInfo: GiftCardInfo | null
  isLoading: boolean
  error: string | null
  onSetGiftCardNumber: (number: string) => void
  onCheckBalance: () => void
  onComplete: () => void
  onBack: () => void
}

export function GiftCardStep({
  amountDue,
  giftCardNumber,
  giftCardInfo,
  isLoading,
  error,
  onSetGiftCardNumber,
  onCheckBalance,
  onComplete,
  onBack,
}: GiftCardStepProps) {
  const canCheckBalance = giftCardNumber.length >= 10 && !isLoading
  const canComplete =
    giftCardInfo &&
    giftCardInfo.isActive &&
    giftCardInfo.balance >= amountDue

  return (
    <div className="space-y-3">
      {/* Amount due */}
      <div className="p-3 bg-purple-50 rounded-lg mb-3">
        <div className="flex justify-between font-bold text-lg">
          <span>Amount Due:</span>
          <span className="text-purple-600">${amountDue.toFixed(2)}</span>
        </div>
      </div>

      {/* Gift card number input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Gift Card Number
        </label>
        <input
          type="text"
          value={giftCardNumber}
          onChange={(e) => onSetGiftCardNumber(e.target.value)}
          placeholder="Enter or scan card number"
          className="w-full px-3 py-2 border rounded-lg text-lg"
          autoFocus
        />
      </div>

      {/* Check balance button */}
      {!giftCardInfo && (
        <button
          onClick={onCheckBalance}
          disabled={!canCheckBalance}
          className={`w-full px-4 py-3 rounded-lg font-bold ${
            canCheckBalance
              ? 'bg-purple-500 hover:bg-purple-600 text-white'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Checking Balance...
            </span>
          ) : (
            'Check Balance'
          )}
        </button>
      )}

      {/* Error message */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Gift card info */}
      {giftCardInfo && (
        <div className="space-y-2">
          <div className="p-3 bg-white border rounded-lg">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Card Number:</span>
              <span className="font-mono">{giftCardInfo.cardNumber}</span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Status:</span>
              <span
                className={
                  giftCardInfo.isActive
                    ? 'text-green-600 font-bold'
                    : 'text-red-600 font-bold'
                }
              >
                {giftCardInfo.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t">
              <span>Balance:</span>
              <span className="text-purple-600">
                ${giftCardInfo.balance.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Insufficient balance warning */}
          {giftCardInfo.balance < amountDue && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
              Insufficient balance. This card has ${giftCardInfo.balance.toFixed(2)}{' '}
              but ${amountDue.toFixed(2)} is required.
            </div>
          )}

          {/* Inactive card warning */}
          {!giftCardInfo.isActive && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              This gift card is inactive and cannot be used.
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-4">
        <button
          onClick={onBack}
          className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold"
        >
          Back
        </button>
        {giftCardInfo && (
          <button
            onClick={onComplete}
            disabled={!canComplete}
            className={`flex-1 px-4 py-3 rounded-lg font-bold ${
              canComplete
                ? 'bg-purple-500 hover:bg-purple-600 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Apply Gift Card
          </button>
        )}
      </div>
    </div>
  )
}
