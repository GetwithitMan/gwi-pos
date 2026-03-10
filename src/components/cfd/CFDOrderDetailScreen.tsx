'use client'

import type { CFDShowOrderDetailEvent } from '@/types/multi-surface'

interface CFDOrderDetailScreenProps {
  data: CFDShowOrderDetailEvent | null
}

/**
 * CFD Order Detail Confirmation Screen
 *
 * Shows a full itemized order summary to the customer before payment.
 * Displays item names, quantities, prices, modifiers, and totals.
 * Triggered by the `cfd:show-order-detail` event when the order is
 * about to be paid (before card swipe).
 */
export default function CFDOrderDetailScreen({ data }: CFDOrderDetailScreenProps) {
  if (!data) return null

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 p-8">
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-3xl font-semibold text-white">Your Order</h2>
        {data.orderNumber > 0 && (
          <p className="text-white/40 text-sm mt-1">Order #{data.orderNumber}</p>
        )}
        <p className="text-white/50 text-sm mt-2">Please confirm your items</p>
      </div>

      {/* Itemized list */}
      <div className="flex-1 overflow-y-auto space-y-2 max-w-lg mx-auto w-full">
        {data.items.map((item, i) => (
          <div key={i} className="flex justify-between items-start py-3 border-b border-white/10">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {item.quantity > 1 && (
                  <span className="bg-white/10 text-white/60 text-xs px-2 py-0.5 rounded">
                    {item.quantity}x
                  </span>
                )}
                <span className="text-white text-lg">{item.name}</span>
              </div>
              {item.modifiers && item.modifiers.length > 0 && (
                <div className="ml-6 mt-1 space-y-0.5">
                  {item.modifiers.map((mod, j) => (
                    <p key={j} className="text-white/40 text-sm">{mod}</p>
                  ))}
                </div>
              )}
            </div>
            <span className="text-white/70 text-lg tabular-nums ml-4">
              ${(item.price * item.quantity).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="max-w-lg mx-auto w-full pt-4 border-t border-white/20 space-y-2">
        <div className="flex justify-between text-white/50">
          <span>Subtotal</span>
          <span className="tabular-nums">${data.subtotal.toFixed(2)}</span>
        </div>
        {data.discountTotal != null && data.discountTotal > 0 && (
          <div className="flex justify-between text-green-400">
            <span>Discount</span>
            <span className="tabular-nums">-${data.discountTotal.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-white/50">
          <span>Tax</span>
          <span className="tabular-nums">${data.tax.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-white text-2xl font-bold pt-2 border-t border-white/20">
          <span>Total</span>
          <span className="tabular-nums">${data.total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}
