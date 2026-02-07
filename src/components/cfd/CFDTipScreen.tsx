'use client'

import { useState } from 'react'
import type { CFDTipPromptEvent } from '@/types/multi-surface'

interface CFDTipScreenProps {
  data: CFDTipPromptEvent | null
  onTipSelected: (amount: number, isPercent: boolean) => void
}

export default function CFDTipScreen({ data, onTipSelected }: CFDTipScreenProps) {
  const [showCustom, setShowCustom] = useState(false)
  const [customAmount, setCustomAmount] = useState('')

  if (!data) return null

  const handleSuggestionTap = (value: number) => {
    onTipSelected(value, data.isPercent)
  }

  const handleCustomSubmit = () => {
    const amount = parseFloat(customAmount)
    if (!isNaN(amount) && amount >= 0) {
      onTipSelected(amount, false) // Custom is always dollar amount
    }
  }

  if (showCustom) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 p-8">
        <h2 className="text-2xl text-white/60 mb-2">Enter Tip Amount</h2>
        <p className="text-white/30 text-lg mb-8">Order Total: ${data.orderTotal.toFixed(2)}</p>

        <div className="text-6xl font-light text-white mb-8 tabular-nums">
          ${customAmount || '0.00'}
        </div>

        {/* Number pad */}
        <div className="grid grid-cols-3 gap-3 max-w-xs">
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
              className="w-20 h-20 rounded-2xl bg-white/10 text-white text-2xl font-medium hover:bg-white/20 active:bg-white/30 transition-colors"
            >
              {key}
            </button>
          ))}
        </div>

        <div className="flex gap-4 mt-8">
          <button
            onClick={() => setShowCustom(false)}
            className="px-8 py-4 text-white/50 text-lg hover:text-white/70 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleCustomSubmit}
            className="px-8 py-4 bg-blue-500 text-white rounded-2xl text-lg font-medium hover:bg-blue-600 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 p-8">
      <h2 className="text-3xl text-white/80 mb-2">Add a Tip?</h2>
      <p className="text-white/40 text-xl mb-12">Order Total: ${data.orderTotal.toFixed(2)}</p>

      {/* Tip suggestion buttons */}
      <div className="grid grid-cols-3 gap-4 mb-8 max-w-md w-full">
        {data.suggestions.map(value => {
          const tipAmount = data.isPercent
            ? Math.round(data.orderTotal * value) / 100
            : value

          return (
            <button
              key={value}
              onClick={() => handleSuggestionTap(value)}
              className="py-8 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors text-center"
            >
              <div className="text-3xl font-bold text-white">
                {data.isPercent ? `${value}%` : `$${value}`}
              </div>
              {data.isPercent && (
                <div className="text-white/40 text-sm mt-1">
                  ${tipAmount.toFixed(2)}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Custom button */}
      <button
        onClick={() => setShowCustom(true)}
        className="px-8 py-4 rounded-2xl border border-white/20 text-white/60 text-lg hover:bg-white/10 transition-colors"
      >
        Custom Amount
      </button>
    </div>
  )
}
