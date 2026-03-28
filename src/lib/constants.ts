// Application Constants
// Shared constant values used across the application

/**
 * Order statuses that count toward revenue in reports.
 * Every report that aggregates sales/revenue MUST use this constant
 * to avoid inconsistent totals across reports.
 */
export const REVENUE_ORDER_STATUSES = ['completed', 'closed', 'paid'] as const

/**
 * Category types for menu organization and reporting
 */
export const CATEGORY_TYPES = [
  { value: 'food', label: 'Food', color: '#22c55e', description: 'Main dishes, appetizers, sides' },
  { value: 'drinks', label: 'Drinks', color: '#3b82f6', description: 'Non-alcoholic beverages' },
  { value: 'liquor', label: 'Liquor', color: '#8b5cf6', description: 'Alcoholic beverages' },
  { value: 'pizza', label: 'Pizza', color: '#ef4444', description: 'Pizza builder — sizes, crusts, toppings' },
  { value: 'entertainment', label: 'Entertainment', color: '#f97316', description: 'Games, rentals, services' },
  { value: 'combos', label: 'Combos', color: '#ec4899', description: 'Combo meals and bundles' },
  { value: 'retail', label: 'Retail', color: '#f59e0b', description: 'Retail products — scanned items, merchandise, inventory tracked' },
] as const

export type CategoryType = typeof CATEGORY_TYPES[number]['value']

/**
 * Status colors for badges and indicators
 */
export const STATUS_COLORS = {
  // Order status
  open: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-700',
  voided: 'bg-red-100 text-red-700',
  refunded: 'bg-yellow-100 text-yellow-700',

  // Item status
  pending: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  preparing: 'bg-yellow-100 text-yellow-700',
  ready: 'bg-green-100 text-green-700',
  served: 'bg-gray-100 text-gray-500',
  comped: 'bg-purple-100 text-purple-700',

  // Account status
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-yellow-100 text-yellow-700',
  depleted: 'bg-orange-100 text-orange-700',
  deactivated: 'bg-red-100 text-red-700',
} as const

/**
 * Pre-modifier options for modifiers
 */
export const PRE_MODIFIERS = ['no', 'light', 'extra', 'side', 'well done', 'medium', 'rare'] as const

/**
 * Payment methods
 */
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: '💵' },
  { value: 'credit', label: 'Credit Card', icon: '💳' },
  { value: 'debit', label: 'Debit Card', icon: '💳' },
  { value: 'gift_card', label: 'Gift Card', icon: '🎁' },
  { value: 'house_account', label: 'House Account', icon: '🏠' },
] as const

/**
 * Days of the week for scheduling
 */
export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
] as const

/**
 * Spirit tiers for liquor selection (Liquor Builder)
 */
export const SPIRIT_TIERS = [
  { value: 'well', label: 'Well', color: '#6b7280', description: 'House spirits' },
  { value: 'call', label: 'Call', color: '#3b82f6', description: 'Named brand spirits' },
  { value: 'premium', label: 'Premium', color: '#a855f7', description: 'Premium brand spirits' },
  { value: 'top_shelf', label: 'Top Shelf', color: '#f59e0b', description: 'Luxury spirits' },
] as const

export type SpiritTier = typeof SPIRIT_TIERS[number]['value']

/**
 * Default liquor settings
 */
export const LIQUOR_DEFAULTS = {
  pourSizeOz: 1.5,
  pourSizeMl: 44.36,
  mlPerOz: 29.5735,
} as const

/**
 * Default pour size multipliers (used by Liquor Builder, BartenderView, validation)
 */
export const DEFAULT_POUR_SIZES: Record<string, number> = {
  shot: 1.0,
  double: 2.0,
  tall: 1.5,
  short: 0.75,
} as const

/**
 * Common bottle sizes (mL)
 */
export const BOTTLE_SIZES = [
  { value: 50, label: '50 mL (Mini)' },
  { value: 200, label: '200 mL (Half Pint)' },
  { value: 375, label: '375 mL (Pint)' },
  { value: 750, label: '750 mL (Fifth)' },
  { value: 1000, label: '1000 mL (Liter)' },
  { value: 1750, label: '1750 mL (Handle)' },
] as const
