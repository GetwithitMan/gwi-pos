'use client'

import React, { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { calculateCardPrice, roundToCents } from '@/lib/pricing'
import { usePaymentContext } from '../PaymentContext'
import type { PendingPayment } from '../PaymentContext'
import {
  sectionLabelClasses,
  mutedTextClasses,
  inputClasses,
  backButtonClasses,
  primaryButtonClasses,
} from '../payment-styles'

/**
 * SplitPaymentStep — split an order between two payment methods (cash/card).
 */
export function SplitPaymentStep() {
  const {
    remainingBeforeTip,
    dualPricing,
    discountPercent,
    isConnected,
    pendingPayments,
    setPendingPayments,
    setSelectedMethod,
    setStep,
    setError,
    error,
    processPayments,
  } = usePaymentContext()

  const [splitMethod1, setSplitMethod1] = useState<'cash' | 'credit'>('cash')
  const [splitMethod2, setSplitMethod2] = useState<'cash' | 'credit'>('credit')
  const [splitAmount1, setSplitAmount1] = useState('')

  const handleSplitSubmit = () => {
    const amount1 = parseFloat(splitAmount1)
    if (!amount1 || amount1 <= 0 || amount1 >= remainingBeforeTip) {
      setError('First payment must be between $0.01 and the remaining balance')
      return
    }
    const amount2 = roundToCents(remainingBeforeTip - amount1)
    if (amount2 <= 0) {
      setError('Nothing remaining for second payment')
      return
    }

    const payment1Amount = splitMethod1 === 'cash' ? amount1
      : dualPricing.enabled ? calculateCardPrice(amount1, discountPercent) : amount1
    const payment2Amount = splitMethod2 === 'cash' ? amount2
      : dualPricing.enabled ? calculateCardPrice(amount2, discountPercent) : amount2

    const payment1: PendingPayment = {
      method: splitMethod1,
      amount: payment1Amount,
      tipAmount: 0,
      ...(splitMethod1 === 'cash' ? { amountTendered: payment1Amount } : {}),
    }
    const payment2: PendingPayment = {
      method: splitMethod2,
      amount: payment2Amount,
      tipAmount: 0,
      ...(splitMethod2 === 'cash' ? { amountTendered: payment2Amount } : {}),
    }

    if (splitMethod1 === 'cash' && splitMethod2 === 'cash') {
      processPayments([...pendingPayments, payment1, payment2], pendingPayments)
    } else if (splitMethod1 === 'cash') {
      setPendingPayments([...pendingPayments, payment1])
      setSelectedMethod(splitMethod2)
      setStep('datacap_card')
    } else if (splitMethod2 === 'cash') {
      setPendingPayments([...pendingPayments, payment2])
      setSelectedMethod(splitMethod1)
      setStep('datacap_card')
    } else {
      setPendingPayments([...pendingPayments, payment2])
      setSelectedMethod(splitMethod1)
      setStep('datacap_card')
    }
  }

  const splitDisabled = !splitAmount1 || parseFloat(splitAmount1) <= 0 || parseFloat(splitAmount1) >= remainingBeforeTip

  return (
    <div className="flex flex-col gap-3">
      <h3 className={sectionLabelClasses}>Split Payment</h3>
      <p className={`${mutedTextClasses} mb-1`}>
        Total: {formatCurrency(remainingBeforeTip)}
      </p>

      {/* Payment 1 */}
      <div className="p-3 rounded-[10px] bg-slate-800/60 border border-white/5">
        <div className="text-[11px] text-indigo-400 uppercase tracking-widest font-bold mb-2">
          Payment 1
        </div>
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => {
              setSplitMethod1('cash')
              if (splitMethod2 === 'cash') setSplitMethod2('credit')
            }}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold cursor-pointer transition-colors ${
              splitMethod1 === 'cash'
                ? 'border-2 border-green-500 bg-green-500/15 text-green-500'
                : 'border border-slate-600/30 bg-transparent text-slate-400'
            }`}
          >
            Cash
          </button>
          <button
            onClick={() => {
              setSplitMethod1('credit')
              if (splitMethod2 === 'credit') setSplitMethod2('cash')
            }}
            disabled={!isConnected}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
              splitMethod1 === 'credit'
                ? 'border-2 border-indigo-500 bg-indigo-500/15 text-indigo-400'
                : 'border border-slate-600/30 bg-transparent text-slate-400'
            } ${!isConnected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            Card
          </button>
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-base">$</span>
          <input
            type="number"
            value={splitAmount1}
            onChange={e => setSplitAmount1(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0.01"
            max={remainingBeforeTip - 0.01}
            className={`${inputClasses} pl-7 text-lg font-bold font-mono`}
          />
        </div>

        {/* Quick split buttons */}
        <div className="grid grid-cols-3 gap-1.5 mt-2">
          {[
            { label: 'Half', value: roundToCents(remainingBeforeTip / 2) },
            { label: '1/3', value: roundToCents(remainingBeforeTip / 3) },
            { label: '2/3', value: roundToCents(remainingBeforeTip * 2 / 3) },
          ].map(btn => (
            <button
              key={btn.label}
              onClick={() => setSplitAmount1(btn.value.toFixed(2))}
              className="py-1.5 px-2 rounded-md border border-slate-600/30 bg-white/[0.04] text-slate-400 text-xs font-semibold cursor-pointer hover:bg-white/[0.08] transition-colors"
            >
              {btn.label} ({formatCurrency(btn.value)})
            </button>
          ))}
        </div>
      </div>

      {/* Payment 2 — auto-calculated remainder */}
      <div className="p-3 rounded-[10px] bg-slate-800/60 border border-white/5">
        <div className="text-[11px] text-amber-500 uppercase tracking-widest font-bold mb-2">
          Payment 2 (Remaining)
        </div>
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => {
              setSplitMethod2('cash')
              if (splitMethod1 === 'cash') setSplitMethod1('credit')
            }}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold cursor-pointer transition-colors ${
              splitMethod2 === 'cash'
                ? 'border-2 border-green-500 bg-green-500/15 text-green-500'
                : 'border border-slate-600/30 bg-transparent text-slate-400'
            }`}
          >
            Cash
          </button>
          <button
            onClick={() => {
              setSplitMethod2('credit')
              if (splitMethod1 === 'credit') setSplitMethod1('cash')
            }}
            disabled={!isConnected}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
              splitMethod2 === 'credit'
                ? 'border-2 border-indigo-500 bg-indigo-500/15 text-indigo-400'
                : 'border border-slate-600/30 bg-transparent text-slate-400'
            } ${!isConnected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            Card
          </button>
        </div>
        <div className="py-3 px-4 rounded-lg bg-amber-500/10 border border-amber-500/20 font-mono text-lg font-bold text-amber-500 text-center">
          {splitAmount1 && parseFloat(splitAmount1) > 0
            ? formatCurrency(roundToCents(Math.max(0, remainingBeforeTip - parseFloat(splitAmount1))))
            : formatCurrency(remainingBeforeTip)
          }
          <div className="text-[11px] font-medium text-amber-900 mt-0.5">
            on {splitMethod2 === 'cash' ? 'Cash' : 'Card'}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-1">
        <button
          onClick={() => setStep('method')}
          className={backButtonClasses}
        >
          Back
        </button>
        <button
          onClick={handleSplitSubmit}
          disabled={splitDisabled}
          className={`${primaryButtonClasses} ${splitDisabled ? '!bg-gray-700 !text-gray-500 cursor-not-allowed' : '!bg-amber-500 !text-slate-900'}`}
        >
          Process Split
        </button>
      </div>
    </div>
  )
}
