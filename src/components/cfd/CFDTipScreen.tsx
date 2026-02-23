'use client'

import { useState } from 'react'
import type { CFDTipPromptEvent } from '@/types/multi-surface'

interface CFDTipScreenProps {
  data: CFDTipPromptEvent | null
  onTipSelected: (amount: number, isPercent: boolean) => void
}

type TipSelection =
  | { type: 'preset'; index: number; value: number }
  | { type: 'none' }
  | { type: 'custom'; amount: number }

export default function CFDTipScreen({ data, onTipSelected }: CFDTipScreenProps) {
  const [selection, setSelection] = useState<TipSelection | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [confirmingTip, setConfirmingTip] = useState<{ amount: number; isPercent: boolean; tipDollars: number } | null>(null)

  if (!data) return null

  const computeTipDollars = (sel: TipSelection): number => {
    if (sel.type === 'none') return 0
    if (sel.type === 'custom') return sel.amount
    // preset
    if (data.isPercent) {
      return Math.round(data.orderTotal * sel.value) / 100
    }
    return sel.value
  }

  const tipDollars = selection ? computeTipDollars(selection) : 0
  const grandTotal = data.orderTotal + tipDollars

  // Max tip validation: tips > 50% of order total require confirmation
  const submitTip = (amount: number, isPercent: boolean) => {
    const dollars = isPercent
      ? Math.round(data.orderTotal * amount) / 100
      : amount
    if (dollars > data.orderTotal * 0.5) {
      setConfirmingTip({ amount, isPercent, tipDollars: dollars })
    } else {
      onTipSelected(amount, isPercent)
    }
  }

  // --- Large tip confirmation screen ---
  if (confirmingTip) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 p-6">
        <div className="w-full max-w-md text-center">
          <h2 className="text-3xl text-amber-400 mb-3">Confirm Tip Amount</h2>
          <p className="text-white/50 text-lg mb-8">
            Confirm <span className="text-emerald-400 font-bold">${confirmingTip.tipDollars.toFixed(2)}</span> tip
            {' '}on <span className="text-white font-bold">${data.orderTotal.toFixed(2)}</span> order?
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => setConfirmingTip(null)}
              className="flex-1 py-5 rounded-2xl text-lg font-semibold bg-white/10 text-white/60 hover:bg-white/20 transition-colors"
            >
              Go Back
            </button>
            <button
              onClick={() => {
                onTipSelected(confirmingTip.amount, confirmingTip.isPercent)
                setConfirmingTip(null)
              }}
              className="flex-1 py-5 rounded-2xl text-lg font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/25"
            >
              Confirm Tip
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- Custom keypad screen ---
  if (showCustom) {
    const parsedCustom = parseFloat(customInput)
    const customValid = !isNaN(parsedCustom) && parsedCustom >= 0
    const customTip = customValid ? parsedCustom : 0
    const customTotal = data.orderTotal + customTip

    const handleKey = (key: string) => {
      if (key === '⌫') {
        setCustomInput(prev => prev.slice(0, -1))
      } else if (key === '.') {
        // Only one decimal point; max 2 decimal places handled on confirm
        if (!customInput.includes('.')) {
          setCustomInput(prev => prev + '.')
        }
      } else {
        // Prevent more than 2 decimal places
        const parts = customInput.split('.')
        if (parts[1] && parts[1].length >= 2) return
        setCustomInput(prev => prev + key)
      }
    }

    const handleCustomConfirm = () => {
      if (customValid && parsedCustom >= 0) {
        submitTip(parsedCustom, false)
      }
    }

    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 p-6">
        <h2 className="text-2xl text-white/60 mb-1">Enter Tip Amount</h2>
        <p className="text-white/30 text-lg mb-6">
          Order Total: ${data.orderTotal.toFixed(2)}
        </p>

        <div className="text-6xl font-light text-white mb-2 tabular-nums">
          ${customInput || '0.00'}
        </div>
        <p className="text-white/30 text-base mb-6 tabular-nums">
          New Total: ${customTotal.toFixed(2)}
        </p>

        {/* Number pad */}
        <div className="grid grid-cols-3 gap-3 max-w-xs mb-6">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              className="w-20 h-16 rounded-2xl bg-white/10 text-white text-2xl font-medium hover:bg-white/20 active:bg-white/30 transition-colors"
            >
              {key}
            </button>
          ))}
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => { setShowCustom(false); setCustomInput('') }}
            className="px-8 py-4 text-white/50 text-lg hover:text-white/70 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleCustomConfirm}
            disabled={!customValid}
            className={`px-10 py-4 rounded-2xl text-lg font-semibold transition-colors
              ${customValid
                ? 'bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700'
                : 'bg-white/10 text-white/30 cursor-not-allowed'
              }`}
          >
            Confirm ${customTotal.toFixed(2)}
          </button>
        </div>
      </div>
    )
  }

  // --- Main tip selection screen ---
  const handlePresetTap = (index: number, value: number) => {
    setSelection({ type: 'preset', index, value })
  }

  const handleNoTip = () => {
    setSelection({ type: 'none' })
  }

  const handleConfirm = () => {
    if (!selection) return
    if (selection.type === 'none') {
      onTipSelected(0, false)
    } else if (selection.type === 'preset') {
      submitTip(selection.value, data.isPercent)
    }
  }

  // Determine grid columns based on suggestion count
  const cols = data.suggestions.length <= 3 ? 'grid-cols-3' : 'grid-cols-4'

  return (
    <div className="flex flex-col items-center justify-between h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 p-6">
      {/* Order summary */}
      <div className="w-full max-w-md pt-4">
        <h2 className="text-3xl text-white/90 text-center mb-6">Add a Tip?</h2>

        <div className="bg-white/5 rounded-2xl p-5 space-y-2 mb-2">
          <div className="flex justify-between text-white/50 text-lg">
            <span>Subtotal</span>
            <span className="tabular-nums">${data.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-white/50 text-lg">
            <span>Tax</span>
            <span className="tabular-nums">${data.tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-white text-xl font-bold pt-2 border-t border-white/10">
            <span>Total</span>
            <span className="tabular-nums">${data.orderTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Tip preset buttons */}
      <div className="w-full max-w-md flex-shrink-0">
        <div className={`grid ${cols} gap-3 mb-4`}>
          {data.suggestions.map((value, index) => {
            const isSelected = selection?.type === 'preset' && selection.index === index
            const tipAmount = data.isPercent
              ? Math.round(data.orderTotal * value) / 100
              : value

            return (
              <button
                key={value}
                onClick={() => handlePresetTap(index, value)}
                className={`py-6 rounded-2xl transition-all duration-150 text-center border-2
                  ${isSelected
                    ? 'bg-emerald-500/20 border-emerald-400 scale-[1.03]'
                    : 'bg-white/8 border-transparent hover:bg-white/15 active:bg-white/20'
                  }`}
              >
                <div className={`text-3xl font-bold ${isSelected ? 'text-emerald-300' : 'text-white'}`}>
                  {data.isPercent ? `${value}%` : `$${value.toFixed(0)}`}
                </div>
                {data.isPercent && (
                  <div className={`text-sm mt-1 ${isSelected ? 'text-emerald-400/70' : 'text-white/40'}`}>
                    ${tipAmount.toFixed(2)}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* No Tip + Custom row */}
        <div className="flex gap-3">
          <button
            onClick={handleNoTip}
            className={`flex-1 py-4 rounded-2xl text-lg transition-all duration-150 border-2
              ${selection?.type === 'none'
                ? 'bg-white/15 border-white/40 text-white/90'
                : 'bg-white/5 border-transparent text-white/40 hover:bg-white/10 hover:text-white/60'
              }`}
          >
            No Tip
          </button>
          <button
            onClick={() => setShowCustom(true)}
            className="flex-1 py-4 rounded-2xl border-2 border-white/15 text-white/60 text-lg hover:bg-white/10 transition-colors"
          >
            Custom
          </button>
        </div>
      </div>

      {/* Confirm CTA + live total */}
      <div className="w-full max-w-md pb-4">
        {selection && tipDollars > 0 && (
          <div className="text-center mb-3">
            <span className="text-white/40 text-base">
              Tip: <span className="text-emerald-400 tabular-nums">${tipDollars.toFixed(2)}</span>
            </span>
          </div>
        )}
        <button
          onClick={handleConfirm}
          disabled={!selection}
          className={`w-full py-5 rounded-2xl text-xl font-semibold transition-all duration-200
            ${selection
              ? 'bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700 shadow-lg shadow-emerald-500/25'
              : 'bg-white/8 text-white/25 cursor-not-allowed'
            }`}
        >
          {selection
            ? `Confirm — $${grandTotal.toFixed(2)}`
            : 'Select a tip to continue'}
        </button>
      </div>
    </div>
  )
}
