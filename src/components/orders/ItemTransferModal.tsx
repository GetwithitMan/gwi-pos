'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface OrderItem {
  id: string
  tempId: string
  name: string
  price: number
  quantity: number
  modifiers: { name: string; price: number }[]
  sent?: boolean
  status?: string
}

interface TargetOrder {
  id: string
  orderNumber: number
  orderType: string
  tabName: string | null
  tableNumber: string | null
  total: number
  itemCount: number
  employeeName: string
}

interface ItemTransferModalProps {
  isOpen: boolean
  onClose: () => void
  currentOrderId: string
  items: OrderItem[]
  locationId: string
  employeeId: string
  onTransferComplete: (transferredItemIds: string[]) => void
}

export function ItemTransferModal({
  isOpen,
  onClose,
  currentOrderId,
  items,
  locationId,
  employeeId,
  onTransferComplete,
}: ItemTransferModalProps) {
  const [step, setStep] = useState<'select-items' | 'select-order'>('select-items')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [targetOrders, setTargetOrders] = useState<TargetOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setStep('select-items')
      setSelectedItemIds([])
      setSelectedOrderId(null)
      setError(null)
    }
  }, [isOpen])

  const loadTargetOrders = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ locationId })
      const response = await fetch(`/api/orders/${currentOrderId}/transfer-items?${params}`)

      if (response.ok) {
        const raw = await response.json()
        const data = raw.data ?? raw
        setTargetOrders(data.orders || [])
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to load orders')
      }
    } catch (err) {
      console.error('Failed to load target orders:', err)
      setError('Failed to load orders')
    } finally {
      setIsLoading(false)
    }
  }

  const transferableItems = items.filter(
    (item) => item.status !== 'comped' && item.status !== 'voided'
  )

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    )
  }

  const selectAllItems = () => {
    if (selectedItemIds.length === transferableItems.length) {
      setSelectedItemIds([])
    } else {
      setSelectedItemIds(transferableItems.map((item) => item.id))
    }
  }

  const handleContinue = async () => {
    if (selectedItemIds.length === 0) {
      setError('Please select at least one item')
      return
    }
    await loadTargetOrders()
    setStep('select-order')
  }

  const handleBack = () => {
    setStep('select-items')
    setSelectedOrderId(null)
    setError(null)
  }

  const handleTransfer = async () => {
    if (!selectedOrderId || selectedItemIds.length === 0) {
      setError('Please select a destination order')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/orders/${currentOrderId}/transfer-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toOrderId: selectedOrderId,
          itemIds: selectedItemIds,
          employeeId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to transfer items')
      }

      onTransferComplete(selectedItemIds)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transfer items')
    } finally {
      setIsProcessing(false)
    }
  }

  const calculateItemTotal = (item: OrderItem) => {
    const basePrice = item.price * item.quantity
    const modifiersPrice = item.modifiers.reduce((sum, mod) => sum + mod.price, 0)
    return basePrice + modifiersPrice
  }

  const selectedTotal = transferableItems
    .filter((item) => selectedItemIds.includes(item.id))
    .reduce((sum, item) => sum + calculateItemTotal(item), 0)

  const getOrderLabel = (order: TargetOrder) => {
    if (order.orderType === 'bar_tab' && order.tabName) {
      return `${order.tabName} (Tab #${order.orderNumber})`
    }
    if (order.tableNumber) {
      return `Table ${order.tableNumber} (#${order.orderNumber})`
    }
    return `Order #${order.orderNumber}`
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" variant="default">
      <div className="bg-white rounded-lg shadow-xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Transfer Items</h2>
            <p className="text-sm text-gray-500">
              {step === 'select-items'
                ? 'Select items to transfer'
                : 'Select destination order'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {step === 'select-items' ? (
            <>
              {/* Select All */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b">
                <button
                  onClick={selectAllItems}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  {selectedItemIds.length === transferableItems.length
                    ? 'Deselect All'
                    : 'Select All'}
                </button>
                <span className="text-sm text-gray-500">
                  {selectedItemIds.length} of {transferableItems.length} selected
                </span>
              </div>

              {/* Items List */}
              {transferableItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No items available to transfer.
                </div>
              ) : (
                <div className="space-y-2">
                  {transferableItems.map((item) => (
                    <Card
                      key={item.id}
                      className={`p-3 cursor-pointer transition-colors ${
                        selectedItemIds.includes(item.id)
                          ? 'bg-blue-50 border-blue-500'
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => toggleItem(item.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center ${
                              selectedItemIds.includes(item.id)
                                ? 'bg-blue-600 border-blue-600'
                                : 'border-gray-300'
                            }`}
                          >
                            {selectedItemIds.includes(item.id) && (
                              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <div className="font-medium">
                              {item.quantity}x {item.name}
                            </div>
                            {item.modifiers.length > 0 && (
                              <div className="text-sm text-gray-500">
                                {item.modifiers.map((mod) => mod.name).join(', ')}
                              </div>
                            )}
                            {item.sent && (
                              <span className="text-xs text-green-600">Sent to kitchen</span>
                            )}
                          </div>
                        </div>
                        <span className="font-medium">
                          {formatCurrency(calculateItemTotal(item))}
                        </span>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Selected Total */}
              {selectedItemIds.length > 0 && (
                <div className="mt-4 pt-4 border-t flex justify-between font-bold">
                  <span>Transfer Total</span>
                  <span>{formatCurrency(selectedTotal)}</span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Target Orders */}
              {isLoading ? (
                <div className="text-center py-8 text-gray-500">Loading orders...</div>
              ) : targetOrders.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No other open orders available.</p>
                  <p className="text-sm mt-2">Create a new order first to transfer items to it.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {targetOrders.map((order) => (
                    <Card
                      key={order.id}
                      className={`p-3 cursor-pointer transition-colors ${
                        selectedOrderId === order.id
                          ? 'bg-blue-50 border-blue-500'
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedOrderId(order.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                              selectedOrderId === order.id
                                ? 'bg-blue-600 border-blue-600'
                                : 'border-gray-300'
                            }`}
                          >
                            {selectedOrderId === order.id && (
                              <div className="w-2 h-2 rounded-full bg-white" />
                            )}
                          </div>
                          <div>
                            <div className="font-medium">{getOrderLabel(order)}</div>
                            <div className="text-sm text-gray-500">
                              {order.itemCount} item{order.itemCount !== 1 ? 's' : ''} • {order.employeeName}
                            </div>
                          </div>
                        </div>
                        <span className="font-medium">
                          {formatCurrency(order.total)}
                        </span>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Transfer Summary */}
              {selectedOrderId && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-sm text-gray-600">
                    Transferring {selectedItemIds.length} item{selectedItemIds.length !== 1 ? 's' : ''} ({formatCurrency(selectedTotal)})
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex gap-2">
          {step === 'select-items' ? (
            <>
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleContinue}
                disabled={selectedItemIds.length === 0}
              >
                Continue ({selectedItemIds.length})
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="flex-1" onClick={handleBack}>
                Back
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleTransfer}
                disabled={isProcessing || !selectedOrderId}
              >
                {isProcessing ? 'Transferring...' : 'Transfer Items'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
