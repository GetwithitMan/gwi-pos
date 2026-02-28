'use client'

import { useState, useRef, useEffect } from 'react'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { calculateCardPrice } from '@/lib/pricing'

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280',
]

interface PricingOptionRowProps {
  option: {
    id: string
    label: string
    price: number | null
    isDefault: boolean
    showOnPos: boolean
    color: string | null
  }
  /** How many options in this group already have showOnPos=true */
  showOnPosCount?: number
  onUpdate: (data: { label?: string; price?: number | null; isDefault?: boolean; showOnPos?: boolean; color?: string | null }) => void
  onDelete: () => void
}

export function PricingOptionRow({ option, showOnPosCount = 0, onUpdate, onDelete }: PricingOptionRowProps) {
  const [label, setLabel] = useState(option.label)
  const [price, setPrice] = useState(option.price != null ? String(option.price) : '')
  const { dualPricing } = useOrderSettings()
  const cashDiscountPct = dualPricing.cashDiscountPercent || 4.0
  const isDualPricingEnabled = dualPricing.enabled !== false
  const [showColors, setShowColors] = useState(false)
  const colorRef = useRef<HTMLDivElement>(null)

  // Sync from parent when option changes (e.g., after server refetch)
  useEffect(() => {
    setLabel(option.label)
    setPrice(option.price != null ? String(option.price) : '')
  }, [option.label, option.price])

  // Close color picker on outside click
  useEffect(() => {
    if (!showColors) return
    const handler = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) {
        setShowColors(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColors])

  const handleLabelBlur = () => {
    const trimmed = label.trim()
    if (trimmed && trimmed !== option.label) {
      onUpdate({ label: trimmed })
    } else if (!trimmed) {
      setLabel(option.label)
    }
  }

  const handlePriceBlur = () => {
    const val = price.trim()
    const parsed = val ? parseFloat(val) : null
    const finalPrice = parsed != null && !isNaN(parsed) ? parsed : null
    if (finalPrice !== option.price) {
      onUpdate({ price: finalPrice })
    }
  }

  // Can toggle showOnPos on if currently off and fewer than 4 are checked, or if currently on (to uncheck)
  const canToggleShowOnPos = option.showOnPos || showOnPosCount < 4

  return (
    <div className="flex items-center gap-2 py-1.5">
      {/* Label */}
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={handleLabelBlur}
        placeholder="Option label"
        className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
      />

      {/* Price */}
      <div className="shrink-0">
        <div className="relative w-20">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={handlePriceBlur}
            placeholder="—"
            step="0.01"
            min="0"
            className="w-full pl-5 pr-1 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
          />
        </div>
        {isDualPricingEnabled && parseFloat(price) > 0 && (
          <div className="text-xs text-gray-400 text-right mt-0.5">
            Card: ${calculateCardPrice(parseFloat(price), cashDiscountPct).toFixed(2)}
          </div>
        )}
      </div>

      {/* Color dot */}
      <div className="relative" ref={colorRef}>
        <button
          type="button"
          onClick={() => setShowColors(!showColors)}
          className="w-7 h-7 rounded-full border-2 border-gray-200 hover:border-gray-400 transition-colors flex items-center justify-center shrink-0"
          style={option.color ? { backgroundColor: option.color, borderColor: option.color } : undefined}
          title="Set color"
        >
          {!option.color && (
            <div className="w-3 h-3 rounded-full bg-gray-200" />
          )}
        </button>
        {showColors && (
          <div className="absolute top-full right-0 mt-1 p-2 bg-white rounded-lg shadow-lg border border-gray-200 z-20 grid grid-cols-4 gap-1.5">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onUpdate({ color: c })
                  setShowColors(false)
                }}
                className={`w-6 h-6 rounded-full hover:scale-110 transition-transform ${c === option.color ? 'ring-2 ring-gray-800 ring-offset-1' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
            {option.color && (
              <button
                type="button"
                onClick={() => {
                  onUpdate({ color: null })
                  setShowColors(false)
                }}
                className="col-span-4 text-xs text-gray-500 hover:text-gray-700 py-1"
              >
                Remove color
              </button>
            )}
          </div>
        )}
      </div>

      {/* Show on POS eye toggle */}
      <button
        type="button"
        onClick={() => canToggleShowOnPos && onUpdate({ showOnPos: !option.showOnPos })}
        disabled={!canToggleShowOnPos}
        className={`p-1 rounded transition-colors shrink-0 ${
          option.showOnPos
            ? 'text-blue-600'
            : canToggleShowOnPos
              ? 'text-gray-300 hover:text-gray-400'
              : 'text-gray-200 cursor-not-allowed'
        }`}
        title={option.showOnPos ? 'Shown on POS' : showOnPosCount >= 4 ? 'Max 4 shown on POS' : 'Show on POS'}
      >
        <svg className="w-5 h-5" fill={option.showOnPos ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          {option.showOnPos ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          )}
        </svg>
      </button>

      {/* Default star */}
      <button
        type="button"
        onClick={() => onUpdate({ isDefault: !option.isDefault })}
        className={`p-1 rounded transition-colors shrink-0 ${option.isDefault ? 'text-amber-500' : 'text-gray-300 hover:text-gray-400'}`}
        title={option.isDefault ? 'Default option' : 'Set as default'}
      >
        <svg className="w-5 h-5" fill={option.isDefault ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        className="p-1 text-gray-300 hover:text-red-500 transition-colors shrink-0"
        title="Delete option"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
