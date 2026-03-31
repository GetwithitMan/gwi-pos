'use client'

import { create } from 'zustand'
// ─── Types ──────────────────────────────────────────────────────────────────

export interface SplitChip {
  id: string
  label: string
  isPaid: boolean
  total: number
}

export interface TabCardInfo {
  cardholderName?: string
  cardLast4?: string
  cardType?: string
  recordNo?: string
  authAmount?: number
}

// ─── Payment Flow State ─────────────────────────────────────────────────────

interface PaymentFlowState {
  // ── Payment Modal ──
  showPaymentModal: boolean
  orderToPayId: string | null
  initialPayMethod: 'cash' | 'credit' | undefined
  paymentTabCards: any[]

  // ── Card Tab Flow ──
  showCardTabFlow: boolean
  cardTabOrderId: string | null
  tabCardInfo: TabCardInfo | null

  // ── Split Tickets ──
  showSplitTicketManager: boolean
  splitManageMode: boolean
  editingChildSplit: boolean
  splitParentToReturnTo: string | null
  payAllSplitsQueue: string[]
  showPayAllSplitsConfirm: boolean
  payAllSplitsTotal: number
  payAllSplitsCardTotal: number
  payAllSplitsParentId: string | null
  payAllSplitsProcessing: boolean
  payAllSplitsStep: 'confirm' | 'datacap_card'
  orderSplitChips: SplitChip[]
  splitParentId: string | null
  splitChipsFlashing: boolean
}

interface PaymentFlowActions {
  // ── Payment Modal ──
  openPaymentModal: (orderId: string, method?: 'cash' | 'credit') => void
  closePaymentModal: () => void
  setShowPaymentModal: (v: boolean) => void
  setOrderToPayId: (v: string | null) => void
  setInitialPayMethod: (v: 'cash' | 'credit' | undefined) => void
  setPaymentTabCards: (v: any[]) => void

  // ── Card Tab Flow ──
  openCardTabFlow: (orderId: string) => void
  closeCardTabFlow: () => void
  setShowCardTabFlow: (v: boolean) => void
  setCardTabOrderId: (v: string | null) => void
  setTabCardInfo: (v: TabCardInfo | null) => void

  // ── Split Tickets ──
  setShowSplitTicketManager: (v: boolean) => void
  setSplitManageMode: (v: boolean) => void
  setEditingChildSplit: (v: boolean) => void
  setSplitParentToReturnTo: (v: string | null) => void
  setPayAllSplitsQueue: (v: string[] | ((prev: string[]) => string[])) => void
  setShowPayAllSplitsConfirm: (v: boolean) => void
  setPayAllSplitsTotal: (v: number) => void
  setPayAllSplitsCardTotal: (v: number) => void
  setPayAllSplitsParentId: (v: string | null) => void
  setPayAllSplitsProcessing: (v: boolean) => void
  setPayAllSplitsStep: (v: 'confirm' | 'datacap_card') => void
  setOrderSplitChips: (v: SplitChip[] | ((prev: SplitChip[]) => SplitChip[])) => void
  setSplitParentId: (v: string | null) => void
  setSplitChipsFlashing: (v: boolean) => void

  // ── Reset ──
  reset: () => void
}

const initialState: PaymentFlowState = {
  showPaymentModal: false,
  orderToPayId: null,
  initialPayMethod: undefined,
  paymentTabCards: [],

  showCardTabFlow: false,
  cardTabOrderId: null,
  tabCardInfo: null,

  showSplitTicketManager: false,
  splitManageMode: false,
  editingChildSplit: false,
  splitParentToReturnTo: null,
  payAllSplitsQueue: [],
  showPayAllSplitsConfirm: false,
  payAllSplitsTotal: 0,
  payAllSplitsCardTotal: 0,
  payAllSplitsParentId: null,
  payAllSplitsProcessing: false,
  payAllSplitsStep: 'confirm',
  orderSplitChips: [],
  splitParentId: null,
  splitChipsFlashing: false,
}

export const usePaymentFlowStore = create<PaymentFlowState & PaymentFlowActions>((set) => ({
  ...initialState,

  // ── Payment Modal ──
  openPaymentModal: (orderId, method) => set({
    showPaymentModal: true,
    orderToPayId: orderId,
    initialPayMethod: method,
  }),
  closePaymentModal: () => set({
    showPaymentModal: false,
    orderToPayId: null,
    initialPayMethod: undefined,
  }),
  setShowPaymentModal: (v) => set({ showPaymentModal: v }),
  setOrderToPayId: (v) => set({ orderToPayId: v }),
  setInitialPayMethod: (v) => set({ initialPayMethod: v }),
  setPaymentTabCards: (v) => set({ paymentTabCards: v }),

  // ── Card Tab Flow ──
  openCardTabFlow: (orderId) => set({
    showCardTabFlow: true,
    cardTabOrderId: orderId,
  }),
  closeCardTabFlow: () => set({
    showCardTabFlow: false,
  }),
  setShowCardTabFlow: (v) => set({ showCardTabFlow: v }),
  setCardTabOrderId: (v) => set({ cardTabOrderId: v }),
  setTabCardInfo: (v) => set({ tabCardInfo: v }),

  // ── Split Tickets ──
  setShowSplitTicketManager: (v) => set({ showSplitTicketManager: v }),
  setSplitManageMode: (v) => set({ splitManageMode: v }),
  setEditingChildSplit: (v) => set({ editingChildSplit: v }),
  setSplitParentToReturnTo: (v) => set({ splitParentToReturnTo: v }),
  setPayAllSplitsQueue: (v) => set(s => ({
    payAllSplitsQueue: typeof v === 'function' ? v(s.payAllSplitsQueue) : v,
  })),
  setShowPayAllSplitsConfirm: (v) => set({ showPayAllSplitsConfirm: v }),
  setPayAllSplitsTotal: (v) => set({ payAllSplitsTotal: v }),
  setPayAllSplitsCardTotal: (v) => set({ payAllSplitsCardTotal: v }),
  setPayAllSplitsParentId: (v) => set({ payAllSplitsParentId: v }),
  setPayAllSplitsProcessing: (v) => set({ payAllSplitsProcessing: v }),
  setPayAllSplitsStep: (v) => set({ payAllSplitsStep: v }),
  setOrderSplitChips: (v) => set(s => ({
    orderSplitChips: typeof v === 'function' ? v(s.orderSplitChips) : v,
  })),
  setSplitParentId: (v) => set({ splitParentId: v }),
  setSplitChipsFlashing: (v) => set({ splitChipsFlashing: v }),

  // ── Reset ──
  reset: () => set(initialState),
}))
