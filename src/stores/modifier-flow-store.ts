'use client'

import { create } from 'zustand'
import type { MenuItem, PizzaOrderConfig, PizzaSpecialty } from '@/types'
import type { ComboTemplate } from '@/hooks/useComboBuilder'
import type { PrepaidPackage } from '@/lib/entertainment-pricing'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EntertainmentItemData {
  id: string
  name: string
  ratePerMinute?: number
  prepaidPackages?: PrepaidPackage[]
  happyHourEnabled?: boolean
  happyHourPrice?: number | null
}

// ─── Modifier Flow State ────────────────────────────────────────────────────

interface ModifierFlowState {
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

interface ModifierFlowActions {
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

  // ── Weight Capture ──
  openWeightModal: (item: { id: string; name: string; pricePerWeightUnit: number; weightUnit: string }) => void
  closeWeightModal: () => void
  setShowWeightModal: (v: boolean) => void
  setWeightCaptureItem: (v: { id: string; name: string; pricePerWeightUnit: number; weightUnit: string } | null) => void

  // ── Pricing Option Picker ──
  setPricingPickerItem: (v: any | null) => void

  // ── Age Verification ──
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

const initialState: ModifierFlowState = {
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

  showWeightModal: false,
  weightCaptureItem: null,

  pricingPickerItem: null,

  showAgeVerification: false,
  ageVerificationItem: null,
  ageVerificationCallback: null,

  allergenNotice: null,
}

export const useModifierFlowStore = create<ModifierFlowState & ModifierFlowActions>((set) => ({
  ...initialState,

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

  // ── Entertainment ──
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

  // ── Age Verification ──
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
