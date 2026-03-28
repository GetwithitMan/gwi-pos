'use client'

import React from 'react'
import { formatCurrency } from '@/lib/utils'
import { calculateTip } from '@/lib/payment'
import { usePaymentContext } from '../PaymentContext'
import {
  sectionLabelClasses,
  mutedTextClasses,
  inputClasses,
  backButtonClasses,
  primaryButtonClasses,
  infoPanelBase,
  infoPanelIndigo,
} from '../payment-styles'

/**
 * TipEntryStep — tip percentage selection + custom tip input.
 */
export function TipEntryStep() {
  const {
    selectedMethod,
    currentTotal,
    effectiveSubtotal,
    effectiveOrderTotal,
    tipSettings,
    tipAmount,
    setTipAmount,
    customTip,
    setCustomTip,
    totalWithTip,
    tipExemptAmount,
    setStep,
    setError,
    terminalId,
  } = usePaymentContext()

  const handleSelectTip = (percent: number | null) => {
    if (percent === null) {
      setTipAmount(0)
    } else {
      const tip = calculateTip(effectiveSubtotal, percent, tipSettings.calculateOn, effectiveOrderTotal, tipExemptAmount)
      setTipAmount(tip)
    }
    setCustomTip('')
  }

  const handleCustomTip = () => {
    const tip = parseFloat(customTip) || 0
    setTipAmount(tip)
  }

  const handleContinueFromTip = () => {
    if (!selectedMethod) {
      setError('No payment method selected. Please go back and select a payment method.')
      return
    }
    if (selectedMethod === 'cash') {
      setStep('cash')
    } else if (selectedMethod === 'credit' || selectedMethod === 'debit') {
      if (!terminalId) {
        setError('Terminal not configured. Cannot process card payments. Please contact support.')
        setStep('method')
        return
      }
      setStep('datacap_card')
    } else {
      setStep(selectedMethod as 'gift_card' | 'house_account' | 'room_charge')
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <h3 className={sectionLabelClasses}>Add Tip</h3>
      <p className={`${mutedTextClasses} mb-2`}>
        Paying with {selectedMethod === 'cash' ? 'Cash' : 'Card'}: {formatCurrency(currentTotal)}
      </p>

      {/* Tip percentage grid */}
      <div className="grid grid-cols-4 gap-2">
        {tipSettings.suggestedPercentages.map(percent => {
          const tipForPercent = calculateTip(effectiveSubtotal, percent, tipSettings.calculateOn, effectiveOrderTotal, tipExemptAmount)
          const isSelected = tipAmount === tipForPercent
          return (
            <button
              key={percent}
              onClick={() => handleSelectTip(percent)}
              className={`flex flex-col items-center justify-center h-16 rounded-[10px] cursor-pointer transition-colors ${
                isSelected
                  ? 'border border-indigo-500/50 bg-indigo-500/20 text-indigo-300'
                  : 'border border-slate-600/30 bg-slate-800/50 text-slate-400 hover:bg-slate-800/70'
              }`}
            >
              <span className="font-bold text-base">{percent}%</span>
              <span className="text-xs mt-0.5">{formatCurrency(tipForPercent)}</span>
            </button>
          )
        })}
      </div>

      {/* No tip + custom tip */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => handleSelectTip(null)}
          className={`flex-1 py-2.5 px-4 rounded-[10px] cursor-pointer text-sm font-medium transition-colors ${
            tipAmount === 0 && !customTip
              ? 'border border-indigo-500/50 bg-indigo-500/20 text-indigo-300'
              : 'border border-slate-600/30 bg-slate-800/50 text-slate-400 hover:bg-slate-800/70'
          }`}
        >
          No Tip
        </button>
        <div className="flex-1 relative">
          <span className="absolute left-3 top-[11px] text-slate-500 text-sm">$</span>
          <input
            type="number"
            value={customTip}
            onChange={(e) => setCustomTip(e.target.value)}
            onBlur={handleCustomTip}
            className={`${inputClasses} pl-7`}
            placeholder="Custom"
            step="0.01"
            min="0"
          />
        </div>
      </div>

      {/* Total with tip */}
      <div className={`${infoPanelBase} ${infoPanelIndigo}`}>
        <div className="flex justify-between font-bold text-white text-lg font-mono">
          <span>Total with Tip</span>
          <span>{formatCurrency(totalWithTip)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-2">
        <button onClick={() => setStep('method')} className={backButtonClasses}>
          Back
        </button>
        <button onClick={handleContinueFromTip} className={primaryButtonClasses}>
          Continue
        </button>
      </div>
    </div>
  )
}
