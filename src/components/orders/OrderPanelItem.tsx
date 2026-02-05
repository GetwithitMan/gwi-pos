'use client'

import { EntertainmentSessionControls } from './EntertainmentSessionControls'

export interface OrderPanelItemData {
  id: string
  name: string
  quantity: number
  price: number
  modifiers?: { name: string; price: number }[]
  specialNotes?: string
  kitchenStatus?: 'pending' | 'sent' | 'cooking' | 'ready' | 'served'
  isHeld?: boolean
  isCompleted?: boolean
  completedAt?: string
  // Entertainment
  isTimedRental?: boolean
  menuItemId?: string
  blockTimeMinutes?: number
  blockTimeStartedAt?: string
  blockTimeExpiresAt?: string
}

interface OrderPanelItemProps {
  item: OrderPanelItemData
  locationId?: string
  showControls?: boolean
  showEntertainmentTimer?: boolean
  onClick?: (item: OrderPanelItemData) => void
  onRemove?: (itemId: string) => void
  onQuantityChange?: (itemId: string, delta: number) => void
  onSessionEnded?: () => void
  onTimerStarted?: () => void
  onTimeExtended?: () => void
}

export function OrderPanelItem({
  item,
  locationId,
  showControls = false,
  showEntertainmentTimer = false,
  onClick,
  onRemove,
  onQuantityChange,
  onSessionEnded,
  onTimerStarted,
  onTimeExtended,
}: OrderPanelItemProps) {
  const itemTotal = item.price * item.quantity
  const modifiersTotal = (item.modifiers || []).reduce((sum, mod) => sum + mod.price, 0) * item.quantity
  const totalPrice = itemTotal + modifiersTotal

  const isSent = item.kitchenStatus && item.kitchenStatus !== 'pending'
  const isReady = item.kitchenStatus === 'ready' || item.isCompleted

  // Status config for badges
  const STATUS_CONFIG: Record<string, { color: string; bgColor: string; label: string }> = {
    sent: { color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.15)', label: 'Sent' },
    cooking: { color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.15)', label: 'Cooking' },
    ready: { color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.15)', label: 'Ready' },
    served: { color: '#6366f1', bgColor: 'rgba(99, 102, 241, 0.15)', label: 'Served' },
  }

  const statusConfig = item.kitchenStatus ? STATUS_CONFIG[item.kitchenStatus] : null

  return (
    <div
      style={{
        padding: '12px',
        background: isReady
          ? 'rgba(34, 197, 94, 0.08)'
          : isSent
          ? 'rgba(59, 130, 246, 0.05)'
          : 'rgba(255, 255, 255, 0.03)',
        border: `1px solid ${
          isReady
            ? 'rgba(34, 197, 94, 0.25)'
            : isSent
            ? 'rgba(59, 130, 246, 0.15)'
            : 'rgba(255, 255, 255, 0.08)'
        }`,
        borderRadius: '10px',
        cursor: onClick && !isSent ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
      }}
      onClick={() => !isSent && onClick?.(item)}
      onMouseEnter={(e) => {
        if (onClick && !isSent) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'
        }
      }}
      onMouseLeave={(e) => {
        if (!isSent) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'
        }
      }}
    >
      {/* Main item row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        {/* Quantity badge */}
        <div
          style={{
            flexShrink: 0,
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            background: isSent ? 'rgba(59, 130, 246, 0.2)' : 'rgba(168, 85, 247, 0.2)',
            color: isSent ? '#60a5fa' : '#c084fc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {item.quantity}
        </div>

        {/* Item details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#e2e8f0' }}>
              {item.name}
            </span>

            {/* Status badge */}
            {statusConfig && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: statusConfig.bgColor,
                  color: statusConfig.color,
                  fontWeight: 600,
                }}
              >
                {statusConfig.label}
              </span>
            )}

            {/* MADE badge */}
            {item.isCompleted && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(34, 197, 94, 0.2)',
                  color: '#4ade80',
                  fontWeight: 700,
                }}
              >
                ✓ MADE
              </span>
            )}

            {/* Held badge */}
            {item.isHeld && (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#f87171',
                  fontWeight: 600,
                }}
              >
                HELD
              </span>
            )}
          </div>

          {/* Modifiers */}
          {item.modifiers && item.modifiers.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              {item.modifiers.map((mod, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: '12px',
                    color: '#94a3b8',
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingLeft: '8px',
                    lineHeight: 1.4,
                  }}
                >
                  <span>• {mod.name}</span>
                  {mod.price > 0 && (
                    <span style={{ color: '#64748b' }}>+${mod.price.toFixed(2)}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Special notes */}
          {item.specialNotes && (
            <div
              style={{
                marginTop: '6px',
                fontSize: '11px',
                color: '#f59e0b',
                fontStyle: 'italic',
                paddingLeft: '8px',
              }}
            >
              Note: {item.specialNotes}
            </div>
          )}

          {/* Entertainment timer */}
          {showEntertainmentTimer &&
            item.isTimedRental &&
            item.menuItemId &&
            locationId &&
            (item.blockTimeMinutes || item.blockTimeStartedAt || item.blockTimeExpiresAt) && (
              <div style={{ marginTop: '8px' }}>
                <EntertainmentSessionControls
                  orderItemId={item.id}
                  menuItemId={item.menuItemId}
                  locationId={locationId}
                  itemName={item.name}
                  blockTimeMinutes={item.blockTimeMinutes || null}
                  blockTimeStartedAt={item.blockTimeStartedAt || null}
                  blockTimeExpiresAt={item.blockTimeExpiresAt || null}
                  isTimedRental={item.isTimedRental}
                  defaultBlockMinutes={item.blockTimeMinutes || 60}
                  onSessionEnded={onSessionEnded}
                  onTimerStarted={onTimerStarted}
                  onTimeExtended={onTimeExtended}
                />
              </div>
            )}
        </div>

        {/* Price */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
            ${totalPrice.toFixed(2)}
          </div>
          {item.quantity > 1 && (
            <div style={{ fontSize: '10px', color: '#64748b' }}>
              ${(totalPrice / item.quantity).toFixed(2)} ea
            </div>
          )}
        </div>

        {/* Control buttons */}
        {showControls && !isSent && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {onQuantityChange && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onQuantityChange(item.id, 1)
                  }}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '4px',
                    border: 'none',
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 600,
                  }}
                  title="Increase quantity"
                >
                  +
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onQuantityChange(item.id, -1)
                  }}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '4px',
                    border: 'none',
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#94a3b8',
                    cursor: item.quantity <= 1 ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 600,
                    opacity: item.quantity <= 1 ? 0.5 : 1,
                  }}
                  title="Decrease quantity"
                  disabled={item.quantity <= 1}
                >
                  −
                </button>
              </>
            )}
            {onRemove && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(item.id)
                }}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  border: 'none',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
                title="Remove item"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
