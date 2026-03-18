/**
 * Auth Route Invariants
 *
 * Verifies that critical mutation routes have authentication.
 * Scans source files for requirePermission / requireAnyPermission / withVenue.
 *
 * WHY: A missing auth check on a financial mutation route is a critical vulnerability.
 * These tests ensure every route that handles money or sensitive data has an auth gate.
 * If someone adds a new route and forgets auth, this test must be updated to include it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')

function fileContainsAuth(relPath: string): boolean {
  const content = readFileSync(path.join(ROOT, relPath), 'utf-8')
  return (
    content.includes('requirePermission') ||
    content.includes('requireAnyPermission') ||
    content.includes('withAuth') ||
    content.includes('apiRoute')
  )
}

function fileContainsVenueWrapper(relPath: string): boolean {
  const content = readFileSync(path.join(ROOT, relPath), 'utf-8')
  return content.includes('withVenue')
}

// ---------------------------------------------------------------------------
// 1. All critical mutation routes require auth
// ---------------------------------------------------------------------------

describe('Critical mutation routes require authentication', () => {
  const CRITICAL_MUTATION_ROUTES = [
    'src/app/api/orders/[id]/pay/route.ts',
    'src/app/api/orders/[id]/void-payment/route.ts',
    'src/app/api/orders/[id]/refund-payment/route.ts',
    'src/app/api/orders/[id]/comp-void/route.ts',
    'src/app/api/orders/[id]/adjust-tip/route.ts',
    'src/app/api/orders/[id]/discount/route.ts',
    'src/app/api/orders/[id]/send/route.ts',
    'src/app/api/orders/[id]/items/route.ts',
    'src/app/api/employees/[id]/route.ts',
    'src/app/api/settings/route.ts',
  ]

  for (const route of CRITICAL_MUTATION_ROUTES) {
    it(`${route} has auth check (requirePermission or requireAnyPermission)`, () => {
      expect(fileContainsAuth(route)).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// KNOWN GAP: close-tab/route.ts uses withVenue + checkOrderClaim but does NOT
// call requirePermission. This means any authenticated employee can close a tab
// without a specific permission check. This test documents the gap.
// ---------------------------------------------------------------------------
describe('Known auth gaps (documented, pending fix)', () => {
  it('close-tab route does NOT have requirePermission (known gap)', () => {
    expect(fileContainsAuth('src/app/api/orders/[id]/close-tab/route.ts')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. All critical mutation routes use withVenue (multi-tenant isolation)
// ---------------------------------------------------------------------------

describe('Critical mutation routes use withVenue wrapper', () => {
  const VENUE_REQUIRED_ROUTES = [
    'src/app/api/orders/[id]/pay/route.ts',
    'src/app/api/orders/[id]/void-payment/route.ts',
    'src/app/api/orders/[id]/refund-payment/route.ts',
    'src/app/api/orders/[id]/comp-void/route.ts',
    'src/app/api/orders/[id]/close-tab/route.ts',
    'src/app/api/orders/[id]/adjust-tip/route.ts',
    'src/app/api/orders/[id]/discount/route.ts',
    'src/app/api/orders/[id]/send/route.ts',
    'src/app/api/orders/[id]/items/route.ts',
    'src/app/api/employees/[id]/route.ts',
    'src/app/api/settings/route.ts',
    'src/app/api/menu/items/route.ts',
  ]

  for (const route of VENUE_REQUIRED_ROUTES) {
    it(`${route} uses withVenue`, () => {
      expect(fileContainsVenueWrapper(route)).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// 3. Payment routes import PERMISSIONS constants (not hardcoded strings)
// ---------------------------------------------------------------------------

describe('Payment routes use typed PERMISSIONS constants', () => {
  const PAYMENT_ROUTES = [
    'src/app/api/orders/[id]/pay/route.ts',
    'src/app/api/orders/[id]/void-payment/route.ts',
    'src/app/api/orders/[id]/refund-payment/route.ts',
    'src/app/api/orders/[id]/adjust-tip/route.ts',
  ]

  for (const route of PAYMENT_ROUTES) {
    it(`${route} imports PERMISSIONS`, () => {
      const content = readFileSync(path.join(ROOT, route), 'utf-8')
      expect(content.includes('PERMISSIONS')).toBe(true)
    })
  }
})

// ---------------------------------------------------------------------------
// 4. Void and refund routes require manager-level permission
// ---------------------------------------------------------------------------

describe('Void and refund routes require manager permission', () => {
  it('void-payment requires MGR_VOID_PAYMENTS', () => {
    const content = readFileSync(
      path.join(ROOT, 'src/app/api/orders/[id]/void-payment/route.ts'),
      'utf-8'
    )
    expect(content.includes('MGR_VOID_PAYMENTS')).toBe(true)
  })

  it('refund-payment requires MGR_REFUNDS', () => {
    const content = readFileSync(
      path.join(ROOT, 'src/app/api/orders/[id]/refund-payment/route.ts'),
      'utf-8'
    )
    expect(content.includes('MGR_REFUNDS')).toBe(true)
  })

  it('comp-void requires POS_ACCESS + MGR_VOID_ITEMS', () => {
    const content = readFileSync(
      path.join(ROOT, 'src/app/api/orders/[id]/comp-void/route.ts'),
      'utf-8'
    )
    expect(content.includes('POS_ACCESS')).toBe(true)
    expect(content.includes('MGR_VOID_ITEMS')).toBe(true)
  })

  it('adjust-tip requires TIPS_PERFORM_ADJUSTMENTS', () => {
    const content = readFileSync(
      path.join(ROOT, 'src/app/api/orders/[id]/adjust-tip/route.ts'),
      'utf-8'
    )
    expect(content.includes('TIPS_PERFORM_ADJUSTMENTS')).toBe(true)
  })

  it('discount requires MGR_DISCOUNTS', () => {
    const content = readFileSync(
      path.join(ROOT, 'src/app/api/orders/[id]/discount/route.ts'),
      'utf-8'
    )
    expect(content.includes('MGR_DISCOUNTS')).toBe(true)
  })
})
