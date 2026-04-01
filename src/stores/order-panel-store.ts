'use client'

import { create } from 'zustand'

// ─── UI State ────────────────────────────────────────────────────────────────

export interface OrderPanelUIState {
  // Modal visibility
  showShareOwnership: boolean
  showCustomerModal: boolean
  showCustomerProfile: boolean
  showTaxExemptDialog: boolean
  showCheckOverview: boolean

  // Pager
  assigningPager: boolean
  unassigningPager: boolean
  isPagingNow: boolean

  // Tax exempt
  isTaxExempt: boolean
  taxExemptToggling: boolean
  taxExemptReason: string
  taxExemptId: string

  // Customer
  linkedCustomer: {
    id: string
    firstName: string
    lastName: string
    loyaltyPoints: number
    tags?: string[]
    birthday?: string | null
  } | null
  loyaltyEnabled: boolean

  // Seat allergy
  seatAllergyNotes: Record<number, string>
  allergyModalSeat: { seatNumber: number; position: { x: number; y: number } } | null

  // Item list view
  sortDirection: 'newest-bottom' | 'newest-top'
  condensedView: boolean
  expandedGroups: Set<string>
  newestItemId: string | null

  // Check overview
  checkOverviewItems: { name: string; qty: number; total: number }[]
  checkOverviewTotal: number
}

// ─── Actions ─────────────────────────────────────────────────────────────────

interface OrderPanelActions {
  // Modal toggles
  setShowShareOwnership: (v: boolean) => void
  setShowCustomerModal: (v: boolean) => void
  setShowCustomerProfile: (v: boolean) => void
  setShowTaxExemptDialog: (v: boolean) => void
  setShowCheckOverview: (v: boolean | ((prev: boolean) => boolean)) => void

  // Pager
  setAssigningPager: (v: boolean) => void
  setUnassigningPager: (v: boolean) => void
  setIsPagingNow: (v: boolean) => void

  // Tax exempt
  setIsTaxExempt: (v: boolean) => void
  setTaxExemptToggling: (v: boolean) => void
  setTaxExemptReason: (v: string) => void
  setTaxExemptId: (v: string) => void

  // Customer
  setLinkedCustomer: (v: OrderPanelUIState['linkedCustomer']) => void
  setLoyaltyEnabled: (v: boolean) => void

  // Seat allergy
  setSeatAllergyNotes: (v: Record<number, string> | ((prev: Record<number, string>) => Record<number, string>)) => void
  setAllergyModalSeat: (v: OrderPanelUIState['allergyModalSeat']) => void

  // Item list view
  setSortDirection: (v: 'newest-bottom' | 'newest-top' | ((prev: 'newest-bottom' | 'newest-top') => 'newest-bottom' | 'newest-top')) => void
  setCondensedView: (v: boolean | ((prev: boolean) => boolean)) => void
  setExpandedGroups: (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  setNewestItemId: (v: string | null) => void

  // Check overview
  setCheckOverviewItems: (v: { name: string; qty: number; total: number }[]) => void
  setCheckOverviewTotal: (v: number) => void

  // Reset (when order changes)
  resetForNewOrder: () => void
}

// ─── Store ───────────────────────────────────────────────────────────────────

export type OrderPanelStore = OrderPanelUIState & OrderPanelActions

const initialState: OrderPanelUIState = {
  showShareOwnership: false,
  showCustomerModal: false,
  showCustomerProfile: false,
  showTaxExemptDialog: false,
  showCheckOverview: false,
  assigningPager: false,
  unassigningPager: false,
  isPagingNow: false,
  isTaxExempt: false,
  taxExemptToggling: false,
  taxExemptReason: '',
  taxExemptId: '',
  linkedCustomer: null,
  loyaltyEnabled: false,
  seatAllergyNotes: {},
  allergyModalSeat: null,
  sortDirection: 'newest-bottom',
  condensedView: false,
  expandedGroups: new Set(),
  newestItemId: null,
  checkOverviewItems: [],
  checkOverviewTotal: 0,
}

export const useOrderPanelStore = create<OrderPanelStore>((set) => ({
  ...initialState,

  // Modal toggles
  setShowShareOwnership: (v) => set({ showShareOwnership: v }),
  setShowCustomerModal: (v) => set({ showCustomerModal: v }),
  setShowCustomerProfile: (v) => set({ showCustomerProfile: v }),
  setShowTaxExemptDialog: (v) => set({ showTaxExemptDialog: v }),
  setShowCheckOverview: (v) =>
    set((s) => ({ showCheckOverview: typeof v === 'function' ? v(s.showCheckOverview) : v })),

  // Pager
  setAssigningPager: (v) => set({ assigningPager: v }),
  setUnassigningPager: (v) => set({ unassigningPager: v }),
  setIsPagingNow: (v) => set({ isPagingNow: v }),

  // Tax exempt
  setIsTaxExempt: (v) => set({ isTaxExempt: v }),
  setTaxExemptToggling: (v) => set({ taxExemptToggling: v }),
  setTaxExemptReason: (v) => set({ taxExemptReason: v }),
  setTaxExemptId: (v) => set({ taxExemptId: v }),

  // Customer
  setLinkedCustomer: (v) => set({ linkedCustomer: v }),
  setLoyaltyEnabled: (v) => set({ loyaltyEnabled: v }),

  // Seat allergy
  setSeatAllergyNotes: (v) =>
    set((s) => ({ seatAllergyNotes: typeof v === 'function' ? v(s.seatAllergyNotes) : v })),
  setAllergyModalSeat: (v) => set({ allergyModalSeat: v }),

  // Item list view
  setSortDirection: (v) =>
    set((s) => ({ sortDirection: typeof v === 'function' ? v(s.sortDirection) : v })),
  setCondensedView: (v) =>
    set((s) => ({ condensedView: typeof v === 'function' ? v(s.condensedView) : v })),
  setExpandedGroups: (v) =>
    set((s) => ({ expandedGroups: typeof v === 'function' ? v(s.expandedGroups) : v })),
  setNewestItemId: (v) => set({ newestItemId: v }),

  // Check overview
  setCheckOverviewItems: (v) => set({ checkOverviewItems: v }),
  setCheckOverviewTotal: (v) => set({ checkOverviewTotal: v }),

  // Reset
  resetForNewOrder: () => set(initialState),
}))
