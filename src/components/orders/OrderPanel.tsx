'use client'

import { OrderPanelItem, type OrderPanelItemData } from './OrderPanelItem'
import { OrderPanelActions } from './OrderPanelActions'

export type { OrderPanelItemData }

export interface OrderPanelProps {
  orderId?: string | null
  orderNumber?: number
  orderType?: string
  tabName?: string
  tableId?: string
  locationId?: string
  items: OrderPanelItemData[]
  subtotal: number
  tax: number
  discounts: number
  total: number
  showItemControls?: boolean
  showEntertainmentTimers?: boolean
  cardLast4?: string
  cardBrand?: string
  hasCard?: boolean
  onItemClick?: (item: OrderPanelItemData) => void
  onItemRemove?: (itemId: string) => void
  onQuantityChange?: (itemId: string, delta: number) => void
  onSend?: () => void
  onPay?: () => void
  onDiscount?: () => void
  onClear?: () => void
  onSessionEnded?: () => void
  onTimerStarted?: () => void
  onTimeExtended?: () => void
  isSending?: boolean
  className?: string
}

export function OrderPanel({
  orderId,
  orderNumber,
  orderType,
  tabName,
  tableId,
  locationId,
  items,
  subtotal,
  tax,
  discounts,
  total,
  showItemControls = false,
  showEntertainmentTimers = false,
  cardLast4,
  cardBrand,
  hasCard,
  onItemClick,
  onItemRemove,
  onQuantityChange,
  onSend,
  onPay,
  onDiscount,
  onClear,
  onSessionEnded,
  onTimerStarted,
  onTimeExtended,
  isSending = false,
  className = '',
}: OrderPanelProps) {
  const hasItems = items.length > 0
  const hasPendingItems = items.some(item => !item.kitchenStatus || item.kitchenStatus === 'pending')

  return (
    <div
      className={`flex flex-col h-full ${className}`}
      style={{
        background: 'rgba(15, 23, 42, 0.95)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            {orderNumber && (
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
                Order #{orderNumber}
              </h2>
            )}
            {tabName && !orderNumber && (
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
                {tabName}
              </h2>
            )}
            {!orderNumber && !tabName && (
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
                New Order
              </h2>
            )}
            {orderType && (
              <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', textTransform: 'capitalize' }}>
                {orderType.replace('_', ' ')}
              </p>
            )}
            {/* Card status */}
            {hasCard !== undefined && (
              <div style={{ marginTop: '6px' }}>
                {hasCard && cardLast4 ? (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: '#4ade80',
                  }}>
                    💳 ****{cardLast4}
                  </span>
                ) : (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#f87171',
                  }}>
                    ⚠️ No Card
                  </span>
                )}
              </div>
            )}
          </div>
          {orderId && (
            <div style={{ fontSize: '10px', color: '#475569', fontFamily: 'monospace' }}>
              {orderId.slice(-8)}
            </div>
          )}
        </div>
      </div>

      {/* Items list (scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {hasItems ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {items.map((item) => (
              <OrderPanelItem
                key={item.id}
                item={item}
                locationId={locationId}
                showControls={showItemControls}
                showEntertainmentTimer={showEntertainmentTimers}
                onClick={onItemClick}
                onRemove={onItemRemove}
                onQuantityChange={onQuantityChange}
                onSessionEnded={onSessionEnded}
                onTimerStarted={onTimerStarted}
                onTimeExtended={onTimeExtended}
              />
            ))}
          </div>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            textAlign: 'center',
            padding: '40px 20px',
          }}>
            <div>
              <svg
                style={{ margin: '0 auto 16px', opacity: 0.4 }}
                width="48"
                height="48"
                fill="none"
                viewBox="0 0 24 24"
                stroke="#64748b"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <p style={{ fontSize: '14px', color: '#64748b' }}>No items yet</p>
              <p style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                Add items to start an order
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Totals section */}
      {hasItems && (
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
            <span style={{ color: '#94a3b8' }}>Subtotal</span>
            <span style={{ color: '#e2e8f0', fontWeight: 500 }}>${subtotal.toFixed(2)}</span>
          </div>
          {discounts > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
              <span style={{ color: '#94a3b8' }}>Discounts</span>
              <span style={{ color: '#f87171', fontWeight: 500 }}>-${discounts.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '10px' }}>
            <span style={{ color: '#94a3b8' }}>Tax</span>
            <span style={{ color: '#e2e8f0', fontWeight: 500 }}>${tax.toFixed(2)}</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '18px',
              fontWeight: 700,
              paddingTop: '10px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <span style={{ color: '#f1f5f9' }}>Total</span>
            <span style={{ color: '#f1f5f9' }}>${total.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Action buttons (sticky at bottom) */}
      <div style={{ flexShrink: 0 }}>
        <OrderPanelActions
          hasItems={hasItems}
          hasPendingItems={hasPendingItems}
          isSending={isSending}
          onSend={onSend}
          onPay={onPay}
          onDiscount={onDiscount}
          onClear={onClear}
        />
      </div>
    </div>
  )
}
