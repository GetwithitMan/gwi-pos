/**
 * Socket Emission Invariants
 *
 * These tests verify that critical code paths emit required socket events.
 * They work by static analysis -- scanning the actual source code for emit calls.
 * If someone removes an emit, the test fails.
 *
 * This is NOT a runtime test -- it is a structural invariant test.
 *
 * WHY: Socket emissions are fire-and-forget. If someone accidentally removes an
 * emit call, nothing catches it at runtime. These tests ensure every critical
 * mutation route still contains the socket dispatch calls it must have.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')

function fileContains(relPath: string, ...patterns: string[]): boolean {
  const content = readFileSync(path.join(ROOT, relPath), 'utf-8')
  return patterns.every(p => content.includes(p))
}

function fileContainsAny(relPath: string, ...patterns: string[]): boolean {
  const content = readFileSync(path.join(ROOT, relPath), 'utf-8')
  return patterns.some(p => content.includes(p))
}

// ---------------------------------------------------------------------------
// 1. Payment mutations must emit payment events
// ---------------------------------------------------------------------------

describe('Payment mutations must emit payment events', () => {
  it('pay route emits dispatchPaymentProcessed', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/pay/route.ts',
      'dispatchPaymentProcessed',
    )).toBe(true)
  })

  it('pay route emits emitOrderEvent', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/pay/route.ts',
      'emitOrderEvent',
    )).toBe(true)
  })

  it('pay route emits dispatchOrderClosed for fully paid orders', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/pay/route.ts',
      'dispatchOrderClosed',
    )).toBe(true)
  })

  it('void-payment emits dispatchPaymentProcessed with voided status', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/void-payment/route.ts',
      'dispatchPaymentProcessed',
    )).toBe(true)
  })

  it('void-payment emits emitOrderEvent PAYMENT_VOIDED', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/void-payment/route.ts',
      'emitOrderEvent',
      'PAYMENT_VOIDED',
    )).toBe(true)
  })

  it('void-payment dispatches order totals update', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/void-payment/route.ts',
      'dispatchOrderTotalsUpdate',
    )).toBe(true)
  })

  it('void-payment dispatches open orders changed', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/void-payment/route.ts',
      'dispatchOpenOrdersChanged',
    )).toBe(true)
  })

  it('refund-payment emits emitOrderEvent PAYMENT_VOIDED', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/refund-payment/route.ts',
      'emitOrderEvent',
      'PAYMENT_VOIDED',
    )).toBe(true)
  })

  it('refund-payment dispatches dispatchPaymentProcessed with refunded status', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/refund-payment/route.ts',
      'dispatchPaymentProcessed',
    )).toBe(true)
  })

  it('refund-payment dispatches order totals update', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/refund-payment/route.ts',
      'dispatchOrderTotalsUpdate',
    )).toBe(true)
  })

  it('refund-payment dispatches open orders changed', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/refund-payment/route.ts',
      'dispatchOpenOrdersChanged',
    )).toBe(true)
  })

  it('refund-payment dispatches order summary updated', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/refund-payment/route.ts',
      'dispatchOrderSummaryUpdated',
    )).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Order mutations must emit order events
// ---------------------------------------------------------------------------

describe('Order mutations must emit order events', () => {
  it('send route dispatches KDS events via dispatchNewOrder', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/send/route.ts',
      'dispatchNewOrder',
    )).toBe(true)
  })

  it('send route dispatches open orders changed', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/send/route.ts',
      'dispatchOpenOrdersChanged',
    )).toBe(true)
  })

  it('send route dispatches order summary updated', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/send/route.ts',
      'dispatchOrderSummaryUpdated',
    )).toBe(true)
  })

  it('send route emits ORDER_SENT event', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/send/route.ts',
      'emitOrderEvent',
      'ORDER_SENT',
    )).toBe(true)
  })

  it('comp-void dispatches order totals update', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/comp-void/route.ts',
      'dispatchOrderTotalsUpdate',
    )).toBe(true)
  })

  it('comp-void dispatches open orders changed', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/comp-void/route.ts',
      'dispatchOpenOrdersChanged',
    )).toBe(true)
  })

  it('comp-void dispatches order summary updated', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/comp-void/route.ts',
      'dispatchOrderSummaryUpdated',
    )).toBe(true)
  })

  it('comp-void emits COMP_VOID_APPLIED event', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/comp-void/route.ts',
      'emitOrderEvent',
      'COMP_VOID_APPLIED',
    )).toBe(true)
  })

  it('comp-void dispatches KDS item status for voided items', () => {
    expect(fileContainsAny(
      'src/app/api/orders/[id]/comp-void/route.ts',
      'KDS_ITEM_STATUS',
      'kds:item-status',
    )).toBe(true)
  })

  it('comp-void dispatches order:closed when all items voided', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/comp-void/route.ts',
      'dispatchOrderClosed',
    )).toBe(true)
  })

  it('discount route dispatches order totals update', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/discount/route.ts',
      'dispatchOrderTotalsUpdate',
    )).toBe(true)
  })

  it('discount route dispatches open orders changed', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/discount/route.ts',
      'dispatchOpenOrdersChanged',
    )).toBe(true)
  })

  it('discount route dispatches order summary updated', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/discount/route.ts',
      'dispatchOrderSummaryUpdated',
    )).toBe(true)
  })

  it('discount route emits DISCOUNT_APPLIED event', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/discount/route.ts',
      'emitOrderEvent',
      'DISCOUNT_APPLIED',
    )).toBe(true)
  })

  it('discount route emits DISCOUNT_REMOVED event', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/discount/route.ts',
      'emitOrderEvent',
      'DISCOUNT_REMOVED',
    )).toBe(true)
  })

  it('items route dispatches order totals update', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/items/route.ts',
      'dispatchOrderTotalsUpdate',
    )).toBe(true)
  })

  it('items route dispatches open orders changed', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/items/route.ts',
      'dispatchOpenOrdersChanged',
    )).toBe(true)
  })

  it('items route dispatches order item added', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/items/route.ts',
      'dispatchOrderItemAdded',
    )).toBe(true)
  })

  it('items route dispatches order summary updated', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/items/route.ts',
      'dispatchOrderSummaryUpdated',
    )).toBe(true)
  })

  it('items route emits ITEM_ADDED events', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/items/route.ts',
      'emitOrderEvents',
      'ITEM_ADDED',
    )).toBe(true)
  })

  it('adjust-tip dispatches order totals update', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/adjust-tip/route.ts',
      'dispatchOrderTotalsUpdate',
    )).toBe(true)
  })

  it('adjust-tip dispatches order summary updated', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/adjust-tip/route.ts',
      'dispatchOrderSummaryUpdated',
    )).toBe(true)
  })

  it('adjust-tip dispatches open orders changed', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/adjust-tip/route.ts',
      'dispatchOpenOrdersChanged',
    )).toBe(true)
  })

  it('adjust-tip emits PAYMENT_APPLIED event', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/adjust-tip/route.ts',
      'emitOrderEvent',
      'PAYMENT_APPLIED',
    )).toBe(true)
  })

  it('close-tab emits emitOrderEvent', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/close-tab/route.ts',
      'emitOrderEvent',
    )).toBe(true)
  })

  it('close-tab dispatches dispatchPaymentProcessed', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/close-tab/route.ts',
      'dispatchPaymentProcessed',
    )).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. All critical order mutation routes must import emitOrderEvent
// ---------------------------------------------------------------------------

describe('All critical order mutation routes import emitOrderEvent', () => {
  const ORDER_MUTATION_ROUTES = [
    'src/app/api/orders/[id]/send/route.ts',
    'src/app/api/orders/[id]/pay/route.ts',
    'src/app/api/orders/[id]/comp-void/route.ts',
    'src/app/api/orders/[id]/discount/route.ts',
    'src/app/api/orders/[id]/items/route.ts',
    'src/app/api/orders/[id]/adjust-tip/route.ts',
    'src/app/api/orders/[id]/void-payment/route.ts',
    'src/app/api/orders/[id]/refund-payment/route.ts',
    'src/app/api/orders/[id]/close-tab/route.ts',
  ]

  for (const route of ORDER_MUTATION_ROUTES) {
    it(`${route} imports emitOrderEvent or emitOrderEvents`, () => {
      expect(fileContainsAny(route, 'emitOrderEvent', 'emitOrderEvents')).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// 4. Socket dispatch uses typed event constants
// ---------------------------------------------------------------------------

describe('Socket dispatch uses typed event constants', () => {
  it('socket-dispatch.ts imports SOCKET_EVENTS from socket-events', () => {
    expect(fileContains(
      'src/lib/socket-dispatch.ts',
      'SOCKET_EVENTS',
    )).toBe(true)
  })

  it('socket-dispatch.ts imports from @/lib/socket-events', () => {
    expect(fileContains(
      'src/lib/socket-dispatch.ts',
      "from '@/lib/socket-events'",
    )).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Critical events use QoS 1 (emitCriticalToLocation)
// ---------------------------------------------------------------------------

describe('Critical events use QoS 1 (ack queue)', () => {
  it('socket-dispatch uses emitCriticalToLocation for payment:processed', () => {
    expect(fileContains(
      'src/lib/socket-dispatch.ts',
      'emitCriticalToLocation',
      'PAYMENT_PROCESSED',
    )).toBe(true)
  })

  it('socket-dispatch uses emitCriticalToLocation for order:closed', () => {
    expect(fileContains(
      'src/lib/socket-dispatch.ts',
      'emitCriticalToLocation',
      'ORDER_CLOSED',
    )).toBe(true)
  })

  it('socket-dispatch uses emitCriticalToLocation for order:split-created', () => {
    expect(fileContains(
      'src/lib/socket-dispatch.ts',
      'emitCriticalToLocation',
      'ORDER_SPLIT_CREATED',
    )).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. Cross-terminal sync: mutation routes emit the triple
//    (orders:list-changed + order:totals-updated + order:summary-updated)
// ---------------------------------------------------------------------------

describe('Cross-terminal sync triple (list-changed + totals + summary)', () => {
  const ROUTES_REQUIRING_TRIPLE = [
    'src/app/api/orders/[id]/comp-void/route.ts',
    'src/app/api/orders/[id]/discount/route.ts',
    'src/app/api/orders/[id]/adjust-tip/route.ts',
    'src/app/api/orders/[id]/void-payment/route.ts',
    'src/app/api/orders/[id]/refund-payment/route.ts',
  ]

  for (const route of ROUTES_REQUIRING_TRIPLE) {
    it(`${route} emits dispatchOpenOrdersChanged`, () => {
      expect(fileContains(route, 'dispatchOpenOrdersChanged')).toBe(true)
    })

    it(`${route} emits dispatchOrderTotalsUpdate`, () => {
      expect(fileContains(route, 'dispatchOrderTotalsUpdate')).toBe(true)
    })
  }

  // The summary-updated dispatch was added later and some routes have it
  const ROUTES_REQUIRING_SUMMARY = [
    'src/app/api/orders/[id]/comp-void/route.ts',
    'src/app/api/orders/[id]/discount/route.ts',
    'src/app/api/orders/[id]/adjust-tip/route.ts',
    'src/app/api/orders/[id]/refund-payment/route.ts',
    'src/app/api/orders/[id]/send/route.ts',
    'src/app/api/orders/[id]/items/route.ts',
  ]

  for (const route of ROUTES_REQUIRING_SUMMARY) {
    it(`${route} emits dispatchOrderSummaryUpdated`, () => {
      expect(fileContains(route, 'dispatchOrderSummaryUpdated')).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// 7. CFD update on order-modifying mutations
// ---------------------------------------------------------------------------

describe('CFD display updates on order-modifying mutations', () => {
  it('comp-void dispatches CFD order updated', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/comp-void/route.ts',
      'dispatchCFDOrderUpdated',
    )).toBe(true)
  })

  it('discount route dispatches CFD order updated', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/discount/route.ts',
      'dispatchCFDOrderUpdated',
    )).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8. Entertainment status changes propagate
// ---------------------------------------------------------------------------

describe('Entertainment status changes propagate', () => {
  it('send route dispatches entertainment update for timed rentals', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/send/route.ts',
      'dispatchEntertainmentUpdate',
      'dispatchEntertainmentStatusChanged',
    )).toBe(true)
  })

  it('comp-void dispatches entertainment status reset on void', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/comp-void/route.ts',
      'dispatchEntertainmentStatusChanged',
    )).toBe(true)
  })
})
