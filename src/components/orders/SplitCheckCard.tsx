'use client'

import { memo } from 'react'
import { getSeatBgColor, getSeatTextColor } from '@/lib/seat-utils'
import type { SplitItemShare, SplitCheck } from '@/hooks/useSplitCheck'

export interface SplitCheckCardProps {
  check: SplitCheck
  isDropTarget: boolean
  selectedItemId: string | null
  onItemTap: (itemId: string) => void
  onCardTap: (checkId: string) => void
  onDeleteCheck?: () => void
  canDelete: boolean
}

export const SplitCheckCard = memo(function SplitCheckCard({
  check,
  isDropTarget,
  selectedItemId,
  onItemTap,
  onCardTap,
  onDeleteCheck,
  canDelete,
}: SplitCheckCardProps) {
  const headerBg = check.seatNumber
    ? getSeatBgColor(check.seatNumber)
    : `rgba(${hexToRgbValues(check.color)}, 0.15)`

  const activeItemCount = check.items.filter(i => !i.isPaid).length

  return (
    <div
      style={{
        background: isDropTarget
          ? 'rgba(40, 40, 56, 0.95)'
          : 'rgba(30, 30, 46, 0.95)',
        borderRadius: '16px',
        border: isDropTarget
          ? `2px dashed ${check.color}`
          : `1px solid ${check.color}40`,
        boxShadow: isDropTarget
          ? `0 0 20px ${check.color}30`
          : '0 2px 8px rgba(0, 0, 0, 0.3)',
        minWidth: '200px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'border 0.2s ease, box-shadow 0.2s ease, background 0.2s ease',
      }}
    >
      {/* Header */}
      <div
        onClick={() => onCardTap(check.id)}
        style={{
          background: headerBg,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderBottom: `1px solid ${check.color}20`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Color dot */}
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: check.color,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: check.seatNumber
                ? getSeatTextColor(check.seatNumber)
                : '#e2e8f0',
            }}
          >
            {check.label}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Item count badge */}
          {check.items.length > 0 && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
              }}
            >
              {check.items.length}
            </span>
          )}
          {/* Subtotal */}
          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: '#e2e8f0',
            }}
          >
            ${check.subtotal.toFixed(2)}
          </span>
          {/* Delete button */}
          {canDelete && check.items.length === 0 && onDeleteCheck && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDeleteCheck()
              }}
              style={{
                padding: '3px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '5px',
                color: '#f87171',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Delete check"
            >
              <svg
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Items list */}
      <div
        onClick={() => onCardTap(check.id)}
        style={{
          flex: 1,
          padding: '6px 0',
          cursor: isDropTarget ? 'pointer' : 'default',
          minHeight: '40px',
        }}
      >
        {check.items.length === 0 ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              fontSize: '13px',
              color: '#64748b',
              fontStyle: 'italic',
            }}
          >
            No items
          </div>
        ) : (
          check.items.map((item) => {
            const isSelected = item.id === selectedItemId
            return (
              <div
                key={item.id}
                onClick={(e) => {
                  if (item.isPaid) return
                  e.stopPropagation()
                  onItemTap(item.id)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 14px',
                  cursor: item.isPaid ? 'default' : 'pointer',
                  opacity: item.isPaid ? 0.4 : 1,
                  background: isSelected
                    ? `${check.color}15`
                    : 'transparent',
                  borderLeft: isSelected
                    ? `3px solid ${check.color}`
                    : '3px solid transparent',
                  boxShadow: isSelected
                    ? `inset 0 0 12px ${check.color}10`
                    : 'none',
                  transition: 'background 0.15s ease, border-left 0.15s ease',
                }}
              >
                {/* Left: name with quantity and fraction */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {item.quantity > 1 && (
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#a78bfa',
                        flexShrink: 0,
                      }}
                    >
                      {item.quantity}x
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: '#e2e8f0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </span>
                  {item.fractionLabel && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: '8px',
                        background: 'rgba(168, 85, 247, 0.2)',
                        color: '#c084fc',
                        flexShrink: 0,
                      }}
                    >
                      {item.fractionLabel}
                    </span>
                  )}
                  {item.isSentToKitchen && !item.isPaid && (
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: 'rgba(59, 130, 246, 0.15)',
                        color: '#60a5fa',
                        flexShrink: 0,
                      }}
                    >
                      Sent
                    </span>
                  )}
                  {item.isPaid && (
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: 'rgba(34, 197, 94, 0.15)',
                        color: '#4ade80',
                        flexShrink: 0,
                      }}
                    >
                      Paid
                    </span>
                  )}
                </div>

                {/* Right: price */}
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#e2e8f0',
                    flexShrink: 0,
                    marginLeft: '8px',
                  }}
                >
                  ${item.price.toFixed(2)}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
})

/** Extract r,g,b values from a hex color string for use in rgba(). */
function hexToRgbValues(hex: string): string {
  const cleaned = hex.replace('#', '')
  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}
