// src/components/floor-plan/OrderPanelV2.tsx
'use client'

import React, { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFloorPlanStore, OrderItem } from './useFloorPlanStore'

interface OrderPanelV2Props {
  locationId: string
  employeeId?: string
  onOpenPayment?: (orderId: string) => void
  onOpenModifiers?: (item: OrderItem) => void
  onError?: (message: string) => void
  onSuccess?: (message: string) => void
}

/**
 * OrderPanelV2 - Slide-out order panel for FloorPlanHomeV2.
 *
 * Features:
 * - Shows active order items
 * - Per-seat grouping when seats are used
 * - Send to Kitchen button
 * - Pay button (opens payment modal)
 * - Integrates with useFloorPlanStore
 */
export const OrderPanelV2: React.FC<OrderPanelV2Props> = ({
  locationId,
  employeeId,
  onOpenPayment,
  onOpenModifiers,
  onError,
  onSuccess,
}) => {
  const {
    tables,
    seats,
    activeOrder,
    orderItems,
    showOrderPanel,
    activeSeatNumber,
    closeOrderPanel,
    setActiveOrder,
    setOrderItems,
    removeOrderItem,
    setActiveSeat,
  } = useFloorPlanStore()

  // Get active table info
  const activeTable = useMemo(() => {
    if (!activeOrder?.tableId) return null
    return tables.find(t => t.id === activeOrder.tableId) || null
  }, [activeOrder?.tableId, tables])

  // Get seats for active table (for seat selection)
  const tableSeats = useMemo(() => {
    if (!activeOrder?.tableId) return []
    return seats.filter(s => s.tableId === activeOrder.tableId)
  }, [activeOrder?.tableId, seats])

  // Calculate order totals
  const { subtotal, itemCount, unsavedCount } = useMemo(() => {
    let subtotal = 0
    let itemCount = 0
    let unsavedCount = 0

    orderItems.forEach(item => {
      if (item.status === 'voided' || item.status === 'comped') return
      const itemTotal = item.price * item.quantity
      const modifiersTotal = item.modifiers.reduce((sum, m) => sum + m.price, 0) * item.quantity
      subtotal += itemTotal + modifiersTotal
      itemCount += item.quantity
      if (!item.sentToKitchen && !item.isHeld) {
        unsavedCount += item.quantity
      }
    })

    return { subtotal, itemCount, unsavedCount }
  }, [orderItems])

  // Group items by seat
  const itemsBySeat = useMemo(() => {
    if (tableSeats.length === 0) {
      return [{ seatNumber: null, label: 'All Items', items: orderItems }]
    }

    const groups: { seatNumber: number | null; label: string; items: OrderItem[] }[] = []

    // Create groups for each seat
    tableSeats.forEach(seat => {
      groups.push({
        seatNumber: seat.seatNumber,
        label: seat.label || `Seat ${seat.seatNumber}`,
        items: orderItems.filter(item => item.seatNumber === seat.seatNumber),
      })
    })

    // Add shared/unassigned items
    const sharedItems = orderItems.filter(item => !item.seatNumber)
    if (sharedItems.length > 0) {
      groups.push({
        seatNumber: null,
        label: 'Shared',
        items: sharedItems,
      })
    }

    return groups.filter(g => g.items.length > 0)
  }, [orderItems, tableSeats])

  // Handle send to kitchen
  const handleSendToKitchen = async () => {
    if (!activeOrder || orderItems.length === 0) return

    const unsavedItems = orderItems.filter(item => !item.sentToKitchen && !item.isHeld)
    if (unsavedItems.length === 0) {
      onError?.('No items to send')
      return
    }

    try {
      // If no order exists yet, create one
      let orderId = activeOrder.id
      if (!orderId) {
        const createRes = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            employeeId,
            tableId: activeOrder.tableId,
            orderType: activeOrder.orderType,
            guestCount: activeOrder.guestCount,
          }),
        })

        if (!createRes.ok) {
          const data = await createRes.json()
          onError?.(data.error || 'Failed to create order')
          return
        }

        const createData = await createRes.json()
        orderId = createData.id
        setActiveOrder({
          ...activeOrder,
          id: orderId,
          orderNumber: String(createData.orderNumber),
        })
      }

      // Add items to order
      const itemsRes = await fetch(`/api/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: unsavedItems.map(item => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            modifiers: item.modifiers.map(m => ({ modifierId: m.id })),
            specialNotes: item.specialNotes,
            seatNumber: item.seatNumber,
            sourceTableId: item.sourceTableId,
          })),
        }),
      })

      if (!itemsRes.ok) {
        const data = await itemsRes.json()
        onError?.(data.error || 'Failed to add items')
        return
      }

      // Send to kitchen
      const sendRes = await fetch(`/api/orders/${orderId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      })

      if (!sendRes.ok) {
        const data = await sendRes.json()
        onError?.(data.error || 'Failed to send to kitchen')
        return
      }

      // Mark items as sent
      const updatedItems = orderItems.map(item =>
        unsavedItems.some(u => u.id === item.id)
          ? { ...item, sentToKitchen: true }
          : item
      )
      setOrderItems(updatedItems)

      onSuccess?.(`Sent ${unsavedItems.length} item(s) to kitchen`)
    } catch (err) {
      console.error('Send to kitchen error:', err)
      onError?.('Failed to send to kitchen')
    }
  }

  // Handle pay button
  const handlePay = () => {
    if (!activeOrder?.id) {
      onError?.('No order to pay')
      return
    }
    onOpenPayment?.(activeOrder.id)
  }

  // Handle item remove
  const handleRemoveItem = (itemId: string) => {
    removeOrderItem(itemId)
  }

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  if (!showOrderPanel) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed right-0 top-0 bottom-0 w-96 bg-slate-800 border-l border-slate-700 shadow-2xl z-40 flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">
              {activeTable?.name || activeOrder?.orderType || 'New Order'}
            </h2>
            {activeOrder?.orderNumber && (
              <span className="text-sm text-slate-400">
                Order #{activeOrder.orderNumber}
              </span>
            )}
          </div>
          <button
            onClick={closeOrderPanel}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Seat selector (if table has seats) */}
        {tableSeats.length > 0 && (
          <div className="p-3 border-b border-slate-700 flex flex-wrap gap-2">
            <button
              onClick={() => setActiveSeat(null)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeSeatNumber === null
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              All
            </button>
            {tableSeats.map(seat => (
              <button
                key={seat.id}
                onClick={() => setActiveSeat(seat.seatNumber, activeOrder?.tableId)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeSeatNumber === seat.seatNumber
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {seat.label || `S${seat.seatNumber}`}
              </button>
            ))}
          </div>
        )}

        {/* Items list */}
        <div className="flex-1 overflow-y-auto p-4">
          {orderItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p>No items yet</p>
              <p className="text-sm mt-1">Tap menu items to add</p>
            </div>
          ) : (
            <div className="space-y-4">
              {itemsBySeat.map((group, groupIdx) => (
                <div key={groupIdx}>
                  {itemsBySeat.length > 1 && (
                    <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                      {group.label}
                    </h3>
                  )}
                  <div className="space-y-2">
                    {group.items.map(item => (
                      <div
                        key={item.id}
                        className={`p-3 rounded-lg ${
                          item.sentToKitchen
                            ? 'bg-slate-700/50 border border-slate-600'
                            : 'bg-slate-700 border border-slate-600'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white">
                                {item.quantity}x {item.name}
                              </span>
                              {item.sentToKitchen && (
                                <span className="px-1.5 py-0.5 bg-emerald-600/20 text-emerald-400 text-[10px] rounded">
                                  SENT
                                </span>
                              )}
                              {item.isHeld && (
                                <span className="px-1.5 py-0.5 bg-amber-600/20 text-amber-400 text-[10px] rounded">
                                  HELD
                                </span>
                              )}
                            </div>
                            {item.modifiers.length > 0 && (
                              <div className="mt-1 text-xs text-slate-400">
                                {item.modifiers.map(m => m.name).join(', ')}
                              </div>
                            )}
                            {item.specialNotes && (
                              <div className="mt-1 text-xs text-amber-400 italic">
                                {item.specialNotes}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-300">
                              {formatCurrency(
                                (item.price + item.modifiers.reduce((s, m) => s + m.price, 0)) * item.quantity
                              )}
                            </span>
                            {!item.sentToKitchen && (
                              <button
                                onClick={() => handleRemoveItem(item.id)}
                                className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with totals and actions */}
        <div className="p-4 border-t border-slate-700 bg-slate-800/95 backdrop-blur-sm">
          {/* Subtotal */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-300">
              Subtotal ({itemCount} item{itemCount !== 1 ? 's' : ''})
            </span>
            <span className="text-xl font-bold text-white">
              {formatCurrency(subtotal)}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSendToKitchen}
              disabled={unsavedCount === 0}
              className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                unsavedCount > 0
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              {unsavedCount > 0 ? `Send (${unsavedCount})` : 'Send'}
            </button>
            <button
              onClick={handlePay}
              disabled={!activeOrder?.id || itemCount === 0}
              className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                activeOrder?.id && itemCount > 0
                  ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              Pay
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
