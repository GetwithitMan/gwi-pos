/**
 * Order Items Domain Module
 *
 * Extracted business logic for order item add/update/delete operations.
 * Routes keep HTTP handling, withVenue, socket dispatch, and event emission.
 *
 * Three-bucket pattern:
 * - types.ts        — domain types, no imports
 * - validation.ts   — PURE input validation
 * - item-calculations.ts — PURE price/modifier/tax calculations
 * - order-totals.ts — ORCHESTRATION (TxClient) — totals recalculation
 * - item-operations.ts — ORCHESTRATION (TxClient) — DB create/update/delete
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  TxClient,
  AddItemInput,
  UpdateItemInput,
  ModifierInput,
  IngredientModificationInput,
  PizzaConfig,
  PizzaPriceBreakdown,
  ItemAction,
  ValidationResult,
  ValidationSuccess,
  ValidationError,
  MenuItemInfo,
  ItemPrepData,
  OrderTotalsUpdate,
} from './types'

// ─── Validation (PURE) ─────────────────────────────────────────────────────

export {
  validateAddItemsInput,
  validateOrderModifiable,
  validateOrderStatusForAdd,
  validateNoActivePayments,
  validateMenuItemAvailability,
  validateItemDeletable,
  validateUpdateQuantity,
} from './validation'

// ─── Calculations (PURE) ───────────────────────────────────────────────────

export {
  isValidModifierId,
  calculateEffectivePrice,
  prepareItemData,
  prepareAllItemsData,
  deriveTaxInclusiveSettings,
  calculateItemCardPrice,
  hasOpenPricedItems,
  overrideModifierPrices,
  calculateLiveModifierTotal,
  calculateUpdatedItemTotal,
} from './item-calculations'

// ─── Order Totals (ORCHESTRATION — TxClient) ───────────────────────────────

export {
  mapItemsForCalculation,
  recalculateOrderTotals,
  recalculateOrderTotalsForAdd,
  recalculateParentOrderTotals,
} from './order-totals'

// ─── Item Operations (ORCHESTRATION — TxClient) ────────────────────────────

export {
  createOrderItem,
  softDeleteOrderItem,
  fetchLiveModifierTotal,
  validateComboComponents,
  fetchModifierPrices,
} from './item-operations'

export type { CreateOrderItemParams, ComboValidationError } from './item-operations'
