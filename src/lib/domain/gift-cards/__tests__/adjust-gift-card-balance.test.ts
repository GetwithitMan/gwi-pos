import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures MockDecimal is available before vi.mock runs
// ---------------------------------------------------------------------------

const MockDecimal = vi.hoisted(() => {
  return class MockDecimal {
    private _value: number
    constructor(v: number | string) { this._value = Number(v) }
    add(other: MockDecimal) { return new MockDecimal(this._value + other._value) }
    sub(other: MockDecimal) { return new MockDecimal(this._value - other._value) }
    isNegative() { return this._value < 0 }
    isZero() { return this._value === 0 }
    greaterThan(other: MockDecimal) { return this._value > other._value }
    toFixed(n: number) { return this._value.toFixed(n) }
    toNumber() { return this._value }
    toString() { return String(this._value) }
    get value() { return this._value }
  }
})

vi.mock('@/generated/prisma/client', () => ({
  Prisma: { Decimal: MockDecimal },
}))

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
import { adjustGiftCardBalance } from '../adjust-gift-card-balance'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockTx(card: Record<string, unknown> | null = null) {
  const updatedCard = { ...card, transactions: [{ id: 'txn-adj' }] }
  return {
    giftCard: {
      findUnique: vi.fn().mockResolvedValue(card),
      update: vi.fn().mockResolvedValue(updatedCard),
    },
  } as unknown as Parameters<typeof adjustGiftCardBalance>[0]
}

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gc-1',
    locationId: 'loc-1',
    cardNumber: 'GC-TEST-1234',
    currentBalance: new MockDecimal(50),
    status: 'active',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('adjustGiftCardBalance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('positive adjustment: balance increases, creates adjustment_credit transaction', async () => {
    const card = makeCard()
    const tx = makeMockTx(card)

    const result = await adjustGiftCardBalance(tx, 'gc-1', 10, 'Goodwill credit', 'emp-1')

    expect(result.success).toBe(true)
    expect(tx.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactions: expect.objectContaining({
            create: expect.objectContaining({
              type: 'adjustment_credit',
            }),
          }),
        }),
      })
    )
  })

  it('negative adjustment: balance decreases, creates adjustment_debit transaction', async () => {
    const card = makeCard()
    const tx = makeMockTx(card)

    const result = await adjustGiftCardBalance(tx, 'gc-1', -10, 'Correction', 'emp-1')

    expect(result.success).toBe(true)
    expect(tx.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactions: expect.objectContaining({
            create: expect.objectContaining({
              type: 'adjustment_debit',
            }),
          }),
        }),
      })
    )
  })

  it('negative adjustment: cannot go below zero (returns error)', async () => {
    const card = makeCard({ currentBalance: new MockDecimal(5) })
    const tx = makeMockTx(card)

    const result = await adjustGiftCardBalance(tx, 'gc-1', -10, 'Too much debit', 'emp-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/insufficient balance/i)
    expect(tx.giftCard.update).not.toHaveBeenCalled()
  })

  it('requires reason (returns error if missing)', async () => {
    const card = makeCard()
    const tx = makeMockTx(card)

    const result = await adjustGiftCardBalance(tx, 'gc-1', 10, '', 'emp-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/reason is required/i)
    expect(tx.giftCard.update).not.toHaveBeenCalled()
  })

  it('reactivates depleted card on positive adjustment', async () => {
    const card = makeCard({
      status: 'depleted',
      currentBalance: new MockDecimal(0),
    })
    const tx = makeMockTx(card)

    const result = await adjustGiftCardBalance(tx, 'gc-1', 25, 'Reactivation', 'emp-1')

    expect(result.success).toBe(true)
    expect(tx.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'active',
        }),
      })
    )
  })

  it('sets depleted when balance reaches zero', async () => {
    const card = makeCard({
      currentBalance: new MockDecimal(10),
    })
    const tx = makeMockTx(card)

    const result = await adjustGiftCardBalance(tx, 'gc-1', -10, 'Full debit', 'emp-1')

    expect(result.success).toBe(true)
    expect(tx.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'depleted',
        }),
      })
    )
  })

  it('ledger row has correct balanceBefore and balanceAfter', async () => {
    const card = makeCard({ currentBalance: new MockDecimal(50) })
    const tx = makeMockTx(card)

    await adjustGiftCardBalance(tx, 'gc-1', 15, 'Ledger check', 'emp-1')

    const updateCall = (tx.giftCard.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const txnCreate = updateCall.data.transactions.create

    // balanceBefore should be 50 (Decimal), balanceAfter should be 65 (Decimal)
    expect(txnCreate.balanceBefore.toNumber()).toBe(50)
    expect(txnCreate.balanceAfter.toNumber()).toBe(65)
  })

  it('returns error when card not found', async () => {
    const tx = makeMockTx(null)

    const result = await adjustGiftCardBalance(tx, 'gc-missing', 10, 'Test', 'emp-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })
})
