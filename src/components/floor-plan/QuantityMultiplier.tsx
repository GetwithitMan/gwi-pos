'use client'

import { memo } from 'react'

interface QuantityMultiplierProps {
  quantity: number
  onSetQuantity: (qty: number) => void
}

const QUANTITIES = [1, 2, 3, 4, 5]

export const QuantityMultiplier = memo(function QuantityMultiplier({
  quantity,
  onSetQuantity,
}: QuantityMultiplierProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 0',
      }}
    >
      <span
        style={{
          fontSize: '12px',
          color: '#94a3b8',
          marginRight: '4px',
          fontWeight: 500,
        }}
      >
        Qty:
      </span>
      {QUANTITIES.map((n) => {
        const isActive = quantity === n
        return (
          <button
            key={n}
            onClick={() => onSetQuantity(n)}
            style={{
              width: '36px',
              height: '32px',
              borderRadius: '8px',
              border: isActive
                ? '1.5px solid rgba(99, 102, 241, 0.7)'
                : '1px solid rgba(255, 255, 255, 0.1)',
              background: isActive
                ? 'rgba(99, 102, 241, 0.25)'
                : 'rgba(255, 255, 255, 0.03)',
              color: isActive ? '#a5b4fc' : '#94a3b8',
              fontSize: '14px',
              fontWeight: isActive ? 700 : 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {n}
          </button>
        )
      })}
      {quantity > 1 && (
        <span
          style={{
            marginLeft: '6px',
            fontSize: '13px',
            fontWeight: 600,
            color: '#a5b4fc',
            background: 'rgba(99, 102, 241, 0.15)',
            padding: '4px 10px',
            borderRadius: '6px',
          }}
        >
          ×{quantity}
        </span>
      )}
    </div>
  )
})
