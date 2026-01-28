'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface OrderItem {
  id: string
  name: string
  quantity: number
  price: number
  itemTotal: number
  modifiers?: { name: string; price: number }[]
}

interface SplitCheckModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string
  orderNumber: number
  orderTotal: number
  paidAmount: number
  items: OrderItem[]
  onSplitComplete: (result: SplitResult) => void
  onNavigateToSplit?: (splitOrderId: string) => void
}

interface SplitResult {
  type: 'even' | 'by_item' | 'custom_amount' | 'split_item'
  originalOrderId: string
  // For even split
  splits?: { splitNumber: number; amount: number }[]
  // For by_item split
  newOrderId?: string
  newOrderNumber?: number
  // For custom amount
  splitAmount?: number
  // For split item
  itemSplits?: { itemId: string; itemName: string; splitNumber: number; amount: number }[]
}

type SplitMode = 'select' | 'even' | 'by_item' | 'custom' | 'split_item' | 'navigate_splits'

interface SplitOrderInfo {
  id: string
  orderNumber: number
  splitIndex: number | null
  displayNumber: string
  total: number
  paidAmount: number
  isPaid: boolean
  itemCount: number
  isParent: boolean
}

export function SplitCheckModal({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  orderTotal,
  paidAmount,
  items,
  onSplitComplete,
  onNavigateToSplit,
}: SplitCheckModalProps) {
  const [mode, setMode] = useState<SplitMode>('select')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Split navigation state
  const [existingSplits, setExistingSplits] = useState<SplitOrderInfo[]>([])
  const [currentSplitId, setCurrentSplitId] = useState<string | null>(null)

  // Even split state
  const [numWays, setNumWays] = useState(2)
  const [evenSplitResult, setEvenSplitResult] = useState<{ splits: { splitNumber: number; amount: number }[] } | null>(null)

  // By item split state
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])

  // Custom amount state
  const [customAmount, setCustomAmount] = useState('')

  // Split item state
  const [selectedItemForSplit, setSelectedItemForSplit] = useState<OrderItem | null>(null)
  const [itemSplitWays, setItemSplitWays] = useState(2)
  const [itemSplitResult, setItemSplitResult] = useState<{ itemId: string; itemName: string; splits: { splitNumber: number; amount: number }[] } | null>(null)

  const remainingBalance = orderTotal - paidAmount

  // Fetch existing splits
  const fetchExistingSplits = async () => {
    try {
      const response = await fetch(`/api/orders/${orderId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'get_splits' }),
      })
      if (response.ok) {
        const data = await response.json()
        if (data.splits && data.splits.length > 1) {
          setExistingSplits(data.splits)
          setCurrentSplitId(data.currentSplitId)
          setMode('navigate_splits')
          return true
        }
      }
    } catch {
      // Ignore errors, just use normal split flow
    }
    return false
  }

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode('select')
      setNumWays(2)
      setEvenSplitResult(null)
      setSelectedItemIds([])
      setCustomAmount('')
      setSelectedItemForSplit(null)
      setItemSplitWays(2)
      setItemSplitResult(null)
      setError(null)
      setExistingSplits([])
      setCurrentSplitId(null)
      // Check if order already has splits
      fetchExistingSplits()
    }
  }, [isOpen, orderId])

  if (!isOpen) return null

  const handleEvenSplit = async () => {
    if (numWays < 2) return

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/orders/${orderId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'even',
          numWays,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to calculate split')
      }

      const result = await response.json()
      setEvenSplitResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate split')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleConfirmEvenSplit = () => {
    if (!evenSplitResult) return
    onSplitComplete({
      type: 'even',
      originalOrderId: orderId,
      splits: evenSplitResult.splits,
    })
  }

  const handleByItemSplit = async () => {
    if (selectedItemIds.length === 0) {
      setError('Please select at least one item')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/orders/${orderId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'by_item',
          itemIds: selectedItemIds,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to split order')
      }

      const result = await response.json()
      onSplitComplete({
        type: 'by_item',
        originalOrderId: orderId,
        newOrderId: result.newOrder.id,
        newOrderNumber: result.newOrder.orderNumber,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to split order')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCustomAmount = async () => {
    const amount = parseFloat(customAmount)
    if (!amount || amount <= 0 || amount > remainingBalance) {
      setError(`Please enter a valid amount between $0.01 and ${formatCurrency(remainingBalance)}`)
      return
    }

    onSplitComplete({
      type: 'custom_amount',
      originalOrderId: orderId,
      splitAmount: amount,
    })
  }

  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    )
  }

  const calculateSelectedTotal = () => {
    return items
      .filter(item => selectedItemIds.includes(item.id))
      .reduce((sum, item) => sum + item.itemTotal, 0)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Split Check</h2>
            <p className="text-sm text-gray-500">Order #{orderNumber}</p>
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

          {/* Order Summary */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex justify-between text-sm">
              <span>Order Total</span>
              <span className="font-medium">{formatCurrency(orderTotal)}</span>
            </div>
            {paidAmount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Already Paid</span>
                <span>-{formatCurrency(paidAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold mt-2 pt-2 border-t">
              <span>Remaining</span>
              <span>{formatCurrency(remainingBalance)}</span>
            </div>
          </div>

          {/* Mode Selection */}
          {mode === 'select' && (
            <div className="space-y-3">
              <h3 className="font-medium mb-2">How would you like to split?</h3>

              <Button
                variant="outline"
                className="w-full h-16 text-lg justify-start gap-4"
                onClick={() => setMode('even')}
              >
                <span className="text-2xl">➗</span>
                <div className="text-left">
                  <div>Split Evenly</div>
                  <div className="text-sm text-gray-500 font-normal">
                    Divide the check equally among guests
                  </div>
                </div>
              </Button>

              <Button
                variant="outline"
                className="w-full h-16 text-lg justify-start gap-4"
                onClick={() => setMode('by_item')}
              >
                <span className="text-2xl">📋</span>
                <div className="text-left">
                  <div>Split by Item</div>
                  <div className="text-sm text-gray-500 font-normal">
                    Move specific items to a new check
                  </div>
                </div>
              </Button>

              <Button
                variant="outline"
                className="w-full h-16 text-lg justify-start gap-4"
                onClick={() => setMode('split_item')}
              >
                <span className="text-2xl">🍕</span>
                <div className="text-left">
                  <div>Split Single Item</div>
                  <div className="text-sm text-gray-500 font-normal">
                    Divide one item&apos;s cost among guests
                  </div>
                </div>
              </Button>

              <Button
                variant="outline"
                className="w-full h-16 text-lg justify-start gap-4"
                onClick={() => setMode('custom')}
              >
                <span className="text-2xl">💰</span>
                <div className="text-left">
                  <div>Pay Custom Amount</div>
                  <div className="text-sm text-gray-500 font-normal">
                    Pay a specific dollar amount
                  </div>
                </div>
              </Button>
            </div>
          )}

          {/* Navigate Splits Mode - Shows when order already has splits */}
          {mode === 'navigate_splits' && (
            <div className="space-y-4">
              <h3 className="font-medium">Order Has Been Split</h3>
              <p className="text-sm text-gray-500">
                This order has {existingSplits.length} split checks. Select one to view or pay.
              </p>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {existingSplits.map((split) => (
                  <Card
                    key={split.id}
                    className={`p-3 cursor-pointer transition-colors ${
                      split.id === currentSplitId
                        ? 'bg-blue-50 border-blue-500'
                        : split.isPaid
                        ? 'bg-green-50 border-green-300'
                        : 'hover:bg-gray-50'
                    }`}
                    onClick={() => {
                      if (onNavigateToSplit && split.id !== currentSplitId) {
                        onNavigateToSplit(split.id)
                        onClose()
                      }
                    }}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          <span>Check #{split.displayNumber}</span>
                          {split.isParent && (
                            <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">Original</span>
                          )}
                          {split.id === currentSplitId && (
                            <span className="text-xs bg-blue-200 text-blue-700 px-2 py-0.5 rounded">Current</span>
                          )}
                          {split.isPaid && (
                            <span className="text-xs bg-green-200 text-green-700 px-2 py-0.5 rounded">Paid</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500">
                          {split.itemCount > 0 ? `${split.itemCount} items` : 'Split portion'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold">{formatCurrency(split.total)}</div>
                        {split.paidAmount > 0 && !split.isPaid && (
                          <div className="text-sm text-green-600">
                            {formatCurrency(split.paidAmount)} paid
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span>Total Paid:</span>
                  <span className="font-medium text-green-600">
                    {formatCurrency(existingSplits.reduce((sum, s) => sum + s.paidAmount, 0))}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Total Remaining:</span>
                  <span className="font-medium">
                    {formatCurrency(existingSplits.reduce((sum, s) => sum + (s.total - s.paidAmount), 0))}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={onClose}
                >
                  Close
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setExistingSplits([])
                    setMode('select')
                  }}
                >
                  Split Further
                </Button>
              </div>
            </div>
          )}

          {/* Even Split Mode */}
          {mode === 'even' && (
            <div className="space-y-4">
              <h3 className="font-medium">Split Evenly</h3>

              {!evenSplitResult ? (
                <>
                  <div>
                    <label className="text-sm text-gray-600 block mb-2">
                      How many ways to split?
                    </label>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setNumWays(Math.max(2, numWays - 1))}
                        disabled={numWays <= 2}
                      >
                        -
                      </Button>
                      <span className="text-2xl font-bold w-12 text-center">{numWays}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setNumWays(numWays + 1)}
                      >
                        +
                      </Button>
                    </div>
                  </div>

                  <div className="p-3 bg-blue-50 rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span>Each person pays approximately:</span>
                      <span className="font-bold">
                        {formatCurrency(remainingBalance / numWays)}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setMode('select')}
                    >
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={handleEvenSplit}
                      disabled={isProcessing}
                    >
                      {isProcessing ? 'Calculating...' : 'Calculate Split'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    {evenSplitResult.splits.map((split, idx) => (
                      <Card key={idx} className="p-3">
                        <div className="flex justify-between items-center">
                          <span className="font-medium">Guest {split.splitNumber}</span>
                          <span className="text-lg font-bold">{formatCurrency(split.amount)}</span>
                        </div>
                      </Card>
                    ))}
                  </div>

                  <p className="text-sm text-gray-500 text-center">
                    Click &quot;Confirm&quot; to use these amounts for separate payments
                  </p>

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setEvenSplitResult(null)}
                    >
                      Recalculate
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={handleConfirmEvenSplit}
                    >
                      Confirm Split
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* By Item Mode */}
          {mode === 'by_item' && (
            <div className="space-y-4">
              <h3 className="font-medium">Select Items to Move</h3>
              <p className="text-sm text-gray-500">
                Selected items will be moved to a new check
              </p>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {items.map(item => (
                  <Card
                    key={item.id}
                    className={`p-3 cursor-pointer transition-colors ${
                      selectedItemIds.includes(item.id)
                        ? 'bg-blue-50 border-blue-500'
                        : 'hover:bg-gray-50'
                    }`}
                    onClick={() => toggleItemSelection(item.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        selectedItemIds.includes(item.id)
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-gray-300'
                      }`}>
                        {selectedItemIds.includes(item.id) && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between">
                          <span className="font-medium">
                            {item.quantity > 1 && `${item.quantity}x `}{item.name}
                          </span>
                          <span>{formatCurrency(item.itemTotal)}</span>
                        </div>
                        {item.modifiers && item.modifiers.length > 0 && (
                          <div className="text-sm text-gray-500">
                            {item.modifiers.map(m => m.name).join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {selectedItemIds.length > 0 && (
                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="flex justify-between font-medium">
                    <span>Selected Items Total:</span>
                    <span>{formatCurrency(calculateSelectedTotal())}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setMode('select')
                    setSelectedItemIds([])
                  }}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleByItemSplit}
                  disabled={isProcessing || selectedItemIds.length === 0}
                >
                  {isProcessing ? 'Splitting...' : `Create New Check (${selectedItemIds.length})`}
                </Button>
              </div>
            </div>
          )}

          {/* Custom Amount Mode */}
          {mode === 'custom' && (
            <div className="space-y-4">
              <h3 className="font-medium">Pay Custom Amount</h3>
              <p className="text-sm text-gray-500">
                Enter the amount this guest wants to pay
              </p>

              <div>
                <label className="text-sm text-gray-600 block mb-2">
                  Amount to pay (max {formatCurrency(remainingBalance)})
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-gray-500 text-lg">$</span>
                  <input
                    type="number"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 text-xl border rounded-lg"
                    placeholder="0.00"
                    step="0.01"
                    min="0.01"
                    max={remainingBalance}
                  />
                </div>
              </div>

              {customAmount && parseFloat(customAmount) > 0 && (
                <div className="p-3 bg-blue-50 rounded-lg space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>This guest pays:</span>
                    <span className="font-medium">{formatCurrency(parseFloat(customAmount) || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Remaining after:</span>
                    <span className="font-medium">
                      {formatCurrency(Math.max(0, remainingBalance - (parseFloat(customAmount) || 0)))}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setMode('select')
                    setCustomAmount('')
                  }}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleCustomAmount}
                  disabled={!customAmount || parseFloat(customAmount) <= 0}
                >
                  Pay {customAmount ? formatCurrency(parseFloat(customAmount)) : '$0.00'}
                </Button>
              </div>
            </div>
          )}

          {/* Split Item Mode */}
          {mode === 'split_item' && (
            <div className="space-y-4">
              <h3 className="font-medium">Split Single Item</h3>

              {!selectedItemForSplit ? (
                <>
                  <p className="text-sm text-gray-500">
                    Select an item to split among guests
                  </p>

                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {items.map(item => (
                      <Card
                        key={item.id}
                        className="p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => setSelectedItemForSplit(item)}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="font-medium">
                              {item.quantity > 1 && `${item.quantity}x `}{item.name}
                            </span>
                            {item.modifiers && item.modifiers.length > 0 && (
                              <div className="text-sm text-gray-500">
                                {item.modifiers.map(m => m.name).join(', ')}
                              </div>
                            )}
                          </div>
                          <span className="font-medium">{formatCurrency(item.itemTotal)}</span>
                        </div>
                      </Card>
                    ))}
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setMode('select')}
                    >
                      Back
                    </Button>
                  </div>
                </>
              ) : !itemSplitResult ? (
                <>
                  <div className="p-3 bg-gray-50 rounded-lg mb-4">
                    <div className="flex justify-between">
                      <span className="font-medium">{selectedItemForSplit.name}</span>
                      <span>{formatCurrency(selectedItemForSplit.itemTotal)}</span>
                    </div>
                    {selectedItemForSplit.modifiers && selectedItemForSplit.modifiers.length > 0 && (
                      <div className="text-sm text-gray-500">
                        {selectedItemForSplit.modifiers.map(m => m.name).join(', ')}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-sm text-gray-600 block mb-2">
                      How many ways to split this item?
                    </label>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setItemSplitWays(Math.max(2, itemSplitWays - 1))}
                        disabled={itemSplitWays <= 2}
                      >
                        -
                      </Button>
                      <span className="text-2xl font-bold w-12 text-center">{itemSplitWays}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setItemSplitWays(itemSplitWays + 1)}
                      >
                        +
                      </Button>
                    </div>
                  </div>

                  <div className="p-3 bg-blue-50 rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span>Each person pays:</span>
                      <span className="font-bold">
                        {formatCurrency(selectedItemForSplit.itemTotal / itemSplitWays)}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setSelectedItemForSplit(null)
                        setItemSplitWays(2)
                      }}
                    >
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={() => {
                        // Calculate the splits with proper rounding
                        const baseAmount = Math.floor((selectedItemForSplit.itemTotal / itemSplitWays) * 100) / 100
                        const splits: { splitNumber: number; amount: number }[] = []
                        let remaining = selectedItemForSplit.itemTotal

                        for (let i = 1; i <= itemSplitWays; i++) {
                          if (i === itemSplitWays) {
                            // Last person pays the remainder
                            splits.push({ splitNumber: i, amount: Math.round(remaining * 100) / 100 })
                          } else {
                            splits.push({ splitNumber: i, amount: baseAmount })
                            remaining -= baseAmount
                          }
                        }

                        setItemSplitResult({
                          itemId: selectedItemForSplit.id,
                          itemName: selectedItemForSplit.name,
                          splits,
                        })
                      }}
                    >
                      Calculate Split
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 bg-gray-50 rounded-lg mb-4">
                    <p className="text-sm text-gray-600">Splitting: <span className="font-medium">{itemSplitResult.itemName}</span></p>
                  </div>

                  <div className="space-y-2">
                    {itemSplitResult.splits.map((split, idx) => (
                      <Card key={idx} className="p-3">
                        <div className="flex justify-between items-center">
                          <span className="font-medium">Guest {split.splitNumber}</span>
                          <span className="text-lg font-bold">{formatCurrency(split.amount)}</span>
                        </div>
                      </Card>
                    ))}
                  </div>

                  <p className="text-sm text-gray-500 text-center">
                    Click &quot;Confirm&quot; to collect payments sequentially
                  </p>

                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setItemSplitResult(null)
                        setItemSplitWays(2)
                      }}
                    >
                      Recalculate
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={() => {
                        onSplitComplete({
                          type: 'split_item',
                          originalOrderId: orderId,
                          itemSplits: [{
                            itemId: itemSplitResult.itemId,
                            itemName: itemSplitResult.itemName,
                            ...itemSplitResult.splits[0],
                          }],
                          splits: itemSplitResult.splits,
                        })
                      }}
                    >
                      Confirm Split
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <Button variant="outline" className="w-full" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
