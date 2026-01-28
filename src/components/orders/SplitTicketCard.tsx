'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'
import type { SplitPricingResult, OrderItemInput } from '@/lib/split-pricing'

interface SplitTicketCardProps {
  ticketId: string
  displayNumber: string
  items: OrderItemInput[]
  pricing: SplitPricingResult
  selectedItemIds: Set<string>
  isActive: boolean
  isDropTarget?: boolean
  canDelete: boolean
  onItemToggle: (itemId: string) => void
  onItemMove?: (itemId: string) => void  // Direct move when destination is active
  onSelectAll: () => void
  onCardClick: () => void
  onDelete?: () => void
}

export function SplitTicketCard({
  ticketId,
  displayNumber,
  items,
  pricing,
  selectedItemIds,
  isActive,
  isDropTarget = false,
  canDelete,
  onItemToggle,
  onItemMove,
  onSelectAll,
  onCardClick,
  onDelete,
}: SplitTicketCardProps) {
  const isEmpty = items.length === 0

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all h-full flex flex-col',
        isActive && 'ring-4 ring-blue-500 bg-blue-50 shadow-lg shadow-blue-200',
        isDropTarget && 'ring-2 ring-green-500 bg-green-50',
        isEmpty && !isActive && 'opacity-60'
      )}
      onClick={onCardClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">Ticket {displayNumber}</CardTitle>
            {isActive && (
              <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded">
                DESTINATION
              </span>
            )}
          </div>
          {canDelete && isEmpty && (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7 px-2"
              onClick={(e) => {
                e.stopPropagation()
                onDelete?.()
              }}
            >
              Delete
            </Button>
          )}
        </div>
        {items.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit text-xs text-gray-500 h-6 px-2"
            onClick={(e) => {
              e.stopPropagation()
              onSelectAll()
            }}
          >
            Select All ({items.length})
          </Button>
        )}
      </CardHeader>

      <CardContent className="flex-1 overflow-auto pb-2">
        {isEmpty ? (
          <div className="text-center text-gray-400 py-8">
            <p className="text-sm">No items</p>
            <p className="text-xs mt-1">Move items here</p>
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((item) => {
              const isSelected = selectedItemIds.has(item.id)
              const pricingItem = pricing.items.find(p => p.id === item.id)
              const modifierTotal = item.modifiers?.reduce((sum, m) => sum + m.price, 0) || 0

              // If there's a destination ticket selected (isDropTarget on another card),
              // tapping this item should move it directly
              const handleItemClick = (e: React.MouseEvent) => {
                e.stopPropagation()
                if (onItemMove && !isActive) {
                  // Move directly to active destination
                  onItemMove(item.id)
                } else {
                  // Normal selection toggle
                  onItemToggle(item.id)
                }
              }

              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors',
                    isSelected ? 'bg-blue-100' : 'hover:bg-gray-50',
                    onItemMove && !isActive && 'hover:bg-green-50 hover:ring-1 hover:ring-green-300'
                  )}
                  onClick={handleItemClick}
                >
                  {!onItemMove && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onItemToggle(item.id)}
                      className="mt-1 h-4 w-4 rounded border-gray-300"
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  {onItemMove && !isActive && (
                    <span className="mt-1 text-green-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-sm font-medium truncate">
                        {item.quantity > 1 && `${item.quantity}x `}
                        {item.name}
                      </span>
                      <span className="text-sm font-medium whitespace-nowrap">
                        {formatCurrency(pricingItem?.adjustedPrice || (item.price + modifierTotal) * item.quantity)}
                      </span>
                    </div>
                    {item.modifiers && item.modifiers.length > 0 && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        {item.modifiers.map((mod, i) => (
                          <span key={i}>
                            {i > 0 && ', '}
                            {mod.name}
                            {mod.price > 0 && ` (+${formatCurrency(mod.price)})`}
                          </span>
                        ))}
                      </div>
                    )}
                    {pricingItem && pricingItem.proportionalDiscount > 0 && (
                      <div className="text-xs text-green-600 mt-0.5">
                        Discount: -{formatCurrency(pricingItem.proportionalDiscount)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      {/* Pricing Summary */}
      <div className="border-t border-gray-200 p-3 mt-auto bg-gray-50 rounded-b-xl">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Subtotal</span>
            <span>{formatCurrency(pricing.subtotal - pricing.discountTotal)}</span>
          </div>
          {pricing.discountTotal > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Discount</span>
              <span>-{formatCurrency(pricing.discountTotal)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-600">Tax</span>
            <span>{formatCurrency(pricing.taxAmount)}</span>
          </div>
          {pricing.roundingAdjustment !== 0 && (
            <div className="flex justify-between text-gray-500 text-xs">
              <span>Rounding</span>
              <span>{pricing.roundingAdjustment > 0 ? '+' : ''}{formatCurrency(pricing.roundingAdjustment)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base pt-1 border-t border-gray-200">
            <span>Total</span>
            <span>{formatCurrency(pricing.total)}</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

// New Ticket Card (+ button)
interface NewTicketCardProps {
  onClick: () => void
}

export function NewTicketCard({ onClick }: NewTicketCardProps) {
  return (
    <Card
      className="cursor-pointer border-dashed border-2 border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-all h-full flex items-center justify-center min-h-[300px]"
      onClick={onClick}
    >
      <div className="text-center text-gray-400">
        <div className="text-4xl mb-2">+</div>
        <p className="font-medium">New Ticket</p>
      </div>
    </Card>
  )
}
