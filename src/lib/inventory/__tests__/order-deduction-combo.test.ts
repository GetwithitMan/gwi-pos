/**
 * Combo Pick N of M — Inventory Deduction Tests (Phase 6)
 *
 * Verifies that when an OrderItem represents a combo, inventory is deducted
 * from the ACTUAL customer picks (`comboSelections`) rather than the combo
 * component defaults.
 *
 * Covers:
 * - Positive path: selections drive deduction (3x: 2 Corona, 1 Modelo).
 * - Legacy regression: empty selections → classic ComboComponent default path.
 * - Missing-recipe hardening: selection with null recipe is skipped with
 *   a structured warning; other selections still deduct.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
const Decimal = Prisma.Decimal

// =============================================================================
// Mock Prisma db (mirrors src/lib/inventory/__tests__/deduction.test.ts)
// =============================================================================

const mockOrderFindUnique = vi.fn()
const mockComboTemplateFindMany = vi.fn()
const mockMenuItemFindMany = vi.fn()
const mockPizzaSizeFindUnique = vi.fn()

const mockTxQueryRaw = vi.fn()
const mockTxFindFirst = vi.fn()
const mockTxFindUnique = vi.fn()
const mockTxUpdate = vi.fn()
const mockTxCreate = vi.fn()

const mockTx = {
  inventoryItemTransaction: {
    findFirst: (...args: unknown[]) => mockTxFindFirst(...args),
    create: (...args: unknown[]) => mockTxCreate(...args),
  },
  inventoryItem: {
    findUnique: (...args: unknown[]) => mockTxFindUnique(...args),
    update: (...args: unknown[]) => mockTxUpdate(...args),
  },
  $queryRaw: (...args: unknown[]) => mockTxQueryRaw(...args),
}

vi.mock('@/lib/db', () => ({
  db: {
    order: { findUnique: (...args: unknown[]) => mockOrderFindUnique(...args) },
    comboTemplate: { findMany: (...args: unknown[]) => mockComboTemplateFindMany(...args) },
    menuItem: { findMany: (...args: unknown[]) => mockMenuItemFindMany(...args) },
    pizzaSize: { findUnique: (...args: unknown[]) => mockPizzaSizeFindUnique(...args) },
    ingredient: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    $transaction: (fnOrOps: unknown) => {
      if (typeof fnOrOps === 'function') {
        return (fnOrOps as (tx: typeof mockTx) => unknown)(mockTx)
      }
      return undefined
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock dispatchAlert so unhandled fire-and-forget never noises tests.
vi.mock('@/lib/alert-service', () => ({
  dispatchAlert: vi.fn().mockResolvedValue(undefined),
}))

// =============================================================================
// Fixtures
// =============================================================================

function makeInventoryItem(id: string, name: string, stock = 100) {
  return {
    id,
    name,
    category: 'liquor',
    department: 'bar',
    storageUnit: 'each',
    costPerUnit: new Decimal(1.5),
    yieldCostPerUnit: null,
    currentStock: new Decimal(stock),
  }
}

function makeMenuItemWithRecipe(
  menuItemId: string,
  inventoryItem: ReturnType<typeof makeInventoryItem>,
  qty = 1,
) {
  return {
    id: menuItemId,
    name: `MenuItem-${menuItemId}`,
    deletedAt: null,
    recipe: {
      ingredients: [
        {
          quantity: new Decimal(qty),
          unit: 'each',
          inventoryItem,
          prepItem: null,
        },
      ],
    },
    recipeIngredients: [],
    linkedBottleProduct: null,
  }
}

// Helper to stub out the inventory update transaction so we can assert usage
// on a per-inventoryItemId basis.
function stubTxForDeduction(stockMap: Map<string, number>) {
  mockTxFindFirst.mockResolvedValue(null) // idempotency guard — no prior deduction
  mockTxFindUnique.mockImplementation((args: any) => {
    const id = args?.where?.id as string
    return Promise.resolve({
      trackInventory: true,
      version: 0,
      currentStock: new Decimal(stockMap.get(id) ?? 100),
    })
  })
  mockTxQueryRaw.mockImplementation(() =>
    Promise.resolve([{ currentStock: new Decimal(99) }]),
  )
  mockTxUpdate.mockResolvedValue({ currentStock: new Decimal(99) })
  mockTxCreate.mockResolvedValue({})
}

// Read the captured transaction.create calls back into a usage-by-id map.
function capturedDeductionsById(): Map<string, number> {
  const out = new Map<string, number>()
  for (const call of mockTxCreate.mock.calls) {
    const data = (call?.[0] as any)?.data
    if (!data?.inventoryItemId || typeof data.quantityChange !== 'number') continue
    // quantityChange is negative (a decrement). Track the deducted magnitude.
    out.set(
      data.inventoryItemId,
      (out.get(data.inventoryItemId) ?? 0) + Math.abs(data.quantityChange),
    )
  }
  return out
}

// =============================================================================
// Tests
// =============================================================================

describe('deductInventoryForOrder — combo pick N of M', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTxFindFirst.mockResolvedValue(null)
    mockTxFindUnique.mockResolvedValue({
      trackInventory: true,
      version: 0,
      currentStock: new Decimal(100),
    })
    mockTxQueryRaw.mockResolvedValue([{ currentStock: new Decimal(99) }])
    mockTxUpdate.mockResolvedValue({ currentStock: new Decimal(99) })
    mockTxCreate.mockResolvedValue({})
    mockComboTemplateFindMany.mockResolvedValue([])
    mockMenuItemFindMany.mockResolvedValue([])
  })

  it('positive path: deducts each selection (2x Corona + 1x Modelo) — defaults NOT touched', async () => {
    const { deductInventoryForOrder } = await import('../order-deduction')

    const corona = makeInventoryItem('inv-corona', 'Corona')
    const modelo = makeInventoryItem('inv-modelo', 'Modelo')
    const defaultFries = makeInventoryItem('inv-fries', 'Fries') // default — MUST NOT be deducted

    const coronaMenuItem = makeMenuItemWithRecipe('mi-corona', corona, 1)
    const modeloMenuItem = makeMenuItemWithRecipe('mi-modelo', modelo, 1)

    // Order contains one combo order item with 3 selections.
    mockOrderFindUnique.mockResolvedValue({
      id: 'order-combo-1',
      locationId: 'loc-1',
      orderNumber: 500,
      status: 'paid',
      items: [
        {
          id: 'oi-combo-1',
          quantity: 1,
          menuItemId: 'mi-combo-bucket',
          menuItem: {
            itemType: 'combo',
            name: 'Bucket of Beer',
            recipe: null,
            recipeIngredients: [],
          },
          modifiers: [],
          comboSelections: [
            {
              id: 'sel-1',
              deletedAt: null,
              sortIndex: 0,
              menuItemId: 'mi-corona',
              menuItem: coronaMenuItem,
            },
            {
              id: 'sel-2',
              deletedAt: null,
              sortIndex: 1,
              menuItemId: 'mi-corona',
              menuItem: coronaMenuItem,
            },
            {
              id: 'sel-3',
              deletedAt: null,
              sortIndex: 2,
              menuItemId: 'mi-modelo',
              menuItem: modeloMenuItem,
            },
          ],
        },
      ],
    })

    // No classic template fetch should occur when selections are present — but
    // if it did, this stub would ensure the defaults are NOT mixed in.
    mockComboTemplateFindMany.mockResolvedValue([])
    mockMenuItemFindMany.mockResolvedValue([])

    stubTxForDeduction(new Map())

    const result = await deductInventoryForOrder('order-combo-1')

    expect(result.success).toBe(true)

    const deductions = capturedDeductionsById()
    expect(deductions.get('inv-corona')).toBe(2)
    expect(deductions.get('inv-modelo')).toBe(1)
    // Default component menuItem must NOT have been deducted — the classic
    // fallback path should never run when selections are present.
    expect(deductions.has('inv-fries')).toBe(false)
    // And we never needed to look up the classic template.
    expect(mockComboTemplateFindMany).not.toHaveBeenCalled()
    // Just to make the fixture explicit:
    expect(defaultFries.id).toBe('inv-fries')
  })

  it('legacy regression: empty selections → classic ComboComponent default deducts once', async () => {
    const { deductInventoryForOrder } = await import('../order-deduction')

    const fries = makeInventoryItem('inv-fries', 'Fries')
    const friesMenuItem = makeMenuItemWithRecipe('mi-fries', fries, 1)

    mockOrderFindUnique.mockResolvedValue({
      id: 'order-combo-2',
      locationId: 'loc-1',
      orderNumber: 501,
      status: 'paid',
      items: [
        {
          id: 'oi-combo-2',
          quantity: 1,
          menuItemId: 'mi-combo-kids',
          menuItem: {
            itemType: 'combo',
            name: 'Kids Meal',
            recipe: null,
            recipeIngredients: [],
          },
          modifiers: [],
          comboSelections: [], // <-- classic combo: no picks
        },
      ],
    })

    // Classic path: template → components → resolved menuItem fetch.
    mockComboTemplateFindMany.mockResolvedValue([
      {
        menuItemId: 'mi-combo-kids',
        components: [
          { menuItemId: 'mi-fries', defaultItemId: 'mi-fries' },
        ],
      },
    ])
    mockMenuItemFindMany.mockResolvedValue([friesMenuItem])

    stubTxForDeduction(new Map())

    const result = await deductInventoryForOrder('order-combo-2')

    expect(result.success).toBe(true)

    const deductions = capturedDeductionsById()
    expect(deductions.get('inv-fries')).toBe(1)
    expect(mockComboTemplateFindMany).toHaveBeenCalledTimes(1)
  })

  it('missing-recipe hardening: one bad selection is skipped with a warning; others still deduct', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { deductInventoryForOrder } = await import('../order-deduction')

    const corona = makeInventoryItem('inv-corona', 'Corona')
    const coronaMenuItem = makeMenuItemWithRecipe('mi-corona', corona, 1)

    // Broken selection: menuItem exists but has no recipe.
    const brokenMenuItem = {
      id: 'mi-broken',
      name: 'Broken MenuItem',
      deletedAt: null,
      recipe: null, // <-- the hardening trigger
      recipeIngredients: [],
      linkedBottleProduct: null,
    }

    mockOrderFindUnique.mockResolvedValue({
      id: 'order-combo-3',
      locationId: 'loc-1',
      orderNumber: 502,
      status: 'paid',
      items: [
        {
          id: 'oi-combo-3',
          quantity: 1,
          menuItemId: 'mi-combo-mixed',
          menuItem: {
            itemType: 'combo',
            name: 'Mixed Combo',
            recipe: null,
            recipeIngredients: [],
          },
          modifiers: [],
          comboSelections: [
            {
              id: 'sel-broken',
              deletedAt: null,
              sortIndex: 0,
              menuItemId: 'mi-broken',
              menuItem: brokenMenuItem,
            },
            {
              id: 'sel-ok',
              deletedAt: null,
              sortIndex: 1,
              menuItemId: 'mi-corona',
              menuItem: coronaMenuItem,
            },
          ],
        },
      ],
    })

    stubTxForDeduction(new Map())

    const result = await deductInventoryForOrder('order-combo-3')

    // Must not throw / must not abort — the good selection still deducts.
    expect(result.success).toBe(true)

    const deductions = capturedDeductionsById()
    expect(deductions.get('inv-corona')).toBe(1)
    expect(deductions.has('mi-broken')).toBe(false)

    // Warning was emitted with the expected structured fields.
    expect(warnSpy).toHaveBeenCalled()
    const warnArgs = warnSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('combo selection missing recipe'),
    )
    expect(warnArgs).toBeDefined()
    const meta = warnArgs?.[1] as Record<string, unknown> | undefined
    expect(meta).toMatchObject({
      orderId: 'order-combo-3',
      orderItemId: 'oi-combo-3',
      selectionId: 'sel-broken',
      menuItemId: 'mi-broken',
    })

    warnSpy.mockRestore()
  })
})
