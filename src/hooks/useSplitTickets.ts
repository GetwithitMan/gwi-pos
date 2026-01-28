'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  calculateSplitTicketPricing,
  calculateMultiSplitPricing,
  type OrderItemInput,
  type SplitPricingResult,
  type RoundingIncrement,
} from '@/lib/split-pricing'

// ============================================
// Types
// ============================================

export interface SplitTicket {
  id: string               // Temporary ID for UI
  ticketIndex: number      // 1, 2, 3...
  displayNumber: string    // "30-1", "30-2"...
  itemIds: Set<string>     // Item IDs assigned to this ticket
}

export interface SplitTicketWithPricing extends SplitTicket {
  pricing: SplitPricingResult
  items: OrderItemInput[]
}

interface UseSplitTicketsOptions {
  baseOrderNumber: string
  items: OrderItemInput[]
  orderDiscount: number
  taxRate: number
  roundTo?: RoundingIncrement
}

interface UseSplitTicketsReturn {
  // State
  tickets: SplitTicketWithPricing[]
  selectedItemIds: Set<string>
  activeTicketId: string | null

  // Item selection
  toggleItemSelection: (itemId: string) => void
  selectAllItems: (ticketId: string) => void
  clearSelection: () => void

  // Ticket operations
  createNewTicket: () => string
  deleteTicket: (ticketId: string) => boolean
  moveSelectedItems: (toTicketId: string) => void
  moveItem: (itemId: string, toTicketId: string) => void
  setActiveTicket: (ticketId: string | null) => void

  // Computed
  canSave: boolean
  totalAfterSplit: number
  originalTotal: number
  balanceCorrect: boolean

  // Actions
  getAssignments: () => Array<{ ticketIndex: number; itemIds: string[] }>
  reset: () => void
}

// ============================================
// Hook Implementation
// ============================================

export function useSplitTickets({
  baseOrderNumber,
  items,
  orderDiscount,
  taxRate,
  roundTo = '0.05',
}: UseSplitTicketsOptions): UseSplitTicketsReturn {
  // Initialize with first ticket containing all items
  const [tickets, setTickets] = useState<SplitTicket[]>(() => [{
    id: 'ticket-1',
    ticketIndex: 1,
    displayNumber: `${baseOrderNumber}-1`,
    itemIds: new Set(items.map(i => i.id)),
  }])

  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null)
  const [nextTicketNum, setNextTicketNum] = useState(2)

  // Build item lookup map
  const itemMap = useMemo(() => {
    const map = new Map<string, OrderItemInput>()
    items.forEach(item => map.set(item.id, item))
    return map
  }, [items])

  // Calculate original total
  const originalTotal = useMemo(() => {
    const subtotal = items.reduce((sum, item) => {
      const modTotal = item.modifiers?.reduce((m, mod) => m + mod.price, 0) || 0
      return sum + (item.price + modTotal) * item.quantity
    }, 0)
    const afterDiscount = subtotal - orderDiscount
    const tax = afterDiscount * taxRate
    return Math.round((afterDiscount + tax) * 100) / 100
  }, [items, orderDiscount, taxRate])

  // Calculate pricing for all tickets
  const ticketsWithPricing = useMemo((): SplitTicketWithPricing[] => {
    const assignments = tickets.map(ticket => ({
      ticketIndex: ticket.ticketIndex,
      items: Array.from(ticket.itemIds)
        .map(id => itemMap.get(id))
        .filter((item): item is OrderItemInput => item !== undefined),
    }))

    const result = calculateMultiSplitPricing(
      baseOrderNumber,
      assignments,
      orderDiscount,
      taxRate,
      roundTo
    )

    return tickets.map((ticket, idx) => ({
      ...ticket,
      pricing: result.tickets[idx]?.pricing || {
        items: [],
        subtotal: 0,
        itemDiscounts: 0,
        proportionalDiscount: 0,
        discountTotal: 0,
        taxAmount: 0,
        total: 0,
        roundingAdjustment: 0,
      },
      items: assignments[idx]?.items || [],
    }))
  }, [tickets, itemMap, baseOrderNumber, orderDiscount, taxRate, roundTo])

  // Computed values
  const totalAfterSplit = useMemo(
    () => ticketsWithPricing.reduce((sum, t) => sum + t.pricing.total, 0),
    [ticketsWithPricing]
  )

  const balanceCorrect = Math.abs(totalAfterSplit - originalTotal) < 0.01

  const canSave = useMemo(() => {
    // Need at least 2 tickets with items
    const nonEmptyTickets = tickets.filter(t => t.itemIds.size > 0)
    return nonEmptyTickets.length >= 2 && balanceCorrect
  }, [tickets, balanceCorrect])

  // Item selection
  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }, [])

  const selectAllItems = useCallback((ticketId: string) => {
    const ticket = tickets.find(t => t.id === ticketId)
    if (ticket) {
      setSelectedItemIds(new Set(ticket.itemIds))
    }
  }, [tickets])

  const clearSelection = useCallback(() => {
    setSelectedItemIds(new Set())
  }, [])

  // Ticket operations
  const createNewTicket = useCallback((): string => {
    const newId = `ticket-${nextTicketNum}`
    const newTicket: SplitTicket = {
      id: newId,
      ticketIndex: nextTicketNum,
      displayNumber: `${baseOrderNumber}-${nextTicketNum}`,
      itemIds: new Set(),
    }
    setTickets(prev => [...prev, newTicket])
    setNextTicketNum(prev => prev + 1)
    return newId
  }, [baseOrderNumber, nextTicketNum])

  const deleteTicket = useCallback((ticketId: string): boolean => {
    const ticket = tickets.find(t => t.id === ticketId)
    if (!ticket || ticket.itemIds.size > 0) {
      return false // Can't delete non-empty tickets
    }
    if (tickets.length <= 1) {
      return false // Can't delete last ticket
    }
    setTickets(prev => prev.filter(t => t.id !== ticketId))
    if (activeTicketId === ticketId) {
      setActiveTicketId(null)
    }
    return true
  }, [tickets, activeTicketId])

  const moveItem = useCallback((itemId: string, toTicketId: string) => {
    setTickets(prev => prev.map(ticket => {
      const newItemIds = new Set(ticket.itemIds)
      if (ticket.id === toTicketId) {
        newItemIds.add(itemId)
      } else {
        newItemIds.delete(itemId)
      }
      return { ...ticket, itemIds: newItemIds }
    }))
    // Clear this item from selection
    setSelectedItemIds(prev => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
  }, [])

  const moveSelectedItems = useCallback((toTicketId: string) => {
    if (selectedItemIds.size === 0) return

    setTickets(prev => prev.map(ticket => {
      const newItemIds = new Set(ticket.itemIds)
      if (ticket.id === toTicketId) {
        // Add selected items to target
        selectedItemIds.forEach(id => newItemIds.add(id))
      } else {
        // Remove selected items from other tickets
        selectedItemIds.forEach(id => newItemIds.delete(id))
      }
      return { ...ticket, itemIds: newItemIds }
    }))

    // Clear selection
    setSelectedItemIds(new Set())
  }, [selectedItemIds])

  // Get final assignments for API
  const getAssignments = useCallback(() => {
    return tickets
      .filter(t => t.itemIds.size > 0)
      .map(t => ({
        ticketIndex: t.ticketIndex,
        itemIds: Array.from(t.itemIds),
      }))
  }, [tickets])

  // Reset to initial state
  const reset = useCallback(() => {
    setTickets([{
      id: 'ticket-1',
      ticketIndex: 1,
      displayNumber: `${baseOrderNumber}-1`,
      itemIds: new Set(items.map(i => i.id)),
    }])
    setSelectedItemIds(new Set())
    setActiveTicketId(null)
    setNextTicketNum(2)
  }, [baseOrderNumber, items])

  return {
    tickets: ticketsWithPricing,
    selectedItemIds,
    activeTicketId,
    toggleItemSelection,
    selectAllItems,
    clearSelection,
    createNewTicket,
    deleteTicket,
    moveSelectedItems,
    moveItem,
    setActiveTicket: setActiveTicketId,
    canSave,
    totalAfterSplit,
    originalTotal,
    balanceCorrect,
    getAssignments,
    reset,
  }
}
