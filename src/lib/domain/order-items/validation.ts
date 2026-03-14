/**
 * Order Items Validation — PURE functions
 *
 * Input validation for add/update/delete item operations.
 * No DB, no side effects, no framework types.
 */

import { isModifiable } from '@/lib/domain/order-status'
import type {
  AddItemInput,
  ValidationResult,
  MenuItemInfo,
} from './types'

// ─── Add Item Validation ────────────────────────────────────────────────────

/**
 * Validate the items array in a POST /orders/:id/items request.
 * Returns validation error or success. PURE — no DB calls.
 */
export function validateAddItemsInput(items: AddItemInput[]): ValidationResult {
  if (!items || items.length === 0) {
    return { valid: false, error: 'No items provided', status: 400 }
  }

  if (items.length > 500) {
    return { valid: false, error: 'Too many items in a single request (max 500)', status: 400 }
  }

  for (const item of items) {
    if (item.price < 0) {
      return {
        valid: false,
        error: `Item price cannot be negative for "${item.name || item.menuItemId}"`,
        status: 400,
      }
    }
    if (!item.quantity || item.quantity < 1) {
      return {
        valid: false,
        error: `Invalid quantity for item "${item.name || item.menuItemId}": must be at least 1`,
        status: 400,
      }
    }
    if (item.quantity > 999) {
      return {
        valid: false,
        error: `Quantity ${item.quantity} exceeds maximum (999) for item "${item.name || item.menuItemId}"`,
        status: 400,
      }
    }

    // Validate weight-based items
    if (item.soldByWeight) {
      if (!item.weight || item.weight <= 0) {
        return {
          valid: false,
          error: `Weight is required for sold-by-weight item "${item.name || item.menuItemId}"`,
          status: 400,
        }
      }
      if (item.weight > 999) {
        return {
          valid: false,
          error: `Weight ${item.weight} exceeds maximum allowed (999) for item "${item.name || item.menuItemId}"`,
          status: 400,
        }
      }
      if (!item.unitPrice || item.unitPrice <= 0) {
        return {
          valid: false,
          error: `Unit price is required for sold-by-weight item "${item.name || item.menuItemId}"`,
          status: 400,
        }
      }
    }

    // Cap modifier count
    if (item.modifiers && item.modifiers.length > 100) {
      return {
        valid: false,
        error: `Too many modifiers (${item.modifiers.length}) for item "${item.name || item.menuItemId}": max 100`,
        status: 400,
      }
    }

    // Validate ingredient price adjustments
    for (const ing of item.ingredientModifications || []) {
      const adj = Number(ing.priceAdjustment ?? 0)
      if (adj < -50 || adj > 50) {
        return {
          valid: false,
          error: `Ingredient price adjustment $${adj} is outside allowed range (-$50 to $50) for item "${item.name || item.menuItemId}"`,
          status: 400,
        }
      }
    }

    // Pizza price sanity checks
    if (item.pizzaConfig) {
      const breakdown = item.pizzaConfig.priceBreakdown || {} as any
      const componentSum = Number(breakdown.sizePrice ?? 0) + Number(breakdown.crustPrice ?? 0) +
        Number(breakdown.saucePrice ?? 0) + Number(breakdown.cheesePrice ?? 0) + Number(breakdown.toppingsPrice ?? 0)

      if (Math.abs(componentSum - Number(item.pizzaConfig.totalPrice ?? 0)) > 0.05) {
        return {
          valid: false,
          error: `Pizza price breakdown does not match total for item "${item.name || item.menuItemId}"`,
          status: 400,
        }
      }

      if (Number(item.pizzaConfig.totalPrice) > 500) {
        return {
          valid: false,
          error: `Pizza price exceeds maximum ($500) for item "${item.name || item.menuItemId}"`,
          status: 400,
        }
      }
    }
  }

  return { valid: true }
}

// ─── Order Status Guard ─────────────────────────────────────────────────────

/**
 * Validate that an order is in a modifiable state and has no active payments.
 * PURE — operates on fetched data, no DB calls.
 */
export function validateOrderModifiable(
  orderStatus: string,
  payments?: Array<{ status: string }>
): ValidationResult {
  if (!isModifiable(orderStatus)) {
    return {
      valid: false,
      error: `Cannot modify items on order in '${orderStatus}' status`,
      status: 400,
    }
  }

  const hasCompletedPayment = payments?.some(p => p.status === 'completed') || false
  if (hasCompletedPayment) {
    return {
      valid: false,
      error: 'Cannot modify an order with existing payments. Void the payment first.',
      status: 400,
    }
  }

  return { valid: true }
}

/**
 * Validate that an order status allows adding items (used inside transaction
 * where we check via FOR UPDATE locked row).
 */
export function validateOrderStatusForAdd(status: string): ValidationResult {
  if (!['open', 'draft', 'in_progress', 'sent'].includes(status)) {
    return { valid: false, error: 'ORDER_NOT_MODIFIABLE', status: 409 }
  }
  return { valid: true }
}

/**
 * Validate that an order has no active payments (pending or completed).
 */
export function validateNoActivePayments(
  payments?: Array<{ status: string }>
): ValidationResult {
  const hasActivePayment = payments?.some(
    p => p.status === 'completed' || p.status === 'pending'
  ) || false

  if (hasActivePayment) {
    return { valid: false, error: 'ORDER_HAS_PAYMENTS', status: 400 }
  }

  return { valid: true }
}

// ─── Menu Item Availability ─────────────────────────────────────────────────

/**
 * Validate menu item availability (86 check, active, not deleted).
 * PURE — operates on fetched menu item data.
 */
export function validateMenuItemAvailability(menuItems: MenuItemInfo[]): ValidationResult {
  for (const mi of menuItems) {
    if (mi.deletedAt) {
      return { valid: false, error: `ITEM_DELETED:${mi.name}`, status: 400 }
    }
    if (!mi.isActive) {
      return { valid: false, error: `ITEM_INACTIVE:${mi.name}`, status: 400 }
    }
    if (!mi.isAvailable) {
      return { valid: false, error: `ITEM_86D:${mi.name}`, status: 400 }
    }
  }
  return { valid: true }
}

// ─── Delete Item Guards ─────────────────────────────────────────────────────

/**
 * Validate that an item can be deleted (pending kitchen status, active status).
 * PURE — operates on fetched item data.
 */
export function validateItemDeletable(item: {
  kitchenStatus: string | null
  status: string
}): ValidationResult {
  if (item.kitchenStatus !== 'pending') {
    return {
      valid: false,
      error: 'Cannot delete an item that has been sent to the kitchen. Use comp/void instead.',
      status: 400,
    }
  }

  if (item.status !== 'active') {
    return {
      valid: false,
      error: `Cannot delete a ${item.status} item`,
      status: 400,
    }
  }

  return { valid: true }
}

// ─── Update Quantity Validation ─────────────────────────────────────────────

/**
 * Validate quantity value for item updates.
 * PURE — no DB calls.
 */
export function validateUpdateQuantity(quantity: number | undefined): ValidationResult {
  if (quantity !== undefined && quantity < 1) {
    return { valid: false, error: 'Quantity must be at least 1', status: 400 }
  }
  return { valid: true }
}
