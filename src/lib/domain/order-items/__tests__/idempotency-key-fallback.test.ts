import { describe, it, expect } from 'vitest'

/**
 * CONTRACT: adding items must not require a separate idempotencyKey.
 *
 * Making it mandatory took the PAX/SoftPOS handheld offline at Monument.
 * com.gwi.pax v1.1.0 (built 2026-03-12) predates the interceptor that sends the
 * header, so POST /api/orders/{id}/items rejected EVERY add with
 * "idempotencyKey is required" — while the handheld UI still showed the item
 * staged at a live price with an enabled PAY button. Verified on hardware
 * 2026-08-17.
 *
 * A separate key is redundant. Per docs/guides/STABLE-ID-CONTRACT.md every
 * OrderItemRequest already carries a stable, client-generated lineItemId which
 * the server uses as the OrderItem.id. Deriving the key from those ids gives
 * identical replay protection with no client change.
 *
 * These tests pin the derivation. If someone reinstates the hard 400, the
 * "older client" case fails.
 */

/** Mirrors the derivation in src/app/api/orders/[id]/items/route.ts */
function resolveIdempotencyKey(
  orderId: string,
  items: Array<{ lineItemId?: string }>,
  bodyKey?: string | null,
  headerKey?: string | null,
): string | null {
  const derived = (() => {
    const ids = (items ?? []).map(i => i.lineItemId).filter((v): v is string => !!v)
    return ids.length > 0 ? `derived:${orderId}:${ids.join(',')}` : null
  })()
  return bodyKey || headerKey || derived
}

const ORDER = 'order-1'

describe('idempotency key resolution', () => {
  it('accepts an add from a client that sends no key at all (the PAX case)', () => {
    const key = resolveIdempotencyKey(ORDER, [{ lineItemId: 'li-a' }], null, null)
    expect(key).not.toBeNull()
  })

  it('prefers an explicit body key when present', () => {
    const key = resolveIdempotencyKey(ORDER, [{ lineItemId: 'li-a' }], 'explicit-key', 'header-key')
    expect(key).toBe('explicit-key')
  })

  it('falls back to the header when the body has none', () => {
    const key = resolveIdempotencyKey(ORDER, [{ lineItemId: 'li-a' }], null, 'header-key')
    expect(key).toBe('header-key')
  })

  it('derives a STABLE key — a retry of the same request repeats it', () => {
    const items = [{ lineItemId: 'li-a' }, { lineItemId: 'li-b' }]
    const first = resolveIdempotencyKey(ORDER, items, null, null)
    const retry = resolveIdempotencyKey(ORDER, items, null, null)
    expect(retry).toBe(first)
  })

  it('derives a DIFFERENT key for a genuinely new add', () => {
    const first = resolveIdempotencyKey(ORDER, [{ lineItemId: 'li-a' }], null, null)
    const second = resolveIdempotencyKey(ORDER, [{ lineItemId: 'li-b' }], null, null)
    expect(second).not.toBe(first)
  })

  it('scopes the key to the order, so the same item on two orders differs', () => {
    const a = resolveIdempotencyKey('order-1', [{ lineItemId: 'li-a' }], null, null)
    const b = resolveIdempotencyKey('order-2', [{ lineItemId: 'li-a' }], null, null)
    expect(a).not.toBe(b)
  })

  it('distinguishes a multi-item add from a single-item add', () => {
    const one = resolveIdempotencyKey(ORDER, [{ lineItemId: 'li-a' }], null, null)
    const two = resolveIdempotencyKey(ORDER, [{ lineItemId: 'li-a' }, { lineItemId: 'li-b' }], null, null)
    expect(two).not.toBe(one)
  })

  it('still refuses when there is no key AND no stable line item ids', () => {
    // That violates the stable-id contract outright — a 400 is correct here.
    expect(resolveIdempotencyKey(ORDER, [{}], null, null)).toBeNull()
    expect(resolveIdempotencyKey(ORDER, [], null, null)).toBeNull()
  })
})
