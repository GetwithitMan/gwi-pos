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

  return (
    <div className="border-b border-gray-200 py-2">
      {/* Main item row */}
      <div className="flex items-start gap-2">
        {/* Tappable item area */}
        <div
          className={`flex-1 flex items-start gap-2 min-w-0 ${
            onClick ? 'cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 transition-colors' : ''
          }`}
          onClick={() => onClick?.(item)}
        >
          {/* Quantity badge */}
          <div className="flex-shrink-0 w-6 h-6 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-medium">
            {item.quantity}
          </div>

          {/* Item name and details */}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-gray-900">
              {item.name}
            </div>

          {/* Status badge */}
          {item.kitchenStatus && item.kitchenStatus !== 'pending' && (
            <span
              className={`inline-block text-xs px-2 py-0.5 rounded mt-1 ${
                item.kitchenStatus === 'sent'
                  ? 'bg-blue-100 text-blue-700'
                  : item.kitchenStatus === 'cooking'
                  ? 'bg-amber-100 text-amber-700'
                  : item.kitchenStatus === 'ready'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {item.kitchenStatus.charAt(0).toUpperCase() + item.kitchenStatus.slice(1)}
            </span>
          )}

          {/* Held badge */}
          {item.isHeld && (
            <span className="inline-block text-xs px-2 py-0.5 rounded mt-1 ml-1 bg-purple-100 text-purple-700">
              Held
            </span>
          )}

          {/* Modifiers */}
          {item.modifiers && item.modifiers.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {item.modifiers.map((mod, idx) => (
                <div key={idx} className="text-sm text-gray-600 flex justify-between pl-4">
                  <span>• {mod.name}</span>
                  {mod.price > 0 && <span className="text-gray-500">+${mod.price.toFixed(2)}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Special notes */}
          {item.specialNotes && (
            <div className="mt-1 text-sm italic text-gray-500 pl-4">
              Note: {item.specialNotes}
            </div>
          )}

          {/* Entertainment timer */}
          {showEntertainmentTimer &&
            item.isTimedRental &&
            item.menuItemId &&
            locationId &&
            (item.blockTimeMinutes || item.blockTimeStartedAt || item.blockTimeExpiresAt) && (
              <div className="mt-2">
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
          <div className="flex-shrink-0 text-right">
            <div className="font-medium text-gray-900">${totalPrice.toFixed(2)}</div>
            {item.quantity > 1 && (
              <div className="text-xs text-gray-500">${(totalPrice / item.quantity).toFixed(2)} ea</div>
            )}
          </div>
        </div>

        {/* Control buttons */}
        {showControls && (
          <div className="flex-shrink-0 flex flex-col gap-1">
            {onQuantityChange && (
              <>
                <button
                  onClick={() => onQuantityChange(item.id, 1)}
                  className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-sm"
                  title="Increase quantity"
                >
                  +
                </button>
                <button
                  onClick={() => onQuantityChange(item.id, -1)}
                  className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-sm"
                  title="Decrease quantity"
                  disabled={item.quantity <= 1}
                >
                  −
                </button>
              </>
            )}
            {onRemove && (
              <button
                onClick={() => onRemove(item.id)}
                className="w-6 h-6 rounded bg-red-100 hover:bg-red-200 text-red-600 flex items-center justify-center text-sm"
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
