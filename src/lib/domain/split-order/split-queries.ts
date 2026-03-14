/**
 * Split Queries — Split Order Domain
 *
 * Read-only queries for retrieving existing split order information.
 */

import type { SplitSourceOrder, GetSplitsResult } from './types'

interface SplitSummaryEntry {
  id: string
  orderNumber: number
  splitIndex?: number | null
  parentOrderId?: string | null
  displayNumber?: string | null
  total: any
  status: string
  payments: Array<{ totalAmount: any }>
  items?: unknown[]
  splitOrders?: unknown[]
}

/**
 * Build the split navigation data from an already-fetched order.
 * Pure function — no DB access needed since we use data from the initial fetch.
 */
export function getSplitOrders(order: SplitSourceOrder): GetSplitsResult {
  let allSplits: SplitSummaryEntry[]
  const parentOrder = order.parentOrder || order

  if (order.parentOrderId && order.parentOrder) {
    // This is a child — use already-fetched parent and its splitOrders
    allSplits = [order.parentOrder, ...order.parentOrder.splitOrders]
  } else if (order.splitOrders.length > 0) {
    // This is a parent with children — already have splitOrders from initial fetch
    allSplits = [order, ...order.splitOrders]
  } else {
    allSplits = [order]
  }

  return {
    splits: allSplits.map((s) => {
      return {
        id: s.id,
        orderNumber: s.orderNumber,
        splitIndex: s.splitIndex ?? null,
        displayNumber: s.splitIndex
          ? `${parentOrder.orderNumber}-${s.splitIndex}`
          : String(s.orderNumber),
        total: Number(s.total),
        paidAmount: s.payments.reduce((sum: number, p: { totalAmount: any }) => sum + Number(p.totalAmount), 0),
        isPaid: s.status === 'paid',
        itemCount: s.items?.length || 0,
        isParent: !s.parentOrderId && (s.splitOrders?.length || 0) > 0,
      }
    }),
    currentSplitId: order.id,
  }
}
