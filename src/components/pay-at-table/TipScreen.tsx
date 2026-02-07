'use client'

import { useState } from 'react'

interface TipScreenProps {
  amount: number
  splitLabel?: string
  onTipSelected: (tipAmount: number) => void
}

export default function TipScreen({ amount, splitLabel, onTipSelected }: TipScreenProps) {
  const [showCustom, setShowCustom] = useState(false)
  const [customAmount, setCustomAmount] = useState('')

  const suggestions = [
    { percent: 18, amount: Math.round(amount * 0.18 * 100) / 100 },
    { percent: 20, amount: Math.round(amount * 0.20 * 100) / 100 },
    { percent: 25, amount: Math.round(amount * 0.25 * 100) / 100 },
  ]

  if (showCustom) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 p-8">
        <h2 className="text-2xl text-white/80 mb-8">Enter Tip Amount</h2>

        <div className="text-5xl font-light text-white mb-8 tabular-nums">
          ${customAmount || '0.00'}
        </div>

        <div className="grid grid-cols-3 gap-3 max-w-xs mb-8">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(key => (
            <button
              key={key}
              onClick={() => {
                if (key === '⌫') {
                  setCustomAmount(prev => prev.slice(0, -1))
                } else {
                  setCustomAmount(prev => prev + key)
                }
              }}
              className="w-16 h-16 rounded-xl bg-white/10 text-white text-xl hover:bg-white/20 active:bg-white/30 transition-colors"
            >
              {key}
            </button>
          ))}
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => setShowCustom(false)}
            className="px-6 py-3 text-white/50 hover:text-white/70 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => {
              const tip = parseFloat(customAmount) || 0
              onTipSelected(tip)
            }}
            className="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-900 p-8">
      {splitLabel && (
        <p className="text-blue-400 text-sm mb-2">{splitLabel}</p>
      )}
      <h2 className="text-2xl text-white/80 mb-2">Add a Tip?</h2>
      <p className="text-white/40 text-lg mb-10">Amount: ${amount.toFixed(2)}</p>

      <div className="grid grid-cols-3 gap-4 max-w-sm w-full mb-6">
        {suggestions.map(({ percent, amount: tipAmt }) => (
          <button
            key={percent}
            onClick={() => onTipSelected(tipAmt)}
            className="py-6 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors text-center"
          >
            <div className="text-2xl font-bold text-white">{percent}%</div>
            <div className="text-white/40 text-sm mt-1">${tipAmt.toFixed(2)}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-3 w-full max-w-sm">
        <button
          onClick={() => setShowCustom(true)}
          className="flex-1 py-4 rounded-xl border border-white/20 text-white/60 hover:bg-white/10 transition-colors"
        >
          Custom
        </button>
        <button
          onClick={() => onTipSelected(0)}
          className="flex-1 py-4 rounded-xl bg-white/5 text-white/40 hover:bg-white/10 transition-colors"
        >
          No Tip
        </button>
      </div>
    </div>
  )
}
