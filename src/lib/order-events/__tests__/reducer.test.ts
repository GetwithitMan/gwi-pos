/**
 * Golden-master reducer tests
 *
 * These test vectors are shared between Android (Kotlin) and NUC (TypeScript).
 * The same JSON fixtures live in gwi-android-register/app/src/test/resources/events/.
 * Both platforms must produce identical OrderState for the same event sequence.
 */

import { describe, it, expect } from 'vitest'
import { replay } from '../reducer'
import {
  type OrderEventPayload,
  type OrderState,
  getSubtotalCents,
  getDiscountTotalCents,
  getItemTotalCents,
  getPaidAmountCents,
  getItemCount,
} from '../types'

// ── Fixtures ────────────────────────────────────────────────────────

import createAndAddItems from './fixtures/create-and-add-items.json'
import addRemoveItems from './fixtures/add-remove-items.json'
import discountFlow from './fixtures/discount-flow.json'
import paymentFlow from './fixtures/payment-flow.json'
import compVoidFlow from './fixtures/comp-void-flow.json'
import tabLifecycle from './fixtures/tab-lifecycle.json'
import closedOrderGuard from './fixtures/closed-order-guard.json'
import updateMetadataFlow from './fixtures/update-metadata-flow.json'
import paymentCloseFlow from './fixtures/payment-close-flow.json'

// ── Helpers ─────────────────────────────────────────────────────────

interface TestVector {
  description: string
  orderId: string
  events: Array<{ type: string; payload: Record<string, unknown> }>
  expectedState: {
    orderId: string
    status?: string
    locationId?: string
    tabStatus?: string
    subtotalCents?: number
    discountTotalCents?: number
    paidAmountCents?: number
    itemCount?: number
    isClosed?: boolean
    items?: Record<
      string,
      {
        name?: string
        priceCents?: number
        quantity?: number
        totalCents?: number
        status?: string
        kitchenStatus?: string | null
        isHeld?: boolean
      }
    >
  }
}

function runVector(vector: TestVector) {
  const events = vector.events as OrderEventPayload[]
  const state = replay(vector.orderId, events)
  const expected = vector.expectedState

  if (expected.orderId !== undefined) {
    expect(state.orderId).toBe(expected.orderId)
  }
  if (expected.status !== undefined) {
    expect(state.status).toBe(expected.status)
  }
  if (expected.locationId !== undefined) {
    expect(state.locationId).toBe(expected.locationId)
  }
  if (expected.tabStatus !== undefined) {
    expect(state.tabStatus).toBe(expected.tabStatus)
  }
  if (expected.subtotalCents !== undefined) {
    expect(getSubtotalCents(state)).toBe(expected.subtotalCents)
  }
  if (expected.discountTotalCents !== undefined) {
    expect(getDiscountTotalCents(state)).toBe(expected.discountTotalCents)
  }
  if (expected.paidAmountCents !== undefined) {
    expect(getPaidAmountCents(state)).toBe(expected.paidAmountCents)
  }
  if (expected.itemCount !== undefined) {
    expect(getItemCount(state)).toBe(expected.itemCount)
  }
  if (expected.isClosed !== undefined) {
    expect(state.isClosed).toBe(expected.isClosed)
  }
  if (expected.items !== undefined) {
    for (const [itemId, expectedItem] of Object.entries(expected.items)) {
      const item = state.items[itemId]
      expect(item, `Expected item ${itemId} to exist`).toBeDefined()
      if (!item) continue

      if (expectedItem.name !== undefined) {
        expect(item.name).toBe(expectedItem.name)
      }
      if (expectedItem.priceCents !== undefined) {
        expect(item.priceCents).toBe(expectedItem.priceCents)
      }
      if (expectedItem.quantity !== undefined) {
        expect(item.quantity).toBe(expectedItem.quantity)
      }
      if (expectedItem.totalCents !== undefined) {
        expect(getItemTotalCents(item)).toBe(expectedItem.totalCents)
      }
      if (expectedItem.status !== undefined) {
        expect(item.status).toBe(expectedItem.status)
      }
      if (expectedItem.kitchenStatus !== undefined) {
        expect(item.kitchenStatus).toBe(expectedItem.kitchenStatus)
      }
      if (expectedItem.isHeld !== undefined) {
        expect(item.isHeld).toBe(expectedItem.isHeld)
      }
    }
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('OrderReducer — Golden-master test vectors', () => {
  it('1. Create order and add 3 items, verify totals', () => {
    runVector(createAndAddItems as TestVector)
  })

  it('2. Add 3 items, remove 1, verify 2 remain', () => {
    runVector(addRemoveItems as TestVector)
  })

  it('3. Order + item discounts, verify totals', () => {
    runVector(discountFlow as TestVector)
  })

  it('4. Full lifecycle: create → add → send → pay → close', () => {
    runVector(paymentFlow as TestVector)
  })

  it('5. Comp one item, void another — subtotal excludes both', () => {
    runVector(compVoidFlow as TestVector)
  })

  it('6. Tab lifecycle: open → add → close, verify tabStatus', () => {
    runVector(tabLifecycle as TestVector)
  })

  it('7. Closed order guard: item add after close is rejected', () => {
    runVector(closedOrderGuard as TestVector)
  })

  it('8. Update metadata: guest count, notes, table/employee', () => {
    runVector(updateMetadataFlow as TestVector)
  })

  it('9. Payment void + re-pay + close', () => {
    runVector(paymentCloseFlow as TestVector)
  })
})

// ── Additional reducer unit tests ────────────────────────────────────

describe('OrderReducer — Unit tests', () => {
  it('replay with empty events returns emptyOrderState', () => {
    const state = replay('empty-order', [])
    expect(state.orderId).toBe('empty-order')
    expect(state.status).toBe('open')
    expect(state.isClosed).toBe(false)
    expect(Object.keys(state.items)).toHaveLength(0)
    expect(Object.keys(state.payments)).toHaveLength(0)
    expect(Object.keys(state.discounts)).toHaveLength(0)
  })

  it('duplicate ITEM_ADDED (same lineItemId) is idempotent', () => {
    const events: OrderEventPayload[] = [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId: 'loc-1',
          employeeId: 'emp-1',
          orderType: 'dine_in',
          guestCount: 1,
          orderNumber: 1,
        },
      },
      {
        type: 'ITEM_ADDED',
        payload: {
          lineItemId: 'x1',
          menuItemId: 'm1',
          name: 'Beer',
          priceCents: 600,
          quantity: 1,
          isHeld: false,
          soldByWeight: false,
        },
      },
      {
        type: 'ITEM_ADDED',
        payload: {
          lineItemId: 'x1',
          menuItemId: 'm1',
          name: 'Beer (dup)',
          priceCents: 999,
          quantity: 5,
          isHeld: false,
          soldByWeight: false,
        },
      },
    ]
    const state = replay('dup-test', events)
    expect(Object.keys(state.items)).toHaveLength(1)
    expect(state.items['x1'].name).toBe('Beer') // first one wins
    expect(state.items['x1'].priceCents).toBe(600)
  })

  it('duplicate PAYMENT_APPLIED (same paymentId) is idempotent', () => {
    const events: OrderEventPayload[] = [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId: 'loc-1',
          employeeId: 'emp-1',
          orderType: 'dine_in',
          guestCount: 1,
          orderNumber: 1,
        },
      },
      {
        type: 'PAYMENT_APPLIED',
        payload: {
          paymentId: 'p1',
          method: 'cash',
          amountCents: 1000,
          tipCents: 0,
          totalCents: 1000,
          status: 'approved',
        },
      },
      {
        type: 'PAYMENT_APPLIED',
        payload: {
          paymentId: 'p1',
          method: 'card',
          amountCents: 9999,
          tipCents: 500,
          totalCents: 10499,
          status: 'approved',
        },
      },
    ]
    const state = replay('pay-dup-test', events)
    expect(Object.keys(state.payments)).toHaveLength(1)
    expect(state.payments['p1'].method).toBe('cash') // first one wins
    expect(state.payments['p1'].totalCents).toBe(1000)
  })

  it('ORDER_REOPENED allows new items after ORDER_CLOSED', () => {
    const events: OrderEventPayload[] = [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId: 'loc-1',
          employeeId: 'emp-1',
          orderType: 'dine_in',
          guestCount: 1,
          orderNumber: 1,
        },
      },
      {
        type: 'ITEM_ADDED',
        payload: {
          lineItemId: 'i1',
          menuItemId: 'm1',
          name: 'Salad',
          priceCents: 1100,
          quantity: 1,
          isHeld: false,
          soldByWeight: false,
        },
      },
      {
        type: 'ORDER_CLOSED',
        payload: { closedStatus: 'paid' },
      },
      {
        type: 'ORDER_REOPENED',
        payload: {},
      },
      {
        type: 'ITEM_ADDED',
        payload: {
          lineItemId: 'i2',
          menuItemId: 'm2',
          name: 'Dessert',
          priceCents: 800,
          quantity: 1,
          isHeld: false,
          soldByWeight: false,
        },
      },
    ]
    const state = replay('reopen-test', events)
    expect(state.status).toBe('open')
    expect(state.isClosed).toBe(false)
    expect(Object.keys(state.items)).toHaveLength(2)
    expect(state.items['i2'].name).toBe('Dessert')
  })

  it('ITEM_REMOVED for non-existent item is a no-op', () => {
    const events: OrderEventPayload[] = [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId: 'loc-1',
          employeeId: 'emp-1',
          orderType: 'dine_in',
          guestCount: 1,
          orderNumber: 1,
        },
      },
      {
        type: 'ITEM_REMOVED',
        payload: { lineItemId: 'nonexistent' },
      },
    ]
    const state = replay('remove-missing', events)
    expect(Object.keys(state.items)).toHaveLength(0)
  })

  it('DISCOUNT_REMOVED for non-existent discount is a no-op', () => {
    const events: OrderEventPayload[] = [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId: 'loc-1',
          employeeId: 'emp-1',
          orderType: 'dine_in',
          guestCount: 1,
          orderNumber: 1,
        },
      },
      {
        type: 'DISCOUNT_REMOVED',
        payload: { discountId: 'nonexistent' },
      },
    ]
    const state = replay('discount-remove-missing', events)
    expect(Object.keys(state.discounts)).toHaveLength(0)
  })

  it('COMP_VOID_APPLIED unvoid restores to active', () => {
    const events: OrderEventPayload[] = [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId: 'loc-1',
          employeeId: 'emp-1',
          orderType: 'dine_in',
          guestCount: 1,
          orderNumber: 1,
        },
      },
      {
        type: 'ITEM_ADDED',
        payload: {
          lineItemId: 'i1',
          menuItemId: 'm1',
          name: 'Wings',
          priceCents: 1200,
          quantity: 1,
          isHeld: false,
          soldByWeight: false,
        },
      },
      {
        type: 'COMP_VOID_APPLIED',
        payload: {
          lineItemId: 'i1',
          action: 'void',
          employeeId: 'emp-1',
        },
      },
      {
        type: 'COMP_VOID_APPLIED',
        payload: {
          lineItemId: 'i1',
          action: 'unvoid',
          employeeId: 'emp-1',
        },
      },
    ]
    const state = replay('unvoid-test', events)
    expect(state.items['i1'].status).toBe('active')
    expect(getItemCount(state)).toBe(1)
    expect(getSubtotalCents(state)).toBe(1200)
  })

  it('weight-based item pricing is correct', () => {
    const events: OrderEventPayload[] = [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId: 'loc-1',
          employeeId: 'emp-1',
          orderType: 'dine_in',
          guestCount: 1,
          orderNumber: 1,
        },
      },
      {
        type: 'ITEM_ADDED',
        payload: {
          lineItemId: 'w1',
          menuItemId: 'mw1',
          name: 'Ribeye',
          priceCents: 0,
          quantity: 1,
          soldByWeight: true,
          weight: 1.5,
          unitPriceCents: 2000,
          weightUnit: 'lb',
          isHeld: false,
        },
      },
    ]
    const state = replay('weight-test', events)
    // 1.5 * 2000 = 3000
    expect(getItemTotalCents(state.items['w1'])).toBe(3000)
    expect(getSubtotalCents(state)).toBe(3000)
  })

  it('ORDER_SENT with empty sentItemIds fires all unheld items', () => {
    const events: OrderEventPayload[] = [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId: 'loc-1',
          employeeId: 'emp-1',
          orderType: 'dine_in',
          guestCount: 1,
          orderNumber: 1,
        },
      },
      {
        type: 'ITEM_ADDED',
        payload: {
          lineItemId: 'i1',
          menuItemId: 'm1',
          name: 'Pizza',
          priceCents: 1800,
          quantity: 1,
          isHeld: false,
          soldByWeight: false,
        },
      },
      {
        type: 'ITEM_ADDED',
        payload: {
          lineItemId: 'i2',
          menuItemId: 'm2',
          name: 'Held Wings',
          priceCents: 1200,
          quantity: 1,
          isHeld: true,
          soldByWeight: false,
        },
      },
      {
        type: 'ORDER_SENT',
        payload: { sentItemIds: [] },
      },
    ]
    const state = replay('send-all-test', events)
    expect(state.status).toBe('sent')
    expect(state.items['i1'].kitchenStatus).toBe('FIRED')
    // Held item stays held — sendAll doesn't fire held items
    expect(state.items['i2'].kitchenStatus).toBeNull()
    expect(state.items['i2'].isHeld).toBe(true)
  })

  it('TAB_OPENED sets hasPreAuth and cardLast4', () => {
    const events: OrderEventPayload[] = [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId: 'loc-1',
          employeeId: 'emp-1',
          orderType: 'bar_tab',
          guestCount: 1,
          orderNumber: 1,
        },
      },
      {
        type: 'TAB_OPENED',
        payload: {
          cardLast4: '9876',
          preAuthId: 'auth-123',
          tabName: 'John',
        },
      },
    ]
    const state = replay('tab-test', events)
    expect(state.hasPreAuth).toBe(true)
    expect(state.cardLast4).toBe('9876')
    expect(state.tabName).toBe('John')
    expect(state.tabStatus).toBe('open')
  })
})
