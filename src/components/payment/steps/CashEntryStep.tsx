'use client'

import React, { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { usePaymentContext } from '../PaymentContext'
import type { PendingPayment } from '../PaymentContext'
import {
  sectionLabelClasses,
  mutedTextClasses,
  inputClasses,
  backButtonClasses,
  primaryButtonClasses,
  infoPanelBase,
  infoPanelGreen,
} from '../payment-styles'

/**
 * CashEntryStep — cash bill tapping, custom amount, change-due screen.
 */
export function CashEntryStep() {
  const {
    totalWithTip,
    currentTotal,
    tipAmount,
    tipSettings,
    isProcessing,
    pendingPayments,
    processPayments,
    setStep,
  } = usePaymentContext()

  // Local cash state
  const [cashTendered, setCashTendered] = useState(0)
  const [cashComplete, setCashComplete] = useState(false)
  const [customCashAmount, setCustomCashAmount] = useState('')

  const handleCashTender = (amount: number) => {
    const newTotal = cashTendered + amount
    setCashTendered(newTotal)
    if (newTotal >= totalWithTip) {
      setCashComplete(true)
    }
  }

  const handleCashFinalize = () => {
    const payment: PendingPayment = {
      method: 'cash',
      amount: currentTotal,
      tipAmount,
      amountTendered: cashTendered,
    }
    processPayments([...pendingPayments, payment], pendingPayments)
  }

  // ─── Change Due Screen ──────────────────────────────────────────────────
  if (cashComplete) {
    return (
      <div className="flex flex-col gap-4 items-center pt-4">
        <div className="text-5xl leading-none">{'\uD83D\uDCB5'}</div>
        <h3 className={`${sectionLabelClasses} text-[22px] text-center !mb-0`}>Change Due</h3>

        <div className={`${infoPanelBase} ${infoPanelGreen} w-full`}>
          <div className="flex justify-between font-semibold text-base font-mono">
            <span className="text-slate-400">Total</span>
            <span className="text-slate-100">{formatCurrency(totalWithTip)}</span>
          </div>
          <div className="flex justify-between font-semibold text-base font-mono mt-1">
            <span className="text-slate-400">Tendered</span>
            <span className="text-slate-100">{formatCurrency(cashTendered)}</span>
          </div>
          {cashTendered > totalWithTip && (
            <div className="flex justify-between font-bold text-[28px] font-mono mt-2 pt-2 border-t border-white/10">
              <span className="text-amber-300">Change Due</span>
              <span className="text-amber-300">{formatCurrency(cashTendered - totalWithTip)}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2.5 w-full mt-2">
          <button
            onClick={handleCashFinalize}
            disabled={isProcessing}
            className={`${primaryButtonClasses} !p-4 text-base font-bold bg-green-600 hover:bg-green-500 ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isProcessing ? 'Processing...' : 'Complete Payment'}
          </button>
        </div>

        <button
          onClick={() => { setCashComplete(false); setCashTendered(0) }}
          className={`${backButtonClasses} w-full`}
        >
          Start Over
        </button>
      </div>
    )
  }

  // ─── Cash Entry Screen ────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className={sectionLabelClasses}>Cash Payment</h3>

      {/* Amount due and tendered so far */}
      <div className={`${infoPanelBase} ${infoPanelGreen}`}>
        <div className="flex justify-between font-bold text-xl font-mono">
          <span className="text-slate-400">Total Due</span>
          <span className="text-green-500">{formatCurrency(totalWithTip)}</span>
        </div>
        {cashTendered > 0 && (
          <>
            <div className="flex justify-between font-semibold text-base font-mono mt-1.5">
              <span className="text-slate-400">Tendered</span>
              <span className="text-slate-100">{formatCurrency(cashTendered)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg font-mono mt-1 pt-1.5 border-t border-white/10">
              <span className="text-amber-300">Remaining</span>
              <span className="text-amber-300">{formatCurrency(Math.max(0, totalWithTip - cashTendered))}</span>
            </div>
          </>
        )}
      </div>

      <p className={`${mutedTextClasses} mb-1`}>Tap bills received:</p>
      <div className="grid grid-cols-3 gap-2">
        {/* Exact amount button */}
        <button
          onClick={() => handleCashTender(totalWithTip - cashTendered)}
          disabled={isProcessing}
          className={`col-span-3 py-3.5 px-2 rounded-[10px] border border-green-500/40 bg-green-500/15 text-green-500 text-[15px] font-bold ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-green-500/20'}`}
        >
          Exact {formatCurrency(totalWithTip - cashTendered)}
        </button>
        {[1, 5, 10, 20, 50, 100].map(amount => (
          <button
            key={amount}
            onClick={() => handleCashTender(amount)}
            disabled={isProcessing}
            className={`py-4 px-2 rounded-[10px] border border-slate-600/30 bg-slate-800/50 text-slate-100 text-base font-bold ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-800/70'}`}
          >
            {formatCurrency(amount)}
          </button>
        ))}
      </div>

      {/* Custom amount */}
      <div className="mt-3">
        <label className="text-slate-400 text-[13px] block mb-1.5">Custom amount:</label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-[11px] text-slate-500 text-sm">$</span>
            <input
              type="number"
              value={customCashAmount}
              onChange={(e) => setCustomCashAmount(e.target.value)}
              onKeyDown={(e) => { if (['e','E','+','-'].includes(e.key)) e.preventDefault() }}
              className={`${inputClasses} pl-7`}
              placeholder="0.00"
              step="0.01"
              min="0"
              max="9999.99"
            />
          </div>
          <button
            onClick={() => {
              const val = parseFloat(customCashAmount) || 0
              if (val > 0) { handleCashTender(val); setCustomCashAmount('') }
            }}
            disabled={isProcessing || !customCashAmount}
            className={`${primaryButtonClasses} !flex-none !px-5 !py-2.5 bg-green-600 hover:bg-green-500 ${(isProcessing || !customCashAmount) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Add
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => { setCashTendered(0); setStep(tipSettings.enabled ? 'tip' : 'method') }}
          className={`${backButtonClasses}`}
        >
          Back
        </button>
        {cashTendered > 0 && (
          <button
            onClick={() => setCashTendered(0)}
            className={`${backButtonClasses} !text-red-400 !border-red-400/30`}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
