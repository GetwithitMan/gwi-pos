'use client'

import { create } from 'zustand'

// ─── Discount Flow State ────────────────────────────────────────────────────

interface DiscountFlowState {
  // ── Discount Modal ──
  showDiscountModal: boolean
  appliedDiscounts: any[]
  itemDiscountTargetId: string | null

  // ── Comp/Void Modal ──
  showCompVoidModal: boolean
  compVoidItem: any | null
}

interface DiscountFlowActions {
  // ── Discount Modal ──
  openDiscountModal: (itemId?: string) => void
  closeDiscountModal: () => void
  setShowDiscountModal: (v: boolean) => void
  setAppliedDiscounts: (v: any[]) => void
  setItemDiscountTargetId: (v: string | null) => void

  // ── Comp/Void ──
  openCompVoidModal: (item: any) => void
  closeCompVoidModal: () => void
  setShowCompVoidModal: (v: boolean) => void
  setCompVoidItem: (v: any | null) => void

  // ── Reset ──
  reset: () => void
}

const initialState: DiscountFlowState = {
  showDiscountModal: false,
  appliedDiscounts: [],
  itemDiscountTargetId: null,

  showCompVoidModal: false,
  compVoidItem: null,
}

export const useDiscountFlowStore = create<DiscountFlowState & DiscountFlowActions>((set) => ({
  ...initialState,

  // ── Discount Modal ──
  openDiscountModal: (itemId) => set({
    showDiscountModal: true,
    itemDiscountTargetId: itemId ?? null,
  }),
  closeDiscountModal: () => set({
    showDiscountModal: false,
    itemDiscountTargetId: null,
  }),
  setShowDiscountModal: (v) => set({ showDiscountModal: v }),
  setAppliedDiscounts: (v) => set({ appliedDiscounts: v }),
  setItemDiscountTargetId: (v) => set({ itemDiscountTargetId: v }),

  // ── Comp/Void ──
  openCompVoidModal: (item) => set({
    showCompVoidModal: true,
    compVoidItem: item,
  }),
  closeCompVoidModal: () => set({
    showCompVoidModal: false,
    compVoidItem: null,
  }),
  setShowCompVoidModal: (v) => set({ showCompVoidModal: v }),
  setCompVoidItem: (v) => set({ compVoidItem: v }),

  // ── Reset ──
  reset: () => set(initialState),
}))
