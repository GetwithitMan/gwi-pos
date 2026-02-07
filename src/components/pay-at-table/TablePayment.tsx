'use client'

interface OrderSummary {
  id: string
  orderNumber: number
  items: Array<{
    name: string
    quantity: number
    price: number
    modifiers?: string[]
  }>
  subtotal: number
  tax: number
  total: number
  tabName?: string
}

interface TablePaymentProps {
  order: OrderSummary | null
  onPay: () => void
  onSplit: () => void
}

export default function TablePayment({ order, onPay, onSplit }: TablePaymentProps) {
  if (!order) return null

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {order.tabName || `Order #${order.orderNumber}`}
          </h1>
          <p className="text-white/40 text-sm">Pay at Table</p>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {order.items.map((item, i) => (
          <div key={i} className="flex justify-between items-start py-2 border-b border-white/5">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {item.quantity > 1 && (
                  <span className="text-white/40 text-sm">{item.quantity}x</span>
                )}
                <span className="text-white">{item.name}</span>
              </div>
              {item.modifiers && item.modifiers.length > 0 && (
                <div className="ml-6 mt-0.5">
                  {item.modifiers.map((mod, j) => (
                    <p key={j} className="text-white/30 text-sm">{mod}</p>
                  ))}
                </div>
              )}
            </div>
            <span className="text-white/70 tabular-nums">
              ${(item.price * item.quantity).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="p-4 border-t border-white/10 space-y-2">
        <div className="flex justify-between text-white/50">
          <span>Subtotal</span>
          <span className="tabular-nums">${order.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-white/50">
          <span>Tax</span>
          <span className="tabular-nums">${order.tax.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xl font-bold pt-2 border-t border-white/10">
          <span>Total</span>
          <span className="tabular-nums">${order.total.toFixed(2)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="p-4 flex gap-3">
        <button
          onClick={onSplit}
          className="flex-1 py-4 rounded-xl bg-white/10 text-white font-medium text-lg hover:bg-white/20 transition-colors"
        >
          Split Check
        </button>
        <button
          onClick={onPay}
          className="flex-1 py-4 rounded-xl bg-blue-500 text-white font-medium text-lg hover:bg-blue-600 transition-colors"
        >
          Pay Full
        </button>
      </div>
    </div>
  )
}
