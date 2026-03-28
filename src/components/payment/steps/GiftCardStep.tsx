'use client'

import React, { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { usePaymentContext } from '../PaymentContext'
import type { PendingPayment, GiftCardInfo } from '../PaymentContext'
import {
  sectionLabelClasses,
  inputClasses,
  backButtonClasses,
  primaryButtonClasses,
  infoPanelBase,
  infoPanelPurple,
} from '../payment-styles'

/**
 * GiftCardStep — gift card number entry, balance lookup, and payment.
 */
export function GiftCardStep() {
  const {
    totalWithTip,
    isProcessing,
    pendingPayments,
    processPayments,
    setStep,
  } = usePaymentContext()

  // Local gift card state
  const [giftCardNumber, setGiftCardNumber] = useState('')
  const [giftCardInfo, setGiftCardInfo] = useState<GiftCardInfo | null>(null)
  const [giftCardLoading, setGiftCardLoading] = useState(false)
  const [giftCardError, setGiftCardError] = useState<string | null>(null)

  const lookupGiftCard = async () => {
    if (!giftCardNumber.trim()) {
      setGiftCardError('Please enter a gift card number')
      return
    }

    setGiftCardLoading(true)
    setGiftCardError(null)

    try {
      const response = await fetch(`/api/gift-cards/${giftCardNumber.trim().toUpperCase()}`)
      if (!response.ok) {
        const data = await response.json()
        setGiftCardError(data.error || 'Gift card not found')
        setGiftCardInfo(null)
        return
      }

      const raw = await response.json()
      const data = raw.data ?? raw
      if (data.status !== 'active') {
        setGiftCardError(`Gift card is ${data.status}`)
        setGiftCardInfo(null)
        return
      }

      setGiftCardInfo(data)
    } catch {
      setGiftCardError('Failed to lookup gift card')
      setGiftCardInfo(null)
    } finally {
      setGiftCardLoading(false)
    }
  }

  const handleGiftCardPayment = () => {
    if (!giftCardInfo) return

    const maxAmount = Math.min(giftCardInfo.currentBalance, totalWithTip)

    const payment: PendingPayment = {
      method: 'gift_card',
      amount: maxAmount,
      tipAmount: 0,
      giftCardId: giftCardInfo.id,
      giftCardNumber: giftCardInfo.cardNumber,
    }
    processPayments([...pendingPayments, payment], pendingPayments)
  }

  return (
    <div className="flex flex-col gap-2.5">
      <h3 className={sectionLabelClasses}>Gift Card Payment</h3>

      <div className={`${infoPanelBase} ${infoPanelPurple}`}>
        <div className="flex justify-between font-bold text-lg font-mono">
          <span className="text-slate-400">Amount Due</span>
          <span className="text-purple-400">{formatCurrency(totalWithTip)}</span>
        </div>
      </div>

      <div>
        <label className="text-slate-400 text-[13px] block mb-1.5">Gift Card Number</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={giftCardNumber}
            onChange={(e) => setGiftCardNumber(e.target.value.toUpperCase())}
            className={`${inputClasses} flex-1 uppercase`}
            placeholder="GC-XXXX-XXXX-XXXX"
          />
          <button
            onClick={lookupGiftCard}
            disabled={giftCardLoading || !giftCardNumber.trim()}
            className={`${backButtonClasses} !flex-none !px-4 !py-2.5 ${(giftCardLoading || !giftCardNumber.trim()) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {giftCardLoading ? 'Looking...' : 'Lookup'}
          </button>
        </div>
      </div>

      {giftCardError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-[10px] text-red-400 text-sm">
          {giftCardError}
        </div>
      )}

      {giftCardInfo && (
        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-[10px]">
          <div className="text-slate-400 text-[13px] mb-1">Card: {giftCardInfo.cardNumber}</div>
          <div className="flex justify-between items-center">
            <span className="text-slate-300 font-medium">Available Balance:</span>
            <span className="text-[22px] font-bold text-green-500 font-mono">
              {formatCurrency(giftCardInfo.currentBalance)}
            </span>
          </div>
          {giftCardInfo.currentBalance < totalWithTip && (
            <div className="mt-2 text-[13px] text-amber-300">
              Partial payment of {formatCurrency(giftCardInfo.currentBalance)} will be applied.
              Remaining: {formatCurrency(totalWithTip - giftCardInfo.currentBalance)}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <button
          onClick={() => setStep('method')}
          disabled={isProcessing}
          className={`${backButtonClasses} ${isProcessing ? 'opacity-50' : ''}`}
        >
          Back
        </button>
        <button
          onClick={handleGiftCardPayment}
          disabled={isProcessing || !giftCardInfo || giftCardInfo.currentBalance === 0}
          className={`${primaryButtonClasses} !bg-purple-600 ${(isProcessing || !giftCardInfo || giftCardInfo?.currentBalance === 0) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isProcessing ? 'Processing...' : giftCardInfo && giftCardInfo.currentBalance >= totalWithTip
            ? 'Pay Full Amount'
            : giftCardInfo
              ? `Pay ${formatCurrency(Math.min(giftCardInfo.currentBalance, totalWithTip))}`
              : 'Apply Gift Card'}
        </button>
      </div>
    </div>
  )
}
