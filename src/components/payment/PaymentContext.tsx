'use client'

import React, { createContext, useContext } from 'react'
import type { DualPricingSettings, TipSettings, PaymentSettings, PriceRoundingSettings, PricingProgram, CustomerFeedbackSettings } from '@/lib/settings'
import type { CardDetectionResult } from './DatacapPaymentProcessor'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TabCard {
  id: string
  cardType: string
  cardLast4: string
  cardholderName?: string | null
  authAmount: number
  isDefault: boolean
}

export interface PendingPayment {
  method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account' | 'room_charge'
  amount: number
  tipAmount: number
  amountTendered?: number
  cardBrand?: string
  cardLast4?: string
  giftCardId?: string
  giftCardNumber?: string
  houseAccountId?: string
  // Hotel PMS / Bill to Room fields (P1.1: selectionId is the server-trusted token)
  selectionId?: string
  roomNumber?: string
  guestName?: string
  pmsReservationId?: string
  // Datacap Direct fields
  datacapRecordNo?: string
  datacapRefNumber?: string
  datacapSequenceNo?: string
  authCode?: string
  entryMethod?: string
  signatureData?: string
  amountAuthorized?: number
  // SAF (Store-and-Forward) — transaction stored offline on reader
  storedOffline?: boolean
  // Pricing tier detection (Payment & Pricing Redesign)
  detectedCardType?: string
  appliedPricingTier?: string
  walletType?: string | null
}

export interface GiftCardInfo {
  id: string
  cardNumber: string
  currentBalance: number
  status: string
}

export interface HouseAccountInfo {
  id: string
  name: string
  currentBalance: number
  creditLimit: number
  status: string
}

export type PaymentStepType = 'method' | 'cash' | 'tip' | 'gift_card' | 'house_account' | 'datacap_card' | 'room_charge' | 'manual_card_entry' | 'split'

export type PaymentMethod = 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account' | 'room_charge'

// ─── Context Value ──────────────────────────────────────────────────────────

export interface PaymentContextValue {
  // Order data
  orderId: string | null
  effectiveOrderTotal: number
  effectiveSubtotal: number
  employeeId?: string
  terminalId?: string
  locationId?: string

  // Settings
  dualPricing: DualPricingSettings
  tipSettings: TipSettings
  paymentSettings: PaymentSettings
  priceRounding?: PriceRoundingSettings
  pricingProgram?: PricingProgram
  feedbackSettings?: CustomerFeedbackSettings
  tipExemptAmount?: number

  // Computed totals
  cashTotal: number
  cardTotal: number
  debitTotal: number
  creditTotal: number
  currentTotal: number
  remainingBeforeTip: number
  totalWithTip: number
  surchargeAmount: number
  cashRoundingAdjustment: number
  alreadyPaid: number
  pendingTotal: number
  discountPercent: number

  // Payment flow state
  step: PaymentStepType
  setStep: (step: PaymentStepType) => void
  selectedMethod: PaymentMethod | null
  setSelectedMethod: (method: PaymentMethod | null) => void
  pendingPayments: PendingPayment[]
  setPendingPayments: React.Dispatch<React.SetStateAction<PendingPayment[]>>
  tipAmount: number
  setTipAmount: (amount: number) => void
  customTip: string
  setCustomTip: (tip: string) => void
  isProcessing: boolean
  setIsProcessing: (processing: boolean) => void
  error: string | null
  setError: (error: string | null) => void
  isConnected: boolean

  // Tab state
  tabCards: TabCard[]
  onTabCardsChanged?: () => void
  tabIncrementFailed: boolean

  // Card detection state
  cardDetectionResult: CardDetectionResult | null
  setCardDetectionResult: (result: CardDetectionResult | null) => void

  // Permissions
  canKeyedEntry: boolean

  // Handlers
  handleSelectMethod: (method: PaymentMethod) => void
  handleChargeExistingCard: (card: TabCard) => void
  handleAddCardToTab: () => void
  handleCashExact: () => void
  handleSplitPayment: () => void
  processPayments: (payments: PendingPayment[], currentPendingPayments: PendingPayment[]) => void
  maybeShowFeedback: (receiptData?: Record<string, unknown>) => void

  // Add card state
  addingCard: boolean
  addCardError: string | null
  tabAuthSlow: boolean
  tabAuthSuccess: string | null

  // Manual card entry
  showManualEntry: boolean
  setShowManualEntry: (show: boolean) => void
}

// ─── Context ────────────────────────────────────────────────────────────────

const PaymentContext = createContext<PaymentContextValue | null>(null)

export function PaymentProvider({ value, children }: { value: PaymentContextValue; children: React.ReactNode }) {
  return <PaymentContext.Provider value={value}>{children}</PaymentContext.Provider>
}

export function usePaymentContext(): PaymentContextValue {
  const ctx = useContext(PaymentContext)
  if (!ctx) throw new Error('usePaymentContext must be used within PaymentProvider')
  return ctx
}
