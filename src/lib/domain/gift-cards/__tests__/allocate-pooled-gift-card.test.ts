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
    $queryRawUnsafe: vi.fn().mockResolvedValue(rows),
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

  it('uses FOR UPDATE SKIP LOCKED in the raw query', async () => {
    const tx = makeMockTx([{ id: 'gc-pool-1' }])

    await allocatePooledGiftCard(tx, 'loc-1')

    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      'loc-1'
    )
  })

  it('filters by locationId and status=unactivated', async () => {
    const tx = makeMockTx([{ id: 'gc-pool-1' }])

    await allocatePooledGiftCard(tx, 'loc-99')

    const sql = (tx.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(sql).toContain('"locationId" = $1')
    expect(sql).toContain("status = 'unactivated'")
    expect((tx.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('loc-99')
  })
})
