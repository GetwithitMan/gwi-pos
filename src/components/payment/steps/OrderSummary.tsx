'use client'

import React from 'react'
import { formatCurrency } from '@/lib/utils'
import { usePaymentContext } from '../PaymentContext'
import {
  errorBannerClasses,
  processingBannerClasses,
  warningBannerClasses,
  surchargeNoticeClasses,
  savingsNoticeClasses,
  spinnerClasses,
} from '../payment-styles'

/**
 * OrderSummary — always-visible order total breakdown, error/processing banners,
 * surcharge/savings notices, and tab increment warning.
 */
export function OrderSummary() {
  const {
    effectiveOrderTotal,
    selectedMethod,
    cashTotal,
    cardTotal,
    currentTotal,
    remainingBeforeTip,
    cashRoundingAdjustment,
    alreadyPaid,
    pendingTotal,
    pendingPayments,
    surchargeAmount,
    pricingProgram,
    error,
    isProcessing,
    tabIncrementFailed,
  } = usePaymentContext()

  return (
    <>
      {/* Error banner */}
      {error && (
        <div className={errorBannerClasses}>
          {error}
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className={processingBannerClasses}>
          <div className={spinnerClasses} />
          <span className="text-indigo-300 text-sm font-medium">Processing payment...</span>
        </div>
      )}

      {/* Tab increment failed warning */}
      {tabIncrementFailed && (
        <div className={warningBannerClasses}>
          Card limit reached — take a new card or cash.
        </div>
      )}

      {/* Order Summary panel */}
      <div className="mb-4 p-3 bg-slate-800/60 rounded-[10px] border border-white/5">
        <div className="flex justify-between text-sm text-slate-400 mb-1">
          <span>Order Total</span>
          <span className="text-slate-100 font-medium">{formatCurrency(effectiveOrderTotal)}</span>
        </div>
        {alreadyPaid > 0 && (
          <div className="flex justify-between text-sm text-green-500">
            <span>Already Paid</span>
            <span>-{formatCurrency(alreadyPaid)}</span>
          </div>
        )}
        {pendingPayments.length > 0 && (
          <div className="flex justify-between text-sm text-indigo-400">
            <span>Pending</span>
            <span>-{formatCurrency(pendingTotal)}</span>
          </div>
        )}
        {selectedMethod === 'cash' && cashRoundingAdjustment !== 0 && (
          <div className="flex justify-between text-sm text-amber-400 mt-0.5">
            <span>Rounding</span>
            <span>{cashRoundingAdjustment > 0 ? '+' : ''}{formatCurrency(cashRoundingAdjustment)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold mt-2 pt-2 border-t border-white/[0.08] text-white text-lg font-mono">
          <span>Remaining</span>
          <span>{formatCurrency(selectedMethod === 'cash' ? currentTotal : remainingBeforeTip)}</span>
        </div>
      </div>

      {/* Surcharge disclosure — Visa requires pre-payment notice (P1 compliance) */}
      {pricingProgram?.enabled && pricingProgram.model === 'surcharge' && selectedMethod && selectedMethod !== 'cash' && surchargeAmount > 0 && (
        <div className={surchargeNoticeClasses}>
          A surcharge of {pricingProgram.surchargePercent ?? 0}% ({formatCurrency(surchargeAmount)}) applies to card payments
        </div>
      )}

      {/* Dual pricing savings message */}
      {pricingProgram?.enabled && (pricingProgram.model === 'dual_price' || pricingProgram.model === 'dual_price_pan_debit') && selectedMethod && selectedMethod !== 'cash' && cardTotal > cashTotal && (
        <div className={savingsNoticeClasses}>
          Save {formatCurrency(cardTotal - cashTotal)} by paying with cash
        </div>
      )}
    </>
  )
}
