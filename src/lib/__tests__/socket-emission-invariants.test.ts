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

/**
 * Check that patterns exist across a route AND its extracted domain modules.
 * The pay route was decomposed — socket emissions moved to domain layer files.
 * This helper concatenates all sources so structural invariant checks still pass.
 */
function filesContain(relPaths: string[], ...patterns: string[]): boolean {
  const combined = relPaths
    .map(p => readFileSync(path.join(ROOT, p), 'utf-8'))
    .join('\n')
  return patterns.every(p => combined.includes(p))
}

function filesContainAny(relPaths: string[], ...patterns: string[]): boolean {
  const combined = relPaths
    .map(p => readFileSync(path.join(ROOT, p), 'utf-8'))
    .join('\n')
  return patterns.some(p => combined.includes(p))
}

// The pay route was decomposed into domain modules — check the route + all its extracted modules
const PAY_ROUTE_FILES = [
  'src/app/api/orders/[id]/pay/route.ts',
  'src/lib/domain/payment/effects/run-payment-post-commit-effects.ts',
  'src/lib/domain/payment/context/build-payment-financial-context.ts',
  'src/lib/domain/payment/commit/commit-payment-transaction.ts',
]

// ---------------------------------------------------------------------------
// 1. Payment mutations must emit payment events
// ---------------------------------------------------------------------------

describe('Payment mutations must emit payment events', () => {
  it('pay route (+ extracted modules) emits dispatchPaymentProcessed', () => {
    expect(filesContain(
      PAY_ROUTE_FILES,
      'dispatchPaymentProcessed',
    )).toBe(true)
  })

  it('pay route (+ extracted modules) emits emitOrderEvent', () => {
    expect(filesContain(
      PAY_ROUTE_FILES,
      'emitOrderEvent',
    )).toBe(true)
  })

  it('pay route (+ extracted modules) emits dispatchOrderClosed for fully paid orders', () => {
    expect(filesContain(
      PAY_ROUTE_FILES,
      'dispatchOrderClosed',
    )).toBe(true)
  })

  it('pay post-commit effects dispatch CFD receipt to the paired CFD terminal', () => {
    expect(fileContains(
      'src/lib/domain/payment/effects/run-payment-post-commit-effects.ts',
      'resolvePairedCfdTerminalId',
      'dispatchCFDReceiptSent',
    )).toBe(true)
  })

  it('pay-all-splits dispatches CFD receipt to the paired CFD terminal', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/pay-all-splits/route.ts',
      'resolvePairedCfdTerminalId',
      'dispatchCFDReceiptSent',
    )).toBe(true)
  })

  it('split route refreshes the paired CFD for item-moving splits', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/split/route.ts',
      'resolvePairedCfdTerminalId',
      'dispatchCFDShowOrder',
    )).toBe(true)
  })

  it('merge route refreshes the CFD display and idles the paired terminal', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/merge/route.ts',
      'dispatchCFDOrderUpdated',
      'resolvePairedCfdTerminalId',
      'dispatchCFDIdle',
    )).toBe(true)
  })

  it('transfer-items route refreshes both CFD orders and idles the paired terminal on source cancel', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/transfer-items/route.ts',
      'dispatchCFDOrderUpdated',
      'resolvePairedCfdTerminalId',
      'dispatchCFDIdle',
    )).toBe(true)
  })

  it('void-tab route idles the paired CFD terminal when the tab is fully voided', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/void-tab/route.ts',
      'resolvePairedCfdTerminalId',
      'dispatchCFDIdle',
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

  it('void-payment refreshes or idles the paired CFD terminal', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/void-payment/route.ts',
      'resolvePairedCfdTerminalId',
      'dispatchCFDOrderUpdated',
      'dispatchCFDIdle',
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

  it('refund-payment refreshes the CFD display', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/refund-payment/route.ts',
      'dispatchCFDOrderUpdated',
    )).toBe(true)
  })

  it('retry-capture dispatches CFD completion events', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/retry-capture/route.ts',
      'resolvePairedCfdTerminalId',
      'dispatchCFDReceiptSent',
      'dispatchCFDIdle',
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

  it('close-tab dispatches CFD payment lifecycle events', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/close-tab/route.ts',
      'dispatchCFDPaymentStarted',
      'dispatchCFDProcessing',
      'dispatchCFDApproved',
      'dispatchCFDDeclined',
      'dispatchCFDReceiptSent',
    )).toBe(true)
  })

  it('pre-auth start-tab route dispatches tab updates', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/pre-auth/route.ts',
      'dispatchTabUpdated',
      'dispatchTabStatusUpdate',
      'dispatchOpenOrdersChanged',
    )).toBe(true)
  })

  it('cards route dispatches tab updates when adding another card', () => {
    expect(fileContains(
      'src/app/api/orders/[id]/cards/route.ts',
      'dispatchTabUpdated',
      'dispatchTabStatusUpdate',
      'dispatchOpenOrdersChanged',
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
      // The pay route was decomposed — socket emissions live in extracted domain modules
      const filesToCheck = route.includes('/pay/route.ts') ? PAY_ROUTE_FILES : [route]
      expect(filesContainAny(filesToCheck, 'emitOrderEvent', 'emitOrderEvents')).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// 4. Socket dispatch uses typed event constants
// ---------------------------------------------------------------------------

describe('Socket dispatch uses typed event constants', () => {
  it('socket-events.ts exports SOCKET_EVENTS constant map', () => {
    expect(fileContains(
      'src/lib/socket-events.ts',
      'SOCKET_EVENTS',
    )).toBe(true)
  })

  it('socket-dispatch barrel re-exports from domain sub-modules', () => {
    expect(fileContains(
      'src/lib/socket-dispatch.ts',
      './socket-dispatch/order-dispatch',
      './socket-dispatch/payment-dispatch',
    )).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Critical events use QoS 1 (emitCriticalToLocation)
// ---------------------------------------------------------------------------

describe('Critical events use QoS 1 (ack queue)', () => {
  it('payment-dispatch uses emitCriticalToLocation for payment:processed', () => {
    expect(fileContains(
      'src/lib/socket-dispatch/payment-dispatch.ts',
      'emitCriticalToLocation',
      'payment:processed',
    )).toBe(true)
  })

  it('payment-dispatch uses emitCriticalToLocation for order:closed (split parent auto-close)', () => {
    expect(fileContains(
      'src/lib/socket-dispatch/payment-dispatch.ts',
      'emitCriticalToLocation',
      'order:closed',
    )).toBe(true)
  })

  it('order-dispatch uses emitCriticalToLocation for order:split-created', () => {
    expect(fileContains(
      'src/lib/socket-dispatch/order-dispatch.ts',
      'emitCriticalToLocation',
      'order:split-created',
    )).toBe(true)
  })

  it('order-dispatch uses emitCriticalToLocation for order:closed', () => {
    expect(fileContains(
      'src/lib/socket-dispatch/order-dispatch.ts',
      'emitCriticalToLocation',
      'order:closed',
    )).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. Cross-terminal sync: mutation routes emit the triple
//    (orders:list-changed + order:totals-updated + order:summary-updated)
// ---------------------------------------------------------------------------

describe('Cross-terminal sync triple (list-changed + totals + summary)', () => {
  // Routes that emit all three: dispatchOpenOrdersChanged + dispatchOrderTotalsUpdate + dispatchOrderSummaryUpdated
  const ROUTES_REQUIRING_TRIPLE = [
    'src/app/api/orders/[id]/comp-void/route.ts',
    'src/app/api/orders/[id]/adjust-tip/route.ts',
    'src/app/api/orders/[id]/refund-payment/route.ts',
    'src/app/api/orders/[id]/items/route.ts',
  ]

  for (const route of ROUTES_REQUIRING_TRIPLE) {
    it(`${route} emits dispatchOpenOrdersChanged`, () => {
      expect(fileContains(route, 'dispatchOpenOrdersChanged')).toBe(true)
    })

    it(`${route} emits dispatchOrderTotalsUpdate`, () => {
      expect(fileContains(route, 'dispatchOrderTotalsUpdate')).toBe(true)
    })

    it(`${route} emits dispatchOrderSummaryUpdated`, () => {
      expect(fileContains(route, 'dispatchOrderSummaryUpdated')).toBe(true)
    })
  }

  // void-payment emits the pair (list-changed + totals) but not summary-updated
  const ROUTES_REQUIRING_PAIR = [
    'src/app/api/orders/[id]/void-payment/route.ts',
  ]

  for (const route of ROUTES_REQUIRING_PAIR) {
    it(`${route} emits dispatchOpenOrdersChanged`, () => {
      expect(fileContains(route, 'dispatchOpenOrdersChanged')).toBe(true)
    })

    it(`${route} emits dispatchOrderTotalsUpdate`, () => {
      expect(fileContains(route, 'dispatchOrderTotalsUpdate')).toBe(true)
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
