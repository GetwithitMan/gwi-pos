'use client'

import { useEffect, useState } from 'react'

interface AllergenNoticeProps {
  itemName: string
  allergens: string[]
  onDismiss: () => void
}

/**
 * Brief allergen notice that auto-dismisses after 3 seconds.
 * Shown when adding an item with allergens to an order.
 */
export function AllergenNotice({ itemName, allergens, onDismiss }: AllergenNoticeProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      onDismiss()
    }, 3000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        maxWidth: '400px',
        width: '90vw',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #7c2d12, #9a3412)',
          border: '2px solid #fb923c',
          borderRadius: '12px',
          padding: '12px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'slideUp 0.3s ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style={{ color: '#fed7aa', fontSize: '13px', fontWeight: 700 }}>
            Allergen Alert — {itemName}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {allergens.map(a => (
            <span
              key={a}
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'rgba(251, 146, 60, 0.2)',
                color: '#fdba74',
                border: '1px solid rgba(251, 146, 60, 0.4)',
              }}
            >
              {a}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
