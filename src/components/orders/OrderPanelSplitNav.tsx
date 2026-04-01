'use client'

import { memo } from 'react'

interface SplitChip {
  id: string
  label: string
  isPaid: boolean
  total: number
}

interface OrderPanelSplitNavProps {
  orderId?: string | null
  splitChips: SplitChip[]
  splitChipsFlashing?: boolean
  cardPriceMultiplier?: number
  onSplitChipSelect?: (splitOrderId: string) => void
  onManageSplits?: () => void
  onPayAll?: () => void
  onAddSplit?: () => void
}

export const OrderPanelSplitNav = memo(function OrderPanelSplitNav({
  orderId,
  splitChips,
  splitChipsFlashing,
  cardPriceMultiplier,
  onSplitChipSelect,
  onManageSplits,
  onPayAll,
  onAddSplit,
}: OrderPanelSplitNavProps) {
  if (!splitChips || splitChips.length === 0) return null

  return (
    <div style={{
      padding: '8px 20px 10px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      background: 'rgba(255, 255, 255, 0.02)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 10, color: '#64748b', fontWeight: 500,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Split Checks
        </span>
        <div style={{ display: 'flex', gap: 5 }}>
          {splitChips.some(s => !s.isPaid) && onPayAll && (
            <button
              type="button"
              onClick={onPayAll}
              style={{
                padding: '3px 8px', borderRadius: 6,
                border: '1px solid rgba(34,197,94,0.5)',
                background: 'rgba(34,197,94,0.15)',
                color: '#4ade80', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Pay All
            </button>
          )}
          {onManageSplits && (
            <button
              type="button"
              onClick={onManageSplits}
              style={{
                padding: '3px 8px', borderRadius: 6,
                border: '1px solid rgba(168,85,247,0.5)',
                background: 'rgba(168,85,247,0.15)',
                color: '#e9d5ff', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Manage Splits
            </button>
          )}
        </div>
      </div>
      <div style={{
        display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4,
        animation: splitChipsFlashing ? 'splitChipsFlash 0.3s ease-in-out 3' : undefined,
      }}>
        <style>{`
          @keyframes splitChipsFlash {
            0%, 100% { background: transparent; }
            50% { background: rgba(168, 85, 247, 0.2); }
          }
        `}</style>
        {splitChips.map(split => (
          <button
            key={split.id}
            type="button"
            onClick={() => onSplitChipSelect?.(split.id)}
            style={{
              padding: '3px 7px', borderRadius: 6,
              border: `1px solid ${split.id === orderId ? 'rgba(99,102,241,0.7)' : split.isPaid ? 'rgba(34,197,94,0.5)' : 'rgba(148,163,184,0.3)'}`,
              background: split.id === orderId ? 'rgba(99,102,241,0.25)' : split.isPaid ? 'rgba(34,197,94,0.12)' : 'rgba(15,23,42,0.9)',
              color: split.id === orderId ? '#a5b4fc' : split.isPaid ? '#4ade80' : '#e2e8f0',
              fontSize: 11, fontWeight: split.id === orderId || split.isPaid ? 600 : 500,
              display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
            }}
          >
            <span>{split.label}</span>
            <span style={{ opacity: 0.7 }}>${(cardPriceMultiplier ? split.total * cardPriceMultiplier : split.total).toFixed(2)}</span>
            {split.isPaid && (
              <span style={{
                fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.05em',
                padding: '1px 3px', borderRadius: 3, background: 'rgba(34,197,94,0.25)',
              }}>
                Paid
              </span>
            )}
          </button>
        ))}
        {onAddSplit && (
          <button
            type="button"
            onClick={onAddSplit}
            style={{
              padding: '3px 7px', borderRadius: 6,
              border: '1px dashed rgba(168,85,247,0.5)',
              background: 'rgba(168,85,247,0.08)',
              color: '#c084fc',
              fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer',
            }}
          >
            + New
          </button>
        )}
      </div>
    </div>
  )
})
