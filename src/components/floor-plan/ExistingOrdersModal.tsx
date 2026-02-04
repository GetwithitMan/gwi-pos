'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { XMarkIcon, ArrowRightIcon, CreditCardIcon } from '@heroicons/react/24/outline'

interface ExistingOrder {
  tableId: string
  tableName: string
  orderId: string
  orderNumber: number
  itemCount: number
  total: number
}

interface OrderAction {
  orderId: string
  action: 'merge' | 'close'
}

interface ExistingOrdersModalProps {
  isOpen: boolean
  existingOrders: ExistingOrder[]
  primaryTableName: string
  onConfirm: (actions: OrderAction[]) => void
  onCancel: () => void
  onCloseOrder: (orderId: string) => void
  isProcessing?: boolean
}

export function ExistingOrdersModal({
  isOpen,
  existingOrders,
  primaryTableName,
  onConfirm,
  onCancel,
  onCloseOrder,
  isProcessing = false,
}: ExistingOrdersModalProps) {
  const [orderActions, setOrderActions] = useState<Map<string, 'merge' | 'close'>>(
    new Map(existingOrders.map(o => [o.orderId, 'merge']))
  )

  if (!isOpen) return null

  const handleActionChange = (orderId: string, action: 'merge' | 'close') => {
    const newActions = new Map(orderActions)
    newActions.set(orderId, action)
    setOrderActions(newActions)
  }

  const handleConfirm = () => {
    // Check if any orders are set to 'close'
    const ordersToClose = existingOrders.filter(
      o => orderActions.get(o.orderId) === 'close'
    )

    if (ordersToClose.length > 0) {
      // Close each order first
      ordersToClose.forEach(o => onCloseOrder(o.orderId))
    }

    // Build actions array for merge only
    const actions: OrderAction[] = []
    for (const order of existingOrders) {
      const action = orderActions.get(order.orderId)
      if (action === 'merge') {
        actions.push({ orderId: order.orderId, action: 'merge' })
      }
    }

    onConfirm(actions)
  }

  const allMerge = existingOrders.every(o => orderActions.get(o.orderId) === 'merge')
  const hasCloseActions = existingOrders.some(o => orderActions.get(o.orderId) === 'close')

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-full max-w-lg mx-4 bg-slate-900 rounded-2xl shadow-2xl border border-slate-700/50 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Existing Orders Found
              </h2>
              <p className="text-sm text-slate-400">
                These tables have open orders. How should they be handled?
              </p>
            </div>
            <button
              onClick={onCancel}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Order list */}
          <div className="px-6 py-4 space-y-3 max-h-80 overflow-y-auto">
            {existingOrders.map((order) => {
              const currentAction = orderActions.get(order.orderId) || 'merge'

              return (
                <div
                  key={order.orderId}
                  className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="font-medium text-white">{order.tableName}</span>
                      <span className="ml-2 text-sm text-slate-400">
                        Order #{order.orderNumber}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-white">
                        ${order.total.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-400">
                        {order.itemCount} item{order.itemCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleActionChange(order.orderId, 'merge')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        currentAction === 'merge'
                          ? 'bg-cyan-500 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      <ArrowRightIcon className="w-4 h-4" />
                      Add to Group
                    </button>
                    <button
                      onClick={() => handleActionChange(order.orderId, 'close')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        currentAction === 'close'
                          ? 'bg-amber-500 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      <CreditCardIcon className="w-4 h-4" />
                      Close Out
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-800/30">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-400">
                {allMerge ? (
                  <>All items will merge into <span className="text-cyan-400">{primaryTableName}</span></>
                ) : hasCloseActions ? (
                  <>Some orders will be closed out first</>
                ) : (
                  <>Configure how to handle each order</>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isProcessing}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    isProcessing
                      ? 'bg-slate-700 text-slate-400 cursor-wait'
                      : 'bg-cyan-500 text-white hover:bg-cyan-400'
                  }`}
                >
                  {isProcessing ? 'Processing...' : 'Continue'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
