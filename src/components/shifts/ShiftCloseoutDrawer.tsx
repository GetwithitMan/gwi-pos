'use client'

import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

// Denomination structure for cash counting
const DENOMINATIONS = [
  { label: '$100', value: 100 },
  { label: '$50', value: 50 },
  { label: '$20', value: 20 },
  { label: '$10', value: 10 },
  { label: '$5', value: 5 },
  { label: '$1', value: 1 },
  { label: '25\u00a2', value: 0.25 },
  { label: '10\u00a2', value: 0.10 },
  { label: '5\u00a2', value: 0.05 },
  { label: '1\u00a2', value: 0.01 },
]

interface ShiftCloseoutDrawerProps {
  mode: string
  canSeeExpectedFirst: boolean
  viewedSummaryFirst: boolean
  counts: Record<number, number>
  manualTotal: string
  useManual: boolean
  tipsDeclared: string
  notes: string
  actualCash: number
  isLoading: boolean
  onCountChange: (denom: number, value: string) => void
  onManualTotalChange: (value: string) => void
  onUseManualToggle: () => void
  onTipsDeclaredChange: (value: string) => void
  onNotesChange: (value: string) => void
  onSubmitBlindCount: () => void
  onViewSummaryFirst: () => void
}

export const ShiftCloseoutDrawer = memo(function ShiftCloseoutDrawer({
  mode,
  canSeeExpectedFirst,
  viewedSummaryFirst,
  counts,
  manualTotal,
  useManual,
  tipsDeclared,
  notes,
  actualCash,
  isLoading,
  onCountChange,
  onManualTotalChange,
  onUseManualToggle,
  onTipsDeclaredChange,
  onNotesChange,
  onSubmitBlindCount,
  onViewSummaryFirst,
}: ShiftCloseoutDrawerProps) {
  return (
    <div className="space-y-4">
      {/* Blind Mode Indicator */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
        </svg>
        <div className="flex-1">
          <span className="text-sm font-medium text-blue-800">Blind Count Mode</span>
          <p className="text-xs text-blue-600">Count your {mode === 'purse' ? 'purse' : 'drawer'} before seeing the expected amount</p>
        </div>
        {canSeeExpectedFirst && !viewedSummaryFirst && (
          <button
            onClick={onViewSummaryFirst}
            className="text-xs text-blue-600 hover:underline"
          >
            Manager: View Summary First
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">{mode === 'purse' ? 'Count Your Purse' : 'Count Your Drawer'}</h3>
        {mode !== 'purse' && (
          <button
            className="text-sm text-blue-600 hover:underline"
            onClick={onUseManualToggle}
          >
            {useManual ? 'Count by denomination' : 'Enter total manually'}
          </button>
        )}
      </div>

      {useManual ? (
        <div>
          <label className="block text-sm text-gray-600 mb-2">
            Enter total cash in {mode === 'purse' ? 'purse' : 'drawer'}
          </label>
          <div className="relative">
            <span className="absolute left-3 top-3 text-gray-700 text-xl">$</span>
            <input
              type="number"
              value={manualTotal}
              onChange={(e) => onManualTotalChange(e.target.value)}
              className="w-full pl-8 pr-4 py-3 text-2xl border rounded-lg"
              placeholder="0.00"
              step="0.01"
              min="0"
              autoFocus
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {DENOMINATIONS.map(({ label, value }) => (
            <div key={value} className="flex items-center gap-2">
              <span className="w-12 text-right font-medium">{label}</span>
              <span className="text-gray-400">&times;</span>
              <input
                type="number"
                min="0"
                value={counts[value] || ''}
                onChange={(e) => onCountChange(value, e.target.value)}
                className="w-20 px-2 py-1 border rounded text-center"
                placeholder="0"
              />
              <span className="text-gray-700 text-sm">
                = {formatCurrency((counts[value] || 0) * value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Running total - blind mode doesn't show expected */}
      <Card className="p-4 bg-gray-50">
        <div className="text-center">
          <div className="text-sm text-gray-700">Total Counted</div>
          <div className="text-3xl font-bold">{formatCurrency(actualCash)}</div>
        </div>
      </Card>

      <div>
        <label className="block text-sm text-gray-600 mb-2">
          Tips to Declare
        </label>
        <div className="relative">
          <span className="absolute left-3 top-2 text-gray-700">$</span>
          <input
            type="number"
            value={tipsDeclared}
            onChange={(e) => onTipsDeclaredChange(e.target.value)}
            className="w-full pl-8 pr-4 py-2 border rounded-lg"
            placeholder="0.00"
            step="0.01"
            min="0"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm text-gray-600 mb-2">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
          rows={2}
          placeholder="Any notes about the shift..."
        />
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={onSubmitBlindCount}
        disabled={actualCash === 0 || isLoading}
      >
        {isLoading ? 'Processing...' : 'Submit Count & Reveal \u2192'}
      </Button>
    </div>
  )
})
