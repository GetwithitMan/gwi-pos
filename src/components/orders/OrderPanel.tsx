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
    <div className={`flex flex-col h-full bg-white border-l border-gray-200 ${className}`}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            {orderNumber && (
              <h2 className="text-lg font-bold text-gray-900">Order #{orderNumber}</h2>
            )}
            {tabName && (
              <h2 className="text-lg font-bold text-gray-900">{tabName}</h2>
            )}
            {!orderNumber && !tabName && (
              <h2 className="text-lg font-bold text-gray-900">New Order</h2>
            )}
            {orderType && (
              <p className="text-sm text-gray-600 capitalize">{orderType.replace('_', ' ')}</p>
            )}
            {/* Card status */}
            {hasCard !== undefined && (
              <div className="mt-1">
                {hasCard && cardLast4 ? (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                    💳 ****{cardLast4}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">
                    ⚠️ No Card
                  </span>
                )}
              </div>
            )}
          </div>
          {orderId && (
            <div className="text-xs text-gray-400 font-mono">{orderId.slice(-8)}</div>
          )}
        </div>
      </div>

      {/* Items list (scrollable) */}
      <div className="flex-1 overflow-y-auto px-4">
        {hasItems ? (
          <div className="py-2">
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
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400 mb-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <p className="text-sm">No items yet</p>
              <p className="text-xs text-gray-400 mt-1">Add items to start an order</p>
            </div>
          </div>
        )}
      </div>

      {/* Totals section */}
      {hasItems && (
        <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span className="font-medium text-gray-900">${subtotal.toFixed(2)}</span>
          </div>
          {discounts > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Discounts</span>
              <span className="font-medium text-red-600">-${discounts.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Tax</span>
            <span className="font-medium text-gray-900">${tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-300">
            <span className="text-gray-900">Total</span>
            <span className="text-gray-900">${total.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Action buttons (sticky at bottom) */}
      <div className="flex-shrink-0">
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
