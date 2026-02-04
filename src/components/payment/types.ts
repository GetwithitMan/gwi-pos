/**
 * Shared types for payment components
 *
 * These types are extracted to enable future component splitting.
 * The PaymentModal can be refactored into smaller sub-components:
 * - PaymentMethodSelector
 * - TipSelector
 * - CashPaymentStep
 * - CardPaymentStep
 * - GiftCardPaymentStep
 * - HouseAccountPaymentStep
 * - PaymentConfirmation
 */

import type { DualPricingSettings, TipSettings, PaymentSettings } from '@/lib/settings'

export type PaymentMethod = 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account'
export type PaymentStep = 'method' | 'cash' | 'card' | 'tip' | 'confirm' | 'gift_card' | 'house_account'

export interface PendingPayment {
  method: PaymentMethod
  amount: number
  tipAmount: number
  amountTendered?: number
  cardBrand?: string
  cardLast4?: string
  giftCardId?: string
  giftCardNumber?: string
  houseAccountId?: string
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

export interface PaymentContextValue {
  orderId: string | null
  orderTotal: number
  remainingBalance: number
  subtotal: number
  dualPricing: DualPricingSettings
  tipSettings: TipSettings
  paymentSettings: PaymentSettings
  cashTotal: number
  cardTotal: number
}

export interface PaymentMethodSelectorProps {
  dualPricing: DualPricingSettings
  paymentSettings: PaymentSettings
  cashTotal: number
  cardTotal: number
  onSelectMethod: (method: PaymentMethod) => void
}

export interface TipSelectorProps {
  selectedMethod: PaymentMethod | null
  currentTotal: number
  subtotal: number
  orderTotal: number
  tipSettings: TipSettings
  tipAmount: number
  customTip: string
  onSelectTip: (percent: number | null) => void
  onCustomTipChange: (value: string) => void
  onCustomTipBlur: () => void
  onBack: () => void
  onContinue: () => void
}

export interface CashPaymentStepProps {
  totalWithTip: number
  quickAmounts: number[]
  customCashAmount: string
  isProcessing: boolean
  tipEnabled: boolean
  onCashPayment: (amount: number) => void
  onCustomAmountChange: (value: string) => void
  onBack: () => void
}

export interface CardPaymentStepProps {
  totalWithTip: number
  cardLast4: string
  cardBrand: string
  isProcessing: boolean
  tipEnabled: boolean
  onCardLast4Change: (value: string) => void
  onCardBrandChange: (value: string) => void
  onSubmit: () => void
  onBack: () => void
}

// Default tip settings constant
export const DEFAULT_TIP_SETTINGS: TipSettings = {
  enabled: true,
  suggestedPercentages: [15, 18, 20, 25],
  calculateOn: 'subtotal',
}

// Virtual Group Checkout Types
export interface GroupTableItem {
  id: string
  name: string
  quantity: number
  price: number
  modifierTotal?: number
  itemTotal?: number
  seatNumber?: number
}

export interface GroupTableFinancials {
  tableId: string
  tableName: string
  tableAbbreviation?: string
  isPrimary: boolean
  sectionId?: string
  sectionName?: string
  itemCount: number
  subtotal: number
  tax: number
  total: number
  paid: number
  remaining: number
  items: GroupTableItem[]
}

export interface VirtualGroupCheckoutData {
  virtualGroupId: string
  groupColor: string
  createdAt?: string
  primaryTableId: string
  primaryTableName: string
  tableCount: number
  order: {
    id: string
    orderNumber: number
    displayNumber?: string
    status: string
  } | null
  totals: {
    subtotal: number
    tax: number
    total: number
    paid: number
    remaining: number
    itemCount: number
  }
  financials: GroupTableFinancials[]
}
