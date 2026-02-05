'use client'

import { Button } from '@/components/ui/button'

interface OrderPanelActionsProps {
  hasItems: boolean
  hasPendingItems: boolean
  isSending?: boolean
  onSend?: () => void
  onPay?: () => void
  onDiscount?: () => void
  onClear?: () => void
}

export function OrderPanelActions({
  hasItems,
  hasPendingItems,
  isSending = false,
  onSend,
  onPay,
  onDiscount,
  onClear,
}: OrderPanelActionsProps) {
  const handleClear = () => {
    if (!hasItems) return

    const confirmed = window.confirm(
      'Are you sure you want to clear this order? This cannot be undone.'
    )

    if (confirmed) {
      onClear?.()
    }
  }

  return (
    <div className="border-t border-gray-200 bg-white p-4 space-y-2">
      {/* Primary actions */}
      <div className="grid grid-cols-2 gap-2">
        {onSend && (
          <Button
            onClick={onSend}
            disabled={!hasPendingItems || isSending}
            className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 disabled:text-gray-500"
          >
            {isSending ? 'Sending...' : 'Send to Kitchen'}
          </Button>
        )}
        {onPay && (
          <Button
            onClick={onPay}
            disabled={!hasItems}
            className="bg-green-600 hover:bg-green-700 text-white disabled:bg-gray-300 disabled:text-gray-500"
          >
            Pay
          </Button>
        )}
      </div>

      {/* Secondary actions */}
      <div className="grid grid-cols-2 gap-2">
        {onDiscount && (
          <Button
            onClick={onDiscount}
            disabled={!hasItems}
            variant="outline"
            className="border-gray-300 disabled:opacity-50"
          >
            Discount
          </Button>
        )}
        {onClear && (
          <Button
            onClick={handleClear}
            disabled={!hasItems}
            variant="outline"
            className="border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Clear Order
          </Button>
        )}
      </div>
    </div>
  )
}
