'use client'

// ─── DEPRECATED: Use domain-specific stores directly ────────────────────────
// This file re-exports from the new focused stores for backward compatibility.
// New code should import from:
//   - @/stores/modifier-flow-store  (modifiers, pizza, combo, entertainment, timed rental, weight, age verification, allergens)
//   - @/stores/payment-flow-store   (payment, card tab, split tickets)
//   - @/stores/discount-flow-store  (discounts, comp/void)
//   - @/stores/order-ui-store       (tabs panel, receipts, resend, transfers, notes, shift, display settings)
// ─────────────────────────────────────────────────────────────────────────────

import { useModifierFlowStore } from './modifier-flow-store'
import { usePaymentFlowStore } from './payment-flow-store'
import { useDiscountFlowStore } from './discount-flow-store'
import { useOrderUiStore } from './order-ui-store'

// ─── Re-exported Types ──────────────────────────────────────────────────────

export type { EntertainmentItemData } from './modifier-flow-store'
export type { SplitChip, TabCardInfo } from './payment-flow-store'
export type { ResendModalData } from './order-ui-store'

// ─── Re-export domain stores ────────────────────────────────────────────────

export { useModifierFlowStore } from './modifier-flow-store'
export { usePaymentFlowStore } from './payment-flow-store'
export { useDiscountFlowStore } from './discount-flow-store'
export { useOrderUiStore } from './order-ui-store'

// ─── Unified facade store (backward compatibility) ──────────────────────────
// Composes all four domain stores into a single hook with the original API.
// WARNING: This causes re-renders on ANY state change across all domains.
// Prefer using the individual domain stores for better render performance.

export function useOrderPageStore<T>(selector: (state: any) => T): T {
  const modifierVal = useModifierFlowStore(s => s)
  const paymentVal = usePaymentFlowStore(s => s)
  const discountVal = useDiscountFlowStore(s => s)
  const uiVal = useOrderUiStore(s => s)

  const combined = {
    ...modifierVal,
    ...paymentVal,
    ...discountVal,
    ...uiVal,
    // Unified reset
    reset: () => {
      modifierVal.reset()
      paymentVal.reset()
      discountVal.reset()
      uiVal.reset()
    },
  }

  return selector(combined)
}

// Static getState() for imperative access (e.g., inside callbacks)
useOrderPageStore.getState = () => {
  const modifier = useModifierFlowStore.getState()
  const payment = usePaymentFlowStore.getState()
  const discount = useDiscountFlowStore.getState()
  const ui = useOrderUiStore.getState()

  return {
    ...modifier,
    ...payment,
    ...discount,
    ...ui,
    reset: () => {
      modifier.reset()
      payment.reset()
      discount.reset()
      ui.reset()
    },
  }
}
