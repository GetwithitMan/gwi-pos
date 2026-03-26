import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processGiftCardPayment } from '../gift-card'
import type { PaymentInput, PaymentRecord } from '../../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockTx(card: Record<string, unknown> | null = null) {
  return {
    giftCard: {
      findUnique: vi.fn().mockResolvedValue(card),
      findUniqueOrThrow: vi.fn().mockResolvedValue(card),
      update: vi.fn().mockResolvedValue({}),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  } as unknown as Parameters<typeof processGiftCardPayment>[0]
}

function makePaymentInput(overrides: Partial<PaymentInput> = {}): PaymentInput {
  return {
    method: 'gift_card',
    amount: 20,
    giftCardId: 'gc-1',
    ...overrides,
  } as PaymentInput
}

function makePaymentRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    locationId: 'loc-1',
    orderId: 'order-1',
    employeeId: 'emp-1',
    amount: 20,
    tipAmount: 0,
    totalAmount: 20,
    paymentMethod: 'gift_card' as any,
    status: 'pending' as any,
    ...overrides,
  } as PaymentRecord
}

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gc-1',
    locationId: 'loc-1',
    cardNumber: 'GC-TEST-1234-5678',
    currentBalance: 50,
    status: 'active',
    expiresAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processGiftCardPayment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns error when acceptGiftCards is false', async () => {
    const tx = makeMockTx()
    const result = await processGiftCardPayment(
      tx,
      makePaymentInput(),
      makePaymentRecord(),
      'order-1', 'loc-1', 100, 'emp-1',
      false // acceptGiftCards
    )

    expect(result.error).toMatch(/not accepted/i)
    expect(result.errorStatus).toBe(400)
  })

  it('returns error when card not found', async () => {
    const tx = makeMockTx(null)

    const result = await processGiftCardPayment(
      tx,
      makePaymentInput(),
      makePaymentRecord(),
      'order-1', 'loc-1', 100, 'emp-1',
      true
    )

    expect(result.error).toMatch(/not found/i)
    expect(result.errorStatus).toBe(404)
  })

  it('returns error for non-active card status', async () => {
    const card = makeCard({ status: 'frozen' })
    const tx = makeMockTx(card)

    const result = await processGiftCardPayment(
      tx,
      makePaymentInput(),
      makePaymentRecord(),
      'order-1', 'loc-1', 100, 'emp-1',
      true
    )

    expect(result.error).toMatch(/frozen/i)
    expect(result.errorStatus).toBe(400)
  })

  it('returns error for expired card', async () => {
    const card = makeCard({
      expiresAt: new Date(Date.now() - 86_400_000), // yesterday
    })
    const tx = makeMockTx(card)

    const result = await processGiftCardPayment(
      tx,
      makePaymentInput(),
      makePaymentRecord(),
      'order-1', 'loc-1', 100, 'emp-1',
      true
    )

    expect(result.error).toMatch(/expired/i)
    expect(result.errorStatus).toBe(400)
    // Should also update the card status to expired
    expect(tx.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'expired' },
      })
    )
  })

  it('returns error for insufficient balance', async () => {
    const card = makeCard({ currentBalance: 5 })
    const tx = makeMockTx(card)

    const result = await processGiftCardPayment(
      tx,
      makePaymentInput({ amount: 20 }),
      makePaymentRecord(),
      'order-1', 'loc-1', 100, 'emp-1',
      true
    )

    expect(result.error).toMatch(/insufficient/i)
    expect(result.errorStatus).toBe(400)
    expect(result.errorExtras?.currentBalance).toBe(5)
  })

  it('successful deduction: decrements balance, creates transaction', async () => {
    const card = makeCard({ currentBalance: 50 })
    const tx = makeMockTx(card)

    const result = await processGiftCardPayment(
      tx,
      makePaymentInput({ amount: 20 }),
      makePaymentRecord(),
      'order-1', 'loc-1', 100, 'emp-1',
      true
    )

    expect(result.error).toBeUndefined()
    expect(result.record.transactionId).toBe('GC:GC-TEST-1234-5678')
    expect(result.record.cardLast4).toBe('5678')
    expect(tx.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentBalance: 30,
          status: 'active',
          transactions: expect.objectContaining({
            create: expect.objectContaining({
              type: 'redemption',
              amount: -20,
              balanceBefore: 50,
              balanceAfter: 30,
            }),
          }),
        }),
      })
    )
  })

  it('sets depleted when balance reaches zero', async () => {
    const card = makeCard({ currentBalance: 20 })
    const tx = makeMockTx(card)

    const result = await processGiftCardPayment(
      tx,
      makePaymentInput({ amount: 20 }),
      makePaymentRecord(),
      'order-1', 'loc-1', 100, 'emp-1',
      true
    )

    expect(result.error).toBeUndefined()
    expect(tx.giftCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentBalance: 0,
          status: 'depleted',
        }),
      })
    )
  })

  it('uses FOR UPDATE (row lock) in query', async () => {
    const card = makeCard({ currentBalance: 50 })
    const tx = makeMockTx(card)

    await processGiftCardPayment(
      tx,
      makePaymentInput({ amount: 10 }),
      makePaymentRecord(),
      'order-1', 'loc-1', 100, 'emp-1',
      true
    )

    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      'gc-1'
    )
  })

  it('looks up card by giftCardNumber when giftCardId not provided', async () => {
    const card = makeCard()
    const tx = makeMockTx(null)
    // First findUnique by id returns null, second by cardNumber returns card
    ;(tx.giftCard.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(card)
    ;(tx.giftCard.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(card)

    const result = await processGiftCardPayment(
      tx,
      makePaymentInput({ giftCardId: undefined, giftCardNumber: 'gc-test-1234-5678' }),
      makePaymentRecord(),
      'order-1', 'loc-1', 100, 'emp-1',
      true
    )

    // Second findUnique should have been called with uppercase card number
    expect(tx.giftCard.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cardNumber: 'GC-TEST-1234-5678' },
      })
    )
  })
})
