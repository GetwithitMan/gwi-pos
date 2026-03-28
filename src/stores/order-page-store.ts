'use client'

import { create } from 'zustand'
import type { MenuItem, PizzaOrderConfig, PizzaSpecialty } from '@/types'
import type { ComboTemplate } from '@/hooks/useComboBuilder'
import type { PrepaidPackage } from '@/lib/entertainment-pricing'

// ─── Modal Data Types ───────────────────────────────────────────────────────

export interface ResendModalData {
  itemId: string
  itemName: string
}

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

export interface EntertainmentItemData {
  id: string
  name: string
  ratePerMinute?: number
  prepaidPackages?: PrepaidPackage[]
  happyHourEnabled?: boolean
  happyHourPrice?: number | null
}

// ─── Store State ────────────────────────────────────────────────────────────

interface OrderPageState {
  // ── Display Settings Modal ──
  showDisplaySettings: boolean

  // ── Tabs Panel / Open Orders ──
  showTabsPanel: boolean
  isTabManagerExpanded: boolean
  tabsRefreshTrigger: number
  showTipAdjustment: boolean

  // ── Modifier Modal ──
  showModifierModal: boolean
  selectedItem: MenuItem | null
  itemModifierGroups: any[]
  loadingModifiers: boolean
  editingOrderItem: any | null

  // ── Pizza Builder ──
  showPizzaModal: boolean
  selectedPizzaItem: MenuItem | null
  selectedPizzaSpecialty: PizzaSpecialty | null
  editingPizzaItem: { id: string; pizzaConfig?: PizzaOrderConfig } | null

  // ── Combo Builder ──
  showComboModal: boolean
  selectedComboItem: MenuItem | null
  comboTemplate: ComboTemplate | null
  comboSelections: Record<string, any>

  // ── Entertainment ──
  showEntertainmentStart: boolean
  entertainmentItem: EntertainmentItemData | null

  // ── Timed Rental ──
  showTimedRentalModal: boolean
  selectedTimedItem: MenuItem | null
  selectedRateType: string | null
  loadingSession: boolean

  // ── Payment Modal ──
  showPaymentModal: boolean
  orderToPayId: string | null
  initialPayMethod: 'cash' | 'credit' | undefined
  paymentTabCards: any[]

  // ── Discount Modal ──
  showDiscountModal: boolean
  appliedDiscounts: any[]
  itemDiscountTargetId: string | null

  // ── Comp/Void Modal ──
  showCompVoidModal: boolean
  compVoidItem: any | null

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

  // ── Card Tab Flow ──
  showCardTabFlow: boolean
  cardTabOrderId: string | null
  tabCardInfo: TabCardInfo | null

  // ── Item Notes ──
  editingNotesItemId: string | null
  editingNotesText: string

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

  // ── Time Clock / Shift ──
  showTimeClockModal: boolean
  currentShift: any | null
  showShiftStartModal: boolean
  showShiftCloseoutModal: boolean

  // ── Weight Capture ──
  showWeightModal: boolean
  weightCaptureItem: { id: string; name: string; pricePerWeightUnit: number; weightUnit: string } | null

  // ── Pricing Option Picker ──
  pricingPickerItem: any | null

  // ── Age Verification ──
  showAgeVerification: boolean
  ageVerificationItem: MenuItem | null
  ageVerificationCallback: (() => void) | null

  // ── Allergen Notice ──
  allergenNotice: { itemName: string; allergens: string[] } | null
}

// ─── Actions ───���──────────────────────────────────────────���─────────────────

interface OrderPageActions {
  // ── Display Settings ──
  setShowDisplaySettings: (v: boolean) => void

  // ── Tabs Panel ──
  setShowTabsPanel: (v: boolean) => void
  setIsTabManagerExpanded: (v: boolean) => void
  bumpTabsRefresh: () => void
  setTabsRefreshTrigger: (v: number | ((prev: number) => number)) => void
  setShowTipAdjustment: (v: boolean) => void

  // ── Modifier Modal ──
  openModifierModal: (item: MenuItem, groups: any[], editing?: any) => void
  closeModifierModal: () => void
  setShowModifierModal: (v: boolean) => void
  setSelectedItem: (v: MenuItem | null) => void
  setItemModifierGroups: (v: any[]) => void
  setLoadingModifiers: (v: boolean) => void
  setEditingOrderItem: (v: any | null) => void

  // ── Pizza Builder ──
  openPizzaModal: (item: MenuItem, editing?: { id: string; pizzaConfig?: PizzaOrderConfig } | null) => void
  closePizzaModal: () => void
  setShowPizzaModal: (v: boolean) => void
  setSelectedPizzaItem: (v: MenuItem | null) => void
  setSelectedPizzaSpecialty: (v: PizzaSpecialty | null) => void
  setEditingPizzaItem: (v: { id: string; pizzaConfig?: PizzaOrderConfig } | null) => void

  // ── Combo Builder ──
  openComboModal: (item: MenuItem) => void
  closeComboModal: () => void
  setShowComboModal: (v: boolean) => void
  setSelectedComboItem: (v: MenuItem | null) => void
  setComboTemplate: (v: ComboTemplate | null) => void
  setComboSelections: (v: Record<string, any>) => void

  // ── Entertainment ──
  openEntertainmentStart: (item: EntertainmentItemData) => void
  closeEntertainmentStart: () => void
  setShowEntertainmentStart: (v: boolean) => void
  setEntertainmentItem: (v: EntertainmentItemData | null) => void

  // ── Timed Rental ──
  openTimedRentalModal: (item: MenuItem) => void
  closeTimedRentalModal: () => void
  setShowTimedRentalModal: (v: boolean) => void
  setSelectedTimedItem: (v: MenuItem | null) => void
  setSelectedRateType: (v: string | null) => void
  setLoadingSession: (v: boolean) => void

  // ── Payment Modal ──
  openPaymentModal: (orderId: string, method?: 'cash' | 'credit') => void
  closePaymentModal: () => void
  setShowPaymentModal: (v: boolean) => void
  setOrderToPayId: (v: string | null) => void
  setInitialPayMethod: (v: 'cash' | 'credit' | undefined) => void
  setPaymentTabCards: (v: any[]) => void

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

  // ── Receipt Modal ──
  openReceiptModal: (orderId: string, preloaded?: any) => void
  closeReceiptModal: () => void
  setShowReceiptModal: (v: boolean) => void
  setReceiptOrderId: (v: string | null) => void
  setPreloadedReceiptData: (v: any) => void

  // ─�� Resend ──
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

  // ── Card Tab Flow ──
  openCardTabFlow: (orderId: string) => void
  closeCardTabFlow: () => void
  setShowCardTabFlow: (v: boolean) => void
  setCardTabOrderId: (v: string | null) => void
  setTabCardInfo: (v: TabCardInfo | null) => void

  // ── Item Notes ──
  openNoteEditor: (itemId: string, text: string) => void
  closeNoteEditor: () => void
  setEditingNotesItemId: (v: string | null) => void
  setEditingNotesText: (v: string) => void

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

  // ── Time Clock / Shift ──
  setShowTimeClockModal: (v: boolean) => void
  setCurrentShift: (v: any | null) => void
  setShowShiftStartModal: (v: boolean) => void
  setShowShiftCloseoutModal: (v: boolean) => void

  // ── Weight Capture ──
  openWeightModal: (item: { id: string; name: string; pricePerWeightUnit: number; weightUnit: string }) => void
  closeWeightModal: () => void
  setShowWeightModal: (v: boolean) => void
  setWeightCaptureItem: (v: { id: string; name: string; pricePerWeightUnit: number; weightUnit: string } | null) => void

  // ���─ Pricing Option Picker ��─
  setPricingPickerItem: (v: any | null) => void

  // ─�� Age Verification ──
  openAgeVerification: (item: MenuItem, callback: () => void) => void
  closeAgeVerification: () => void
  setShowAgeVerification: (v: boolean) => void
  setAgeVerificationItem: (v: MenuItem | null) => void
  setAgeVerificationCallback: (v: (() => void) | null) => void

  // ── Allergen Notice ──
  setAllergenNotice: (v: { itemName: string; allergens: string[] } | null) => void

  // ── Reset ──
  reset: () => void
}

// ─── Initial State ───────────────────────────���──────────────────────────────

const initialState: OrderPageState = {
  showDisplaySettings: false,
  showTabsPanel: false,
  isTabManagerExpanded: false,
  tabsRefreshTrigger: 0,
  showTipAdjustment: false,

  showModifierModal: false,
  selectedItem: null,
  itemModifierGroups: [],
  loadingModifiers: false,
  editingOrderItem: null,

  showPizzaModal: false,
  selectedPizzaItem: null,
  selectedPizzaSpecialty: null,
  editingPizzaItem: null,

  showComboModal: false,
  selectedComboItem: null,
  comboTemplate: null,
  comboSelections: {},

  showEntertainmentStart: false,
  entertainmentItem: null,

  showTimedRentalModal: false,
  selectedTimedItem: null,
  selectedRateType: null,
  loadingSession: false,

  showPaymentModal: false,
  orderToPayId: null,
  initialPayMethod: undefined,
  paymentTabCards: [],

  showDiscountModal: false,
  appliedDiscounts: [],
  itemDiscountTargetId: null,

  showCompVoidModal: false,
  compVoidItem: null,

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

  showCardTabFlow: false,
  cardTabOrderId: null,
  tabCardInfo: null,

  editingNotesItemId: null,
  editingNotesText: '',

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

  showTimeClockModal: false,
  currentShift: null,
  showShiftStartModal: false,
  showShiftCloseoutModal: false,

  showWeightModal: false,
  weightCaptureItem: null,

  pricingPickerItem: null,

  showAgeVerification: false,
  ageVerificationItem: null,
  ageVerificationCallback: null,

  allergenNotice: null,
}

// ─── Store ────��──────────────────────────────────��──────────────────────────

export const useOrderPageStore = create<OrderPageState & OrderPageActions>((set, get) => ({
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

  // ── Modifier Modal ──
  openModifierModal: (item, groups, editing) => set({
    showModifierModal: true,
    selectedItem: item,
    itemModifierGroups: groups,
    editingOrderItem: editing ?? null,
  }),
  closeModifierModal: () => set({
    showModifierModal: false,
    selectedItem: null,
    itemModifierGroups: [],
    editingOrderItem: null,
  }),
  setShowModifierModal: (v) => set({ showModifierModal: v }),
  setSelectedItem: (v) => set({ selectedItem: v }),
  setItemModifierGroups: (v) => set({ itemModifierGroups: v }),
  setLoadingModifiers: (v) => set({ loadingModifiers: v }),
  setEditingOrderItem: (v) => set({ editingOrderItem: v }),

  // ── Pizza Builder ──
  openPizzaModal: (item, editing) => set({
    showPizzaModal: true,
    selectedPizzaItem: item,
    editingPizzaItem: editing ?? null,
  }),
  closePizzaModal: () => set({
    showPizzaModal: false,
    selectedPizzaItem: null,
    selectedPizzaSpecialty: null,
    editingPizzaItem: null,
  }),
  setShowPizzaModal: (v) => set({ showPizzaModal: v }),
  setSelectedPizzaItem: (v) => set({ selectedPizzaItem: v }),
  setSelectedPizzaSpecialty: (v) => set({ selectedPizzaSpecialty: v }),
  setEditingPizzaItem: (v) => set({ editingPizzaItem: v }),

  // ── Combo Builder ──
  openComboModal: (item) => set({
    showComboModal: true,
    selectedComboItem: item,
    comboSelections: {},
  }),
  closeComboModal: () => set({
    showComboModal: false,
    selectedComboItem: null,
    comboTemplate: null,
    comboSelections: {},
  }),
  setShowComboModal: (v) => set({ showComboModal: v }),
  setSelectedComboItem: (v) => set({ selectedComboItem: v }),
  setComboTemplate: (v) => set({ comboTemplate: v }),
  setComboSelections: (v) => set({ comboSelections: v }),

  // ��─ Entertainment ──
  openEntertainmentStart: (item) => set({
    showEntertainmentStart: true,
    entertainmentItem: item,
  }),
  closeEntertainmentStart: () => set({
    showEntertainmentStart: false,
    entertainmentItem: null,
  }),
  setShowEntertainmentStart: (v) => set({ showEntertainmentStart: v }),
  setEntertainmentItem: (v) => set({ entertainmentItem: v }),

  // ── Timed Rental ──
  openTimedRentalModal: (item) => set({
    showTimedRentalModal: true,
    selectedTimedItem: item,
  }),
  closeTimedRentalModal: () => set({
    showTimedRentalModal: false,
    selectedTimedItem: null,
  }),
  setShowTimedRentalModal: (v) => set({ showTimedRentalModal: v }),
  setSelectedTimedItem: (v) => set({ selectedTimedItem: v }),
  setSelectedRateType: (v) => set({ selectedRateType: v }),
  setLoadingSession: (v) => set({ loadingSession: v }),

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

  // ── Time Clock / Shift ──
  setShowTimeClockModal: (v) => set({ showTimeClockModal: v }),
  setCurrentShift: (v) => set({ currentShift: v }),
  setShowShiftStartModal: (v) => set({ showShiftStartModal: v }),
  setShowShiftCloseoutModal: (v) => set({ showShiftCloseoutModal: v }),

  // ── Weight Capture ──
  openWeightModal: (item) => set({
    showWeightModal: true,
    weightCaptureItem: item,
  }),
  closeWeightModal: () => set({
    showWeightModal: false,
    weightCaptureItem: null,
  }),
  setShowWeightModal: (v) => set({ showWeightModal: v }),
  setWeightCaptureItem: (v) => set({ weightCaptureItem: v }),

  // ── Pricing Option Picker ──
  setPricingPickerItem: (v) => set({ pricingPickerItem: v }),

  // ─�� Age Verification ��─
  openAgeVerification: (item, callback) => set({
    showAgeVerification: true,
    ageVerificationItem: item,
    ageVerificationCallback: callback,
  }),
  closeAgeVerification: () => set({
    showAgeVerification: false,
    ageVerificationItem: null,
    ageVerificationCallback: null,
  }),
  setShowAgeVerification: (v) => set({ showAgeVerification: v }),
  setAgeVerificationItem: (v) => set({ ageVerificationItem: v }),
  setAgeVerificationCallback: (v) => set({ ageVerificationCallback: v }),

  // ── Allergen Notice ──
  setAllergenNotice: (v) => set({ allergenNotice: v }),

  // ── Reset ──
  reset: () => set(initialState),
}))
