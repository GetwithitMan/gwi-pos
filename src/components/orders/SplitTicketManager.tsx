'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { useSplitTickets } from '@/hooks/useSplitTickets'
import { SplitTicketCard, NewTicketCard } from './SplitTicketCard'
import type { OrderItemInput, RoundingIncrement } from '@/lib/split-pricing'

interface OrderItem {
  id: string
  tempId: string
  name: string
  price: number
  quantity: number
  modifiers: { name: string; price: number }[]
  itemDiscount?: number
}

interface SplitTicketManagerProps {
  isOpen: boolean
  onClose: () => void
  orderId: string
  orderNumber: string | number
  items: OrderItem[]
  orderDiscount: number
  taxRate: number
  roundTo?: RoundingIncrement
  onSplitComplete: (splits: Array<{ ticketIndex: number; itemIds: string[] }>) => void
}

export function SplitTicketManager({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  items,
  orderDiscount,
  taxRate,
  roundTo = '0.05',
  onSplitComplete,
}: SplitTicketManagerProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Convert items to OrderItemInput format
  const orderItems: OrderItemInput[] = items.map(item => ({
    id: item.tempId || item.id,
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    modifiers: item.modifiers,
    itemDiscount: item.itemDiscount,
  }))

  const baseOrderNumber = String(orderNumber)

  const {
    tickets,
    selectedItemIds,
    activeTicketId,
    toggleItemSelection,
    selectAllItems,
    clearSelection,
    createNewTicket,
    deleteTicket,
    moveSelectedItems,
    moveItem,
    setActiveTicket,
    canSave,
    totalAfterSplit,
    originalTotal,
    balanceCorrect,
    getAssignments,
    reset,
  } = useSplitTickets({
    baseOrderNumber,
    items: orderItems,
    orderDiscount,
    taxRate,
    roundTo,
  })

  if (!isOpen) return null

  const handleSave = async () => {
    if (!canSave) return

    setIsSaving(true)
    setError(null)

    try {
      const assignments = getAssignments()

      // Call API to create split tickets
      const response = await fetch(`/api/orders/${orderId}/split-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create split tickets')
      }

      onSplitComplete(assignments)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleMoveSelected = (toTicketId: string) => {
    if (selectedItemIds.size === 0) return
    moveSelectedItems(toTicketId)
    setActiveTicket(null)
  }

  const handleCancel = () => {
    reset()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div>
          <h1 className="text-xl font-bold">Split Ticket #{orderNumber}</h1>
          <p className="text-sm text-gray-500">
            Select items and move them between tickets
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm text-gray-500">Original Total</div>
            <div className="font-bold">{formatCurrency(originalTotal)}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-500">Split Total</div>
            <div className={`font-bold ${balanceCorrect ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(totalAfterSplit)}
            </div>
          </div>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          {activeTicketId ? (
            <span className="text-sm font-medium text-blue-600">
              Tap items to move them to {tickets.find(t => t.id === activeTicketId)?.displayNumber}
            </span>
          ) : (
            <span className="text-sm text-gray-600">
              {selectedItemIds.size > 0 ? (
                <span className="font-medium">{selectedItemIds.size} item{selectedItemIds.size > 1 ? 's' : ''} selected</span>
              ) : (
                'Tap a ticket to select it as destination, then tap items to move'
              )}
            </span>
          )}
          {(selectedItemIds.size > 0 || activeTicketId) && (
            <Button variant="ghost" size="sm" onClick={() => { clearSelection(); setActiveTicket(null); }}>
              Clear
            </Button>
          )}
        </div>

        {selectedItemIds.size > 0 && !activeTicketId && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 mr-2">Move to:</span>
            {tickets.map(ticket => (
              <Button
                key={ticket.id}
                variant="outline"
                size="sm"
                onClick={() => handleMoveSelected(ticket.id)}
                className="min-w-[80px]"
              >
                {ticket.displayNumber}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Ticket Grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 auto-rows-fr">
          {tickets.map(ticket => (
            <SplitTicketCard
              key={ticket.id}
              ticketId={ticket.id}
              displayNumber={ticket.displayNumber}
              items={ticket.items}
              pricing={ticket.pricing}
              selectedItemIds={selectedItemIds}
              isActive={activeTicketId === ticket.id}
              isDropTarget={activeTicketId !== null && activeTicketId !== ticket.id}
              canDelete={tickets.length > 1}
              onItemToggle={toggleItemSelection}
              onItemMove={activeTicketId ? (itemId) => moveItem(itemId, activeTicketId) : undefined}
              onSelectAll={() => selectAllItems(ticket.id)}
              onCardClick={() => setActiveTicket(ticket.id === activeTicketId ? null : ticket.id)}
              onDelete={() => deleteTicket(ticket.id)}
            />
          ))}
          <NewTicketCard onClick={createNewTicket} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
        <div className="text-sm text-gray-500">
          {tickets.filter(t => t.items.length > 0).length} ticket{tickets.filter(t => t.items.length > 0).length !== 1 ? 's' : ''} with items
          {!canSave && tickets.filter(t => t.items.length > 0).length < 2 && (
            <span className="text-amber-600 ml-2">
              (Need at least 2 tickets with items to save)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave || isSaving}
            className="min-w-[150px]"
          >
            {isSaving ? 'Saving...' : 'Save & Create Tickets'}
          </Button>
        </div>
      </div>
    </div>
  )
}
