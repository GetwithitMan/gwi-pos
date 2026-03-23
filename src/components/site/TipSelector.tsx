'use client'

/**
 * TipSelector — Percentage-based tip buttons + custom amount input.
 *
 * Driven by orderingConfig.tipSuggestions (e.g., [15, 18, 20])
 * with default from orderingConfig.defaultTip.
 */

import { useState, useCallback } from 'react'
import { formatCurrency } from '@/lib/utils'

interface TipSelectorProps {
  subtotal: number // dollars
  tipSuggestions: number[] // e.g., [15, 18, 20]
  selectedPercent: number | null
  tipAmount: number
  onSelectPercent: (pct: number | null) => void
  onSetAmount: (amt: number) => void
}

export function TipSelector({
  subtotal,
  tipSuggestions,
  selectedPercent,
  tipAmount,
  onSelectPercent,
  onSetAmount,
}: TipSelectorProps) {
  const [customMode, setCustomMode] = useState(false)
  const [customInput, setCustomInput] = useState('')

  const handlePercentClick = useCallback(
    (pct: number) => {
      setCustomMode(false)
      setCustomInput('')
      if (selectedPercent === pct) {
        // Deselect — set to no tip
        onSelectPercent(null)
        onSetAmount(0)
      } else {
        onSelectPercent(pct)
        const amt = Math.round(subtotal * (pct / 100) * 100) / 100
        onSetAmount(amt)
      }
    },
    [selectedPercent, subtotal, onSelectPercent, onSetAmount]
  )

  const handleNoTip = useCallback(() => {
    setCustomMode(false)
    setCustomInput('')
    onSelectPercent(null)
    onSetAmount(0)
  }, [onSelectPercent, onSetAmount])

  const handleCustomClick = useCallback(() => {
    setCustomMode(true)
    onSelectPercent(null)
    setCustomInput(tipAmount > 0 ? tipAmount.toFixed(2) : '')
  }, [onSelectPercent, tipAmount])

  const handleCustomChange = useCallback(
    (raw: string) => {
      // Allow only numbers and one decimal point
      const cleaned = raw.replace(/[^0-9.]/g, '')
      const parts = cleaned.split('.')
      const formatted = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned
      setCustomInput(formatted)
      const val = parseFloat(formatted)
      onSetAmount(isNaN(val) || val < 0 ? 0 : Math.round(val * 100) / 100)
    },
    [onSetAmount]
  )

  return (
    <div className="space-y-3">
      {/* Percentage buttons */}
      <div className="flex gap-2">
        {tipSuggestions.map((pct) => {
          const isSelected = selectedPercent === pct && !customMode
          const dollarAmt = Math.round(subtotal * (pct / 100) * 100) / 100
          return (
            <button
              key={pct}
              onClick={() => handlePercentClick(pct)}
              className="flex-1 flex flex-col items-center gap-0.5 py-3 rounded-xl border-2 transition-all text-center"
              style={{
                borderColor: isSelected ? 'var(--site-brand)' : 'var(--site-border)',
                backgroundColor: isSelected ? 'rgba(var(--site-brand-rgb), 0.05)' : 'transparent',
                color: isSelected ? 'var(--site-brand)' : 'var(--site-text)',
              }}
            >
              <span className="text-sm font-bold">{pct}%</span>
              <span className="text-xs" style={{ color: 'var(--site-text-muted)' }}>
                {formatCurrency(dollarAmt)}
              </span>
            </button>
          )
        })}

        {/* Custom button */}
        <button
          onClick={handleCustomClick}
          className="flex-1 flex flex-col items-center justify-center py-3 rounded-xl border-2 transition-all"
          style={{
            borderColor: customMode ? 'var(--site-brand)' : 'var(--site-border)',
            backgroundColor: customMode ? 'rgba(var(--site-brand-rgb), 0.05)' : 'transparent',
            color: customMode ? 'var(--site-brand)' : 'var(--site-text)',
          }}
        >
          <span className="text-sm font-bold">Custom</span>
        </button>
      </div>

      {/* Custom amount input */}
      {customMode && (
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium"
            style={{ color: 'var(--site-text-muted)' }}
          >
            $
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={customInput}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="0.00"
            className="w-full pl-7 pr-4 py-3 rounded-xl border text-sm outline-none transition-colors"
            style={{
              borderColor: 'var(--site-border)',
              backgroundColor: 'var(--site-surface)',
              color: 'var(--site-text)',
            }}
            autoFocus
          />
        </div>
      )}

      {/* No tip option */}
      <button
        onClick={handleNoTip}
        className="w-full text-xs py-1.5 transition-colors hover:opacity-70"
        style={{
          color: selectedPercent === null && tipAmount === 0 && !customMode
            ? 'var(--site-brand)'
            : 'var(--site-text-muted)',
        }}
      >
        No tip
      </button>

      {/* Tip display */}
      {tipAmount > 0 && (
        <div
          className="text-right text-sm font-medium"
          style={{ color: 'var(--site-text)' }}
        >
          Tip: {formatCurrency(tipAmount)}
        </div>
      )}
    </div>
  )
}
