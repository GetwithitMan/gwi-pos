'use client'

import { create } from 'zustand'
// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResendModalData {
  itemId: string
  itemName: string
}

// ─── Order UI State ─────────────────────────────────────────────────────────
// Catch-all for UI state that doesn't fit modifier, payment, or discount flows.

interface OrderUiState {
  // ── Display Settings Modal ──
  showDisplaySettings: boolean

  // ── Tabs Panel / Open Orders ──
  showTabsPanel: boolean
  isTabManagerExpanded: boolean
  tabsRefreshTrigger: number
  showTipAdjustment: boolean

  // ── Receipt Modal ──
  showReceiptModal: boolean
  receiptOrderId: string | null
  preloadedReceiptData: any

  // ── Resend Modal ──
  resendModal: ResendModalData | null
  resendNote: string
  resendLoading: boolean

  // ── Item Transfer ──
  showItemTransferModal: boolean

  // ── Tab/Order Transfer ──
  showTabTransferModal: boolean

  // ── Tab Name Prompt ──
  showTabNamePrompt: boolean
  tabNameCallback: (() => void) | null

  // ── Item Notes ──
  editingNotesItemId: string | null
  editingNotesText: string

  // ── Time Clock / Shift ──
  showTimeClockModal: boolean
  currentShift: any | null
  showShiftStartModal: boolean
  showShiftCloseoutModal: boolean
}

interface OrderUiActions {
  // ── Display Settings ──
  setShowDisplaySettings: (v: boolean) => void

  // ── Tabs Panel ──
  setShowTabsPanel: (v: boolean) => void
  setIsTabManagerExpanded: (v: boolean) => void
  bumpTabsRefresh: () => void
  setTabsRefreshTrigger: (v: number | ((prev: number) => number)) => void
  setShowTipAdjustment: (v: boolean) => void

  // ── Receipt Modal ──
  openReceiptModal: (orderId: string, preloaded?: any) => void
  closeReceiptModal: () => void
  setShowReceiptModal: (v: boolean) => void
  setReceiptOrderId: (v: string | null) => void
  setPreloadedReceiptData: (v: any) => void

  // ── Resend ──
  openResendModal: (itemId: string, itemName: string) => void
  closeResendModal: () => void
  setResendModal: (v: ResendModalData | null) => void
  setResendNote: (v: string) => void
  setResendLoading: (v: boolean) => void

  // ── Item Transfer ──
  setShowItemTransferModal: (v: boolean) => void

  // ── Tab/Order Transfer ──
  setShowTabTransferModal: (v: boolean) => void

  // ── Tab Name Prompt ──
  openTabNamePrompt: (callback: (() => void) | null) => void
  closeTabNamePrompt: () => void
  setShowTabNamePrompt: (v: boolean) => void
  setTabNameCallback: (v: (() => void) | null) => void

  // ── Item Notes ──
  openNoteEditor: (itemId: string, text: string) => void
  closeNoteEditor: () => void
  setEditingNotesItemId: (v: string | null) => void
  setEditingNotesText: (v: string) => void

  // ── Time Clock / Shift ──
  setShowTimeClockModal: (v: boolean) => void
  setCurrentShift: (v: any | null) => void
  setShowShiftStartModal: (v: boolean) => void
  setShowShiftCloseoutModal: (v: boolean) => void

  // ── Reset ──
  reset: () => void
}

const initialState: OrderUiState = {
  showDisplaySettings: false,

  showTabsPanel: false,
  isTabManagerExpanded: false,
  tabsRefreshTrigger: 0,
  showTipAdjustment: false,

  showReceiptModal: false,
  receiptOrderId: null,
  preloadedReceiptData: null,

  resendModal: null,
  resendNote: '',
  resendLoading: false,

  showItemTransferModal: false,
  showTabTransferModal: false,

  showTabNamePrompt: false,
  tabNameCallback: null,

  editingNotesItemId: null,
  editingNotesText: '',

  showTimeClockModal: false,
  currentShift: null,
  showShiftStartModal: false,
  showShiftCloseoutModal: false,
}

export const useOrderUiStore = create<OrderUiState & OrderUiActions>((set) => ({
  ...initialState,

  // ── Display Settings ──
  setShowDisplaySettings: (v) => set({ showDisplaySettings: v }),

  // ── Tabs Panel ──
  setShowTabsPanel: (v) => set({ showTabsPanel: v }),
  setIsTabManagerExpanded: (v) => set({ isTabManagerExpanded: v }),
  bumpTabsRefresh: () => set(s => ({ tabsRefreshTrigger: s.tabsRefreshTrigger + 1 })),
  setTabsRefreshTrigger: (v) => set(s => ({
    tabsRefreshTrigger: typeof v === 'function' ? v(s.tabsRefreshTrigger) : v,
  })),
  setShowTipAdjustment: (v) => set({ showTipAdjustment: v }),

  // ── Receipt Modal ──
  openReceiptModal: (orderId, preloaded) => set({
    showReceiptModal: true,
    receiptOrderId: orderId,
    preloadedReceiptData: preloaded ?? null,
  }),
  closeReceiptModal: () => set({
    showReceiptModal: false,
    receiptOrderId: null,
    preloadedReceiptData: null,
  }),
  setShowReceiptModal: (v) => set({ showReceiptModal: v }),
  setReceiptOrderId: (v) => set({ receiptOrderId: v }),
  setPreloadedReceiptData: (v) => set({ preloadedReceiptData: v }),

  // ── Resend ──
  openResendModal: (itemId, itemName) => set({
    resendModal: { itemId, itemName },
    resendNote: '',
  }),
  closeResendModal: () => set({
    resendModal: null,
    resendNote: '',
  }),
  setResendModal: (v) => set({ resendModal: v }),
  setResendNote: (v) => set({ resendNote: v }),
  setResendLoading: (v) => set({ resendLoading: v }),

  // ── Item Transfer ──
  setShowItemTransferModal: (v) => set({ showItemTransferModal: v }),

  // ── Tab/Order Transfer ──
  setShowTabTransferModal: (v) => set({ showTabTransferModal: v }),

  // ── Tab Name Prompt ──
  openTabNamePrompt: (callback) => set({
    showTabNamePrompt: true,
    tabNameCallback: callback,
  }),
  closeTabNamePrompt: () => set({
    showTabNamePrompt: false,
    tabNameCallback: null,
  }),
  setShowTabNamePrompt: (v) => set({ showTabNamePrompt: v }),
  setTabNameCallback: (v) => set({ tabNameCallback: v }),

  // ── Item Notes ──
  openNoteEditor: (itemId, text) => set({
    editingNotesItemId: itemId,
    editingNotesText: text,
  }),
  closeNoteEditor: () => set({
    editingNotesItemId: null,
    editingNotesText: '',
  }),
  setEditingNotesItemId: (v) => set({ editingNotesItemId: v }),
  setEditingNotesText: (v) => set({ editingNotesText: v }),

  // ── Time Clock / Shift ──
  setShowTimeClockModal: (v) => set({ showTimeClockModal: v }),
  setCurrentShift: (v) => set({ currentShift: v }),
  setShowShiftStartModal: (v) => set({ showShiftStartModal: v }),
  setShowShiftCloseoutModal: (v) => set({ showShiftCloseoutModal: v }),

  // ── Reset ──
  reset: () => set(initialState),
}))
