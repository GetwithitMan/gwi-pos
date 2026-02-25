'use client'

import { useState, useRef, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'

interface TipEntryRowProps {
  orderId: string
  orderNumber: number
  tabName: string | null
  total: number
  cardLast4: string | null
  cardBrand: string | null
  paymentId: string
  currentTip: number
  employeeName: string
  closedAt: string | null
  onTipChange: (orderId: string, paymentId: string, tipAmount: number) => void
  status: 'pending' | 'adjusted' | 'error'
  errorMessage?: string
}

export default function TipEntryRow({
  orderId,
  orderNumber,
  tabName,
  total,
  cardLast4,
  cardBrand,
  paymentId,
  currentTip,
  employeeName,
  closedAt,
  onTipChange,
  status,
  errorMessage,
}: TipEntryRowProps) {
  const [tipValue, setTipValue] = useState(currentTip > 0 ? currentTip.toFixed(2) : '')
  const inputRef = useRef<HTMLInputElement>(null)
  const tipNum = parseFloat(tipValue) || 0
  const isHighTip = tipNum > total * 0.5 && tipNum > 0

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9.]/g, '')
    // Allow only one decimal point, max 2 decimal places
    const parts = raw.split('.')
    const formatted = parts.length > 2
      ? parts[0] + '.' + parts.slice(1).join('')
      : parts[1]?.length > 2
        ? parts[0] + '.' + parts[1].slice(0, 2)
        : raw
    // Enforce max $9999.99
    const num = parseFloat(formatted) || 0
    if (num > 9999.99) return
    setTipValue(formatted)
    onTipChange(orderId, paymentId, num)
  }

  function handleBlur() {
    if (tipValue && parseFloat(tipValue) > 0) {
      setTipValue(parseFloat(tipValue).toFixed(2))
    }
  }

  const time = closedAt
    ? new Date(closedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : ''

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
        status === 'adjusted'
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : status === 'error'
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-white/5 border-white/10 hover:border-white/20'
      }`}
    >
      {/* Order info */}
      <div className="w-16 text-center">
        <div className="text-sm font-bold text-white">#{orderNumber}</div>
        <div className="text-[10px] text-white/40">{time}</div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">
          {tabName || `Order #${orderNumber}`}
        </div>
        <div className="text-xs text-white/50">{employeeName}</div>
      </div>

      {/* Total */}
      <div className="w-20 text-right">
        <div className="text-sm font-semibold text-white">{formatCurrency(total)}</div>
      </div>

      {/* Card info */}
      <div className="w-24 text-center">
        <div className="text-xs text-white/60">
          {cardBrand && <span className="uppercase">{cardBrand} </span>}
          {cardLast4 ? `••${cardLast4}` : 'Card'}
        </div>
      </div>

      {/* Tip input */}
      <div className="w-28">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={tipValue}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder="0.00"
            disabled={status === 'adjusted'}
            className={`w-full pl-7 pr-2 py-2.5 rounded-lg text-right text-sm font-mono
              bg-white/10 border text-white placeholder-white/30
              focus:outline-none focus:ring-2 focus:ring-indigo-500/50
              disabled:opacity-50 disabled:cursor-not-allowed
              ${isHighTip ? 'border-amber-500/60 ring-1 ring-amber-500/30' : 'border-white/20'}
            `}
            aria-label={`Tip for order ${orderNumber}`}
          />
        </div>
        {isHighTip && (
          <div className="text-[10px] text-amber-400 mt-0.5 text-center">
            {((tipNum / total) * 100).toFixed(0)}% of total
          </div>
        )}
      </div>

      {/* Status */}
      <div className="w-8 flex justify-center">
        {status === 'adjusted' && (
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {status === 'error' && (
          <span className="text-red-400 text-xs" title={errorMessage}>✕</span>
        )}
      </div>
    </div>
  )
}
