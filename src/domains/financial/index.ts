/**
 * Financial Domain
 *
 * Manages gift cards, house accounts, discounts, and tax.
 *
 * Modules:
 * - F1: Gift Cards (issue, redeem, balance)
 * - F2: House Accounts (credit, payments)
 * - F3: Discounts (rules, automatic, manual)
 * - F4: Coupons (codes, validation, tracking)
 * - F5: Tax Rules (rates, exemptions)
 */

// Types will be added as we migrate
export type GiftCard = {
  id: string
  locationId: string
  number: string
  balance: number
  initialAmount: number
  isActive: boolean
  expiresAt?: Date
  purchasedAt: Date
  purchasedBy?: string
}

export type HouseAccount = {
  id: string
  locationId: string
  customerId: string
  creditLimit: number
  currentBalance: number
  status: HouseAccountStatus
}

export type Discount = {
  id: string
  locationId: string
  name: string
  type: DiscountType
  value: number  // percentage or fixed amount
  isAutomatic: boolean
  conditions?: DiscountCondition[]
}

export type Coupon = {
  id: string
  locationId: string
  code: string
  discountId: string
  usageLimit?: number
  usedCount: number
  validFrom?: Date
  validUntil?: Date
  isActive: boolean
}

export type TaxRule = {
  id: string
  locationId: string
  name: string
  rate: number
  appliesTo: TaxAppliesTo[]
  isDefault: boolean
}

export type HouseAccountStatus = 'active' | 'suspended' | 'closed'
export type DiscountType = 'percentage' | 'fixed' | 'buy_x_get_y'
export type TaxAppliesTo = 'food' | 'alcohol' | 'merchandise' | 'all'

export interface DiscountCondition {
  type: 'minimum_amount' | 'item_count' | 'category' | 'time_of_day' | 'day_of_week'
  value: string | number
}

// Constants
export const DISCOUNT_TYPES = [
  'percentage',
  'fixed',
  'buy_x_get_y',
] as const

export const TAX_CATEGORIES = [
  'food',
  'alcohol',
  'merchandise',
  'service',
] as const
