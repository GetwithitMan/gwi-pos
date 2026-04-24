/**
 * Structural invariants for `MobileCustomerLinkModal.tsx`.
 *
 * The repo's `vitest.config.ts` runs in the Node environment with no
 * @testing-library / DOM renderer installed, so we cannot mount the component.
 * Instead we mirror the convention from
 * `src/lib/__tests__/socket-emission-invariants.test.ts` — a structural test
 * that fails if anyone removes a load-bearing wire-up.
 *
 * What this guards:
 *   1. Search calls `/api/customers?...&search=` (the canonical POS search route).
 *   2. Search is debounced (300ms) before firing.
 *   3. Customer selection emits `MOBILE_EVENTS.LINK_CUSTOMER_REQUEST` over the
 *      shared socket — NOT a direct HTTP call from the browser.
 *   4. Unlink emits the same event with `customerId: null`.
 *   5. The component listens for `MOBILE_EVENTS.CUSTOMER_LINKED` to surface the
 *      server's success/error echo.
 *   6. Touch targets meet the 48dp minimum (`min-h-[48px]` present).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../../..')
const SOURCE = readFileSync(
  path.join(ROOT, 'src/components/mobile/MobileCustomerLinkModal.tsx'),
  'utf-8',
)

describe('MobileCustomerLinkModal structural invariants', () => {
  it('searches via the canonical POS customer search endpoint', () => {
    expect(SOURCE).toContain('/api/customers?')
    expect(SOURCE).toContain('search:')
  })

  it('debounces search input by 300ms before firing the request', () => {
    expect(SOURCE).toContain('SEARCH_DEBOUNCE_MS = 300')
    expect(SOURCE).toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{[^}]*runSearch/)
  })

  it('emits LINK_CUSTOMER_REQUEST through the shared socket on selection', () => {
    expect(SOURCE).toContain("import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'")
    expect(SOURCE).toContain('MOBILE_EVENTS.LINK_CUSTOMER_REQUEST')
    // The client must NOT call the customer route directly — the link goes
    // through the socket relay so the server is the HTTP caller.
    expect(SOURCE).not.toMatch(/fetch\([^)]*\/api\/orders\/[^)]*\/customer/)
  })

  it('passes orderId, customerId, employeeId, terminalId in the emit payload', () => {
    expect(SOURCE).toContain('orderId,')
    expect(SOURCE).toContain('customerId,')
    expect(SOURCE).toContain('employeeId,')
    expect(SOURCE).toContain('terminalId,')
  })

  it('supports unlink via customerId: null', () => {
    expect(SOURCE).toContain('emitLink(null)')
  })

  it('listens for the server CUSTOMER_LINKED echo to confirm or surface errors', () => {
    expect(SOURCE).toContain('MOBILE_EVENTS.CUSTOMER_LINKED')
    expect(SOURCE).toContain('socket.on(MOBILE_EVENTS.CUSTOMER_LINKED')
    expect(SOURCE).toContain('socket.off(MOBILE_EVENTS.CUSTOMER_LINKED')
  })

  it('shows the linked-customer pinned row with a Remove (unlink) action', () => {
    expect(SOURCE).toMatch(/currentCustomer/)
    expect(SOURCE).toMatch(/Remove/)
    expect(SOURCE).toMatch(/handleUnlink/)
  })

  it('surfaces server error messages from the CUSTOMER_LINKED echo', () => {
    expect(SOURCE).toContain('setErrorMessage(data.error')
  })

  it('respects the 48dp mobile touch-target minimum', () => {
    expect(SOURCE).toContain('min-h-[48px]')
  })

  it('refuses to link a banned customer client-side', () => {
    expect(SOURCE).toContain('customer.isBanned')
    expect(SOURCE).toMatch(/banned/i)
  })
})
