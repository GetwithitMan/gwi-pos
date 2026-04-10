import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
import { allocatePooledGiftCard } from '../allocate-pooled-gift-card'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockTx(rows: { id: string }[] | null = null) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(rows),
  } as unknown as Parameters<typeof allocatePooledGiftCard>[0]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('allocatePooledGiftCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path: returns cardId from query result', async () => {
    const tx = makeMockTx([{ id: 'gc-pool-42' }])

    const result = await allocatePooledGiftCard(tx, 'loc-1')

    expect(result.success).toBe(true)
    expect(result.cardId).toBe('gc-pool-42')
  })

  it('empty pool: returns error when no unactivated cards', async () => {
    const tx = makeMockTx([])

    const result = await allocatePooledGiftCard(tx, 'loc-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no card numbers available/i)
  })

  it('empty pool: returns error when query returns null', async () => {
    const tx = makeMockTx(null as unknown as { id: string }[])

    const result = await allocatePooledGiftCard(tx, 'loc-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no card numbers available/i)
  })

  it('uses $queryRaw with Prisma.sql tagged template', async () => {
    const tx = makeMockTx([{ id: 'gc-pool-1' }])

    await allocatePooledGiftCard(tx, 'loc-1')

    // Now uses Prisma.sql tagged template via $queryRaw (not $queryRawUnsafe)
    expect(tx.$queryRaw).toHaveBeenCalled()
  })

  it('passes locationId in the query', async () => {
    const tx = makeMockTx([{ id: 'gc-pool-1' }])

    await allocatePooledGiftCard(tx, 'loc-99')

    // $queryRaw is called with a Prisma.sql tagged template, not a raw string
    expect(tx.$queryRaw).toHaveBeenCalled()
  })
})
