'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { EntertainmentItem, WaitlistEntry } from '@/lib/entertainment'

interface SeatFromWaitlistModalProps {
  isOpen: boolean
  onClose: () => void
  entry: WaitlistEntry | null
  entertainmentItems: EntertainmentItem[]
  locationId: string
  employeeId?: string
  onSuccess?: () => void
}

export function SeatFromWaitlistModal({
  isOpen,
  onClose,
  entry,
  entertainmentItems,
  locationId,
  employeeId,
  onSuccess,
}: SeatFromWaitlistModalProps) {
  const [step, setStep] = useState<'select-item' | 'confirm-end' | 'processing'>('select-item')
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Find the item the customer is waiting for
  const waitingForItem = entertainmentItems.find(i => i.id === entry?.menuItemId)

  // Get available items
  const availableItems = entertainmentItems.filter(i => i.status === 'available')

  // Get the selected item details
  const selectedItem = entertainmentItems.find(i => i.id === selectedItemId)
  const selectedItemInUse = selectedItem?.status === 'in_use'

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && entry) {
      setStep('select-item')
      setError(null)

      // Default selection: first available item, or the one they requested
      const itemTheyWant = entertainmentItems.find(i => i.id === entry.menuItemId)
      const available = entertainmentItems.filter(i => i.status === 'available')

      if (itemTheyWant?.status === 'available') {
        setSelectedItemId(itemTheyWant.id)
      } else if (available.length > 0) {
        setSelectedItemId(available[0].id)
      } else {
        // Default to what they requested even if in use
        setSelectedItemId(entry.menuItemId || '')
      }
    }
  }, [isOpen, entry, entertainmentItems])

  if (!isOpen || !entry) return null

  // Called when user selects an item and clicks continue
  const handleItemSelected = () => {
    if (selectedItemInUse) {
      // Need to end current session first
      setStep('confirm-end')
    } else {
      // Item is available, proceed to seat
      handleSeatCustomer()
    }
  }

  // End the current session on the selected item
  const handleConfirmEndSession = async () => {
    if (!selectedItem || !selectedItemInUse) return

    setIsProcessing(true)
    setError(null)

    try {
      // End the current session on this item
      const response = await fetch('/api/entertainment/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuItemId: selectedItem.id,
          status: 'available',
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to end session')
      }

      // Now seat the customer
      await handleSeatCustomer()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end session')
      setIsProcessing(false)
    }
  }

  const handleSeatCustomer = async () => {
    if (!selectedItemId) {
      setError('Please select an entertainment item')
      return
    }

    setIsProcessing(true)
    setError(null)
    setStep('processing')

    try {
      // Get the selected entertainment item details
      const selectedItem = entertainmentItems.find(i => i.id === selectedItemId)
      if (!selectedItem) {
        throw new Error('Selected entertainment item not found')
      }

      // Build the entertainment item for the order
      const entertainmentOrderItem = {
        menuItemId: selectedItem.id,
        name: selectedItem.displayName || selectedItem.name,
        price: selectedItem.price || 0,
        quantity: 1,
        modifiers: [],
      }

      let tabId = entry.tabId

      // If customer already has a tab, add the item to it
      if (tabId) {
        // Fetch the existing order
        const orderResponse = await fetch(`/api/orders/${tabId}`)

        if (orderResponse.ok) {
          const orderData = await orderResponse.json()

          // Map existing items
          const existingItems = Array.isArray(orderData.items) ? orderData.items : []
          const mappedExistingItems = existingItems.map((item: { menuItemId: string; name: string; price: number; quantity: number; specialNotes?: string; modifiers?: { modifierId: string; name: string; price: number; preModifier?: string }[] }) => ({
            menuItemId: item.menuItemId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            specialNotes: item.specialNotes,
            modifiers: (item.modifiers || []).map((m: { modifierId: string; name: string; price: number; preModifier?: string }) => ({
              modifierId: m.modifierId,
              name: m.name,
              price: m.price,
              preModifier: m.preModifier,
            })),
          }))

          // Add the entertainment item
          const allItems = [...mappedExistingItems, entertainmentOrderItem]

          // Update the order
          const updateResponse = await fetch(`/api/orders/${tabId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: allItems }),
          })

          if (!updateResponse.ok) {
            const data = await updateResponse.json()
            throw new Error(data.error || 'Failed to add item to order')
          }
        } else {
          // Order not found, will create new one below
          tabId = null
        }
      }

      // If no valid tab, create a new one WITH the entertainment item included
      if (!tabId) {
        const tabName = entry.tabName || entry.customerName || 'Guest'

        const tabResponse = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            employeeId,
            orderType: 'bar_tab',
            tabName,
            guestCount: entry.partySize || 1,
            items: [entertainmentOrderItem], // Include item when creating order
          }),
        })

        if (!tabResponse.ok) {
          const data = await tabResponse.json()
          throw new Error(data.error || 'Failed to create tab')
        }

        const tabData = await tabResponse.json()
        tabId = tabData.id // Response returns id directly, not order.id

        if (!tabId) {
          throw new Error('Failed to get new tab ID')
        }
      }

      // Find the entertainment order item ID from the order
      // We need to fetch the order to get the item ID that was just added
      let currentOrderItemId: string | null = null
      try {
        const orderResponse = await fetch(`/api/orders/${tabId}`)
        if (orderResponse.ok) {
          const orderData = await orderResponse.json()
          // Find the item that matches our entertainment item
          const entertainmentItem = orderData.items?.find(
            (item: { menuItemId: string }) => item.menuItemId === selectedItemId
          )
          if (entertainmentItem) {
            currentOrderItemId = entertainmentItem.id
          }
        }
      } catch (err) {
        console.error('Failed to get order item ID:', err)
      }

      // Start the block time on the order item
      // Use the entertainment item's default block time or 60 minutes
      const blockMinutes = selectedItem.blockTimeMinutes || 60
      if (currentOrderItemId) {
        try {
          await fetch('/api/entertainment/block-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderItemId: currentOrderItemId,
              minutes: blockMinutes,
            }),
          })
        } catch (err) {
          console.error('Failed to start block time:', err)
        }
      }

      // Mark the entertainment item as in_use (block-time POST already does this, but ensure it's set)
      await fetch('/api/entertainment/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuItemId: selectedItemId,
          status: 'in_use',
          currentOrderId: tabId,
          currentOrderItemId,
        }),
      })

      // Update waitlist entry status to 'seated'
      const waitlistResponse = await fetch(`/api/entertainment/waitlist/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'seated' }),
      })

      if (!waitlistResponse.ok) {
        console.error('Failed to update waitlist status')
      }

      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seat customer')
      setStep('select-item')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-4 border-b-2 border-green-400 bg-green-500">
          <h2 className="text-xl font-bold text-white">Seat Customer</h2>
          <p className="text-green-100 font-medium">
            {entry.customerName} - Party of {entry.partySize}
          </p>
        </div>

        {/* Content */}
        <div className="p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border-2 border-red-400 rounded-lg text-red-800 font-medium">
              {error}
            </div>
          )}

          {/* Step 1: Select entertainment item */}
          {step === 'select-item' && (
            <div className="space-y-4">
              <h3 className="font-bold text-gray-900 text-lg">Where would you like to seat them?</h3>

              {/* Available items section */}
              {availableItems.length > 0 && (
                <div>
                  <p className="text-sm font-bold text-green-700 mb-2 flex items-center gap-2">
                    <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                    Available Now
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {availableItems.map(item => (
                      <label
                        key={item.id}
                        className={`block p-3 border-2 rounded-lg cursor-pointer transition-all ${
                          selectedItemId === item.id
                            ? 'border-green-500 bg-green-50'
                            : 'border-gray-300 hover:border-green-400'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="item"
                            checked={selectedItemId === item.id}
                            onChange={() => setSelectedItemId(item.id)}
                            className="w-5 h-5 text-green-600"
                          />
                          <span className="font-bold text-gray-900">{item.displayName}</span>
                          {item.id === entry.menuItemId && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-semibold">
                              REQUESTED
                            </span>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* The item they requested (if in use) - show as option to end session */}
              {waitingForItem && waitingForItem.status === 'in_use' && (
                <div>
                  <p className="text-sm font-bold text-red-700 mb-2 flex items-center gap-2">
                    <span className="w-3 h-3 bg-red-500 rounded-full"></span>
                    Currently In Use
                  </p>
                  <label
                    className={`block p-3 border-2 rounded-lg cursor-pointer transition-all ${
                      selectedItemId === waitingForItem.id
                        ? 'border-red-500 bg-red-50'
                        : 'border-gray-300 hover:border-red-400'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="item"
                        checked={selectedItemId === waitingForItem.id}
                        onChange={() => setSelectedItemId(waitingForItem.id)}
                        className="w-5 h-5 text-red-600"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">{waitingForItem.displayName}</span>
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-semibold">
                            REQUESTED
                          </span>
                        </div>
                        <p className="text-sm text-red-600 mt-1">
                          In use by: {waitingForItem.currentOrder?.tabName || 'another customer'}
                        </p>
                      </div>
                    </div>
                  </label>
                  {selectedItemId === waitingForItem.id && (
                    <p className="text-sm text-amber-700 mt-2 font-medium bg-amber-50 p-2 rounded">
                      Selecting this will end the current session
                    </p>
                  )}
                </div>
              )}

              {/* No items available at all */}
              {availableItems.length === 0 && waitingForItem?.status !== 'in_use' && (
                <div className="bg-gray-100 border-2 border-gray-300 rounded-lg p-4 text-center">
                  <p className="text-gray-600 font-medium">No items currently available</p>
                  <p className="text-sm text-gray-500 mt-1">Please wait for an item to become free</p>
                </div>
              )}

              {/* Tab info */}
              <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-3">
                <p className="text-sm font-medium text-blue-900">
                  {entry.tabName ? (
                    <>Adding to tab: <strong>{entry.tabName}</strong></>
                  ) : entry.depositAmount ? (
                    <>Will create new tab with ${entry.depositAmount} deposit</>
                  ) : (
                    <>No tab linked - session will start without a tab</>
                  )}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 border-2"
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold"
                  onClick={handleItemSelected}
                  disabled={!selectedItemId || isProcessing}
                >
                  {selectedItemInUse ? 'Continue' : 'Seat Customer'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Confirm ending current session (only if selected item is in use) */}
          {step === 'confirm-end' && selectedItem && (
            <div className="space-y-4">
              <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4">
                <h3 className="font-bold text-amber-900 mb-2">End Current Session?</h3>
                <p className="text-amber-800">
                  <strong>{selectedItem.displayName}</strong> is currently in use by{' '}
                  <strong>{selectedItem.currentOrder?.tabName || 'another customer'}</strong>.
                </p>
                {selectedItem.timeInfo && (
                  <p className="text-sm text-amber-700 mt-2">
                    Time: {selectedItem.timeInfo.type === 'block'
                      ? `${selectedItem.timeInfo.blockMinutes} min block`
                      : 'Per minute billing'}
                  </p>
                )}
              </div>

              <p className="text-gray-700 font-medium">
                This will end their session and update their tab with the final charges.
              </p>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-2"
                  onClick={() => setStep('select-item')}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold"
                  onClick={handleConfirmEndSession}
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Processing...' : 'End & Seat Customer'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Processing */}
          {step === 'processing' && (
            <div className="text-center py-8">
              <div className="animate-spin w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-700 font-medium">Setting up session...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
