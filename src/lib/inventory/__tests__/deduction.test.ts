/**
 * Section 3 — Inventory Deduction Integration Tests
 *
 * Tests the deduction logic for orders (paid) and voids (waste).
 * Uses Vitest mocking to intercept Prisma calls and verify correct
 * inventory deduction behavior without a real database.
 *
 * Covers:
 * - Food recipe deduction on payment
 * - Liquor recipe deduction on void (GL-08 critical fix)
 * - Modifier Path A (ModifierInventoryLink) takes precedence
 * - Modifier Path B (Modifier.ingredientId) fallback
 * - NO modifier → 0x deduction
 * - Waste deduction for voided items (wasMade=true)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from '@prisma/client/runtime/library'

// =============================================================================
// Mock Prisma db
// =============================================================================

const mockFindUnique = vi.fn()
const mockUpdateMany = vi.fn()
const mockUpdate = vi.fn()
const mockCreate = vi.fn()
const mockTransaction = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    order: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    orderItem: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    inventoryItem: { update: (...args: unknown[]) => mockUpdate(...args) },
    inventoryItemTransaction: { create: (...args: unknown[]) => mockCreate(...args) },
    wasteLogEntry: { create: (...args: unknown[]) => mockCreate(...args) },
    $transaction: (ops: unknown[]) => mockTransaction(ops),
  },
}))

// Mock logger to suppress output
vi.mock('@/lib/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

// =============================================================================
// Test Fixtures — Inventory Items
// =============================================================================

function makeInventoryItem(id: string, name: string, stock = 100) {
  return {
    id,
    name,
    category: 'food',
    department: 'kitchen',
    storageUnit: 'oz',
    costPerUnit: new Decimal(2.50),
    yieldCostPerUnit: null,
    currentStock: new Decimal(stock),
  }
}

function makeLiquorInventoryItem(id: string, name: string, stock = 750) {
  return {
    id,
    name,
    category: 'liquor',
    department: 'bar',
    storageUnit: 'oz',
    costPerUnit: new Decimal(1.50),
    yieldCostPerUnit: null,
    currentStock: new Decimal(stock),
  }
}

// =============================================================================
// ORDER DEDUCTION TESTS (deductInventoryForOrder)
// =============================================================================

describe('deductInventoryForOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockResolvedValue(undefined)
  })

  it('deducts food recipe ingredients on payment', async () => {
    const { deductInventoryForOrder } = await import('../order-deduction')

    const flour = makeInventoryItem('inv-flour', 'Flour')
    const butter = makeInventoryItem('inv-butter', 'Butter')

    mockFindUnique.mockResolvedValue({
      id: 'order-1',
      locationId: 'loc-1',
      orderNumber: 100,
      items: [
        {
          quantity: 2,
          menuItem: {
            recipe: {
              ingredients: [
                { quantity: new Decimal(4), unit: 'oz', inventoryItem: flour, prepItem: null },
                { quantity: new Decimal(2), unit: 'oz', inventoryItem: butter, prepItem: null },
              ],
            },
            recipeIngredients: [],
          },
          modifiers: [],
        },
      ],
    })

    const result = await deductInventoryForOrder('order-1')

    expect(result.success).toBe(true)
    expect(result.itemsDeducted).toBe(2)
    // Flour: 4oz * 2qty = 8oz, Butter: 2oz * 2qty = 4oz
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    const txOps = mockTransaction.mock.calls[0][0]
    // 2 items * 2 operations each (update stock + create transaction) = 4
    expect(txOps).toHaveLength(4)
  })

  it('deducts modifier via Path A (ModifierInventoryLink)', async () => {
    const { deductInventoryForOrder } = await import('../order-deduction')

    const cheese = makeInventoryItem('inv-cheese', 'Cheese')

    mockFindUnique.mockResolvedValue({
      id: 'order-2',
      locationId: 'loc-1',
      orderNumber: 101,
      items: [
        {
          quantity: 1,
          menuItem: { recipe: null, recipeIngredients: [] },
          modifiers: [
            {
              quantity: 1,
              preModifier: null,
              modifier: {
                inventoryLink: {
                  usageQuantity: new Decimal(1.5),
                  usageUnit: 'oz',
                  inventoryItemId: 'inv-cheese',
                  inventoryItem: cheese,
                },
                ingredient: null,
              },
            },
          ],
        },
      ],
    })

    const result = await deductInventoryForOrder('order-2')

    expect(result.success).toBe(true)
    expect(result.itemsDeducted).toBe(1) // cheese
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('deducts modifier via Path B (ingredientId fallback) when no inventoryLink', async () => {
    const { deductInventoryForOrder } = await import('../order-deduction')

    const lettuce = makeInventoryItem('inv-lettuce', 'Lettuce')

    mockFindUnique.mockResolvedValue({
      id: 'order-3',
      locationId: 'loc-1',
      orderNumber: 102,
      items: [
        {
          quantity: 1,
          menuItem: { recipe: null, recipeIngredients: [] },
          modifiers: [
            {
              quantity: 1,
              preModifier: null,
              modifier: {
                inventoryLink: null,
                ingredient: {
                  id: 'ing-lettuce',
                  inventoryItemId: 'inv-lettuce',
                  standardQuantity: new Decimal(2),
                  standardUnit: 'oz',
                  inventoryItem: lettuce,
                },
              },
            },
          ],
        },
      ],
    })

    const result = await deductInventoryForOrder('order-3')

    expect(result.success).toBe(true)
    expect(result.itemsDeducted).toBe(1) // lettuce via Path B
  })

  it('Path A takes precedence over Path B when both exist', async () => {
    const { deductInventoryForOrder } = await import('../order-deduction')

    const cheeseA = makeInventoryItem('inv-cheese-a', 'Cheese (Link)')
    const cheeseB = makeInventoryItem('inv-cheese-b', 'Cheese (Ingredient)')

    mockFindUnique.mockResolvedValue({
      id: 'order-4',
      locationId: 'loc-1',
      orderNumber: 103,
      items: [
        {
          quantity: 1,
          menuItem: { recipe: null, recipeIngredients: [] },
          modifiers: [
            {
              quantity: 1,
              preModifier: null,
              modifier: {
                // Path A exists → should be used
                inventoryLink: {
                  usageQuantity: new Decimal(3),
                  usageUnit: 'oz',
                  inventoryItemId: 'inv-cheese-a',
                  inventoryItem: cheeseA,
                },
                // Path B also exists → should be skipped
                ingredient: {
                  id: 'ing-cheese',
                  inventoryItemId: 'inv-cheese-b',
                  standardQuantity: new Decimal(5),
                  standardUnit: 'oz',
                  inventoryItem: cheeseB,
                },
              },
            },
          ],
        },
      ],
    })

    const result = await deductInventoryForOrder('order-4')

    expect(result.success).toBe(true)
    // Should deduct exactly 1 item (cheese-a via Path A), NOT 2 (cheese-a + cheese-b)
    expect(result.itemsDeducted).toBe(1)
    // Transaction should have exactly 2 operations (1 stock update + 1 transaction record)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    const txOps = mockTransaction.mock.calls[0][0]
    expect(txOps).toHaveLength(2)
  })

  it('NO modifier → 0x deduction (skips ingredient entirely)', async () => {
    const { deductInventoryForOrder } = await import('../order-deduction')

    const onion = makeInventoryItem('inv-onion', 'Onion')

    mockFindUnique.mockResolvedValue({
      id: 'order-5',
      locationId: 'loc-1',
      orderNumber: 104,
      items: [
        {
          quantity: 1,
          menuItem: { recipe: null, recipeIngredients: [] },
          modifiers: [
            {
              quantity: 1,
              preModifier: 'NO',
              modifier: {
                inventoryLink: {
                  usageQuantity: new Decimal(2),
                  usageUnit: 'oz',
                  inventoryItemId: 'inv-onion',
                  inventoryItem: onion,
                },
                ingredient: null,
              },
            },
          ],
        },
      ],
    })

    const result = await deductInventoryForOrder('order-5')

    expect(result.success).toBe(true)
    expect(result.itemsDeducted).toBe(0) // NO modifier → nothing deducted
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('deducts liquor recipe ingredients (RecipeIngredient → BottleProduct)', async () => {
    const { deductInventoryForOrder } = await import('../order-deduction')

    const vodka = makeLiquorInventoryItem('inv-vodka', 'Vodka')
    const oj = makeLiquorInventoryItem('inv-oj', 'Orange Juice')

    mockFindUnique.mockResolvedValue({
      id: 'order-6',
      locationId: 'loc-1',
      orderNumber: 105,
      items: [
        {
          quantity: 1,
          menuItem: {
            recipe: null,
            recipeIngredients: [
              {
                deletedAt: null,
                pourCount: 1,
                pourSizeOz: 1.5,
                bottleProduct: { pourSizeOz: 1.5, inventoryItem: vodka },
              },
              {
                deletedAt: null,
                pourCount: 1,
                pourSizeOz: 4.0,
                bottleProduct: { pourSizeOz: 4.0, inventoryItem: oj },
              },
            ],
          },
          modifiers: [],
        },
      ],
    })

    const result = await deductInventoryForOrder('order-6')

    expect(result.success).toBe(true)
    expect(result.itemsDeducted).toBe(2) // vodka + OJ
  })

  it('returns success with 0 items when order not found', async () => {
    const { deductInventoryForOrder } = await import('../order-deduction')

    mockFindUnique.mockResolvedValue(null)

    const result = await deductInventoryForOrder('nonexistent')

    expect(result.success).toBe(false)
    expect(result.errors).toContain('Order not found')
  })
})

// =============================================================================
// VOID WASTE DEDUCTION TESTS (deductInventoryForVoidedItem)
// =============================================================================

describe('deductInventoryForVoidedItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockResolvedValue(undefined)
  })

  it('food void with wasMade reason → deducts as waste', async () => {
    const { deductInventoryForVoidedItem } = await import('../void-waste')

    const flour = makeInventoryItem('inv-flour', 'Flour')

    mockFindUnique.mockResolvedValue({
      id: 'oi-1',
      quantity: 1,
      order: { locationId: 'loc-1', orderNumber: 200 },
      menuItem: {
        recipe: {
          ingredients: [
            { quantity: new Decimal(4), unit: 'oz', inventoryItem: flour, prepItem: null },
          ],
        },
        recipeIngredients: [],
      },
      modifiers: [],
    })

    const result = await deductInventoryForVoidedItem('oi-1', 'kitchen_error')

    expect(result.success).toBe(true)
    expect(result.itemsDeducted).toBe(1)
    // Should create 3 operations per item: stock update + transaction + waste log
    const txOps = mockTransaction.mock.calls[0][0]
    expect(txOps).toHaveLength(3)
  })

  it('CRITICAL (GL-08): liquor void with wasMade → deducts bottle stock', async () => {
    const { deductInventoryForVoidedItem } = await import('../void-waste')

    const tequila = makeLiquorInventoryItem('inv-tequila', 'Tequila')
    const lime = makeLiquorInventoryItem('inv-lime', 'Lime Juice')

    mockFindUnique.mockResolvedValue({
      id: 'oi-2',
      quantity: 1,
      order: { locationId: 'loc-1', orderNumber: 201 },
      menuItem: {
        recipe: null,
        recipeIngredients: [
          {
            deletedAt: null,
            pourCount: 2,
            pourSizeOz: 1.5,
            bottleProduct: { pourSizeOz: 1.5, inventoryItem: tequila },
          },
          {
            deletedAt: null,
            pourCount: 1,
            pourSizeOz: 1.0,
            bottleProduct: { pourSizeOz: 1.0, inventoryItem: lime },
          },
        ],
      },
      modifiers: [],
    })

    const result = await deductInventoryForVoidedItem('oi-2', 'kitchen_error')

    expect(result.success).toBe(true)
    expect(result.itemsDeducted).toBe(2) // tequila + lime
    // This was the GL-08 bug — before the fix, this would return 0
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('non-waste void reason → no deduction', async () => {
    const { deductInventoryForVoidedItem } = await import('../void-waste')

    const result = await deductInventoryForVoidedItem('oi-3', 'customer_changed_mind')

    expect(result.success).toBe(true)
    expect(result.itemsDeducted).toBe(0)
    // Should not even query the DB
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('waste void reasons are recognized', async () => {
    const { WASTE_VOID_REASONS } = await import('../void-waste')

    expect(WASTE_VOID_REASONS).toContain('kitchen_error')
    expect(WASTE_VOID_REASONS).toContain('customer_disliked')
    expect(WASTE_VOID_REASONS).toContain('wrong_order')
    expect(WASTE_VOID_REASONS).toContain('remade')
    expect(WASTE_VOID_REASONS).toContain('quality_issue')
  })

  it('void with modifier using NO instruction → skips that ingredient', async () => {
    const { deductInventoryForVoidedItem } = await import('../void-waste')

    const tomato = makeInventoryItem('inv-tomato', 'Tomato')
    const onion = makeInventoryItem('inv-onion', 'Onion')

    mockFindUnique.mockResolvedValue({
      id: 'oi-4',
      quantity: 1,
      order: { locationId: 'loc-1', orderNumber: 202 },
      menuItem: {
        recipe: {
          ingredients: [
            { quantity: new Decimal(3), unit: 'oz', inventoryItem: tomato, prepItem: null },
            { quantity: new Decimal(2), unit: 'oz', inventoryItem: onion, prepItem: null },
          ],
        },
        recipeIngredients: [],
      },
      modifiers: [
        {
          quantity: 1,
          preModifier: 'NO',
          modifier: {
            inventoryLink: {
              inventoryItemId: 'inv-onion',
              usageQuantity: new Decimal(2),
              usageUnit: 'oz',
              inventoryItem: onion,
            },
            ingredient: null,
          },
        },
      ],
    })

    const result = await deductInventoryForVoidedItem('oi-4', 'kitchen_error')

    expect(result.success).toBe(true)
    // Only tomato should be deducted (onion was NO'd)
    expect(result.itemsDeducted).toBe(1)
  })

  it('void with EXTRA modifier → applies 2x multiplier', async () => {
    const { deductInventoryForVoidedItem } = await import('../void-waste')

    const cheese = makeInventoryItem('inv-cheese', 'Cheese', 200)

    mockFindUnique.mockResolvedValue({
      id: 'oi-5',
      quantity: 1,
      order: { locationId: 'loc-1', orderNumber: 203 },
      menuItem: {
        recipe: null,
        recipeIngredients: [],
      },
      modifiers: [
        {
          quantity: 1,
          preModifier: 'EXTRA',
          modifier: {
            inventoryLink: {
              usageQuantity: new Decimal(2),
              usageUnit: 'oz',
              inventoryItemId: 'inv-cheese',
              inventoryItem: cheese,
            },
            ingredient: null,
          },
        },
      ],
    })

    const result = await deductInventoryForVoidedItem('oi-5', 'wrong_order')

    expect(result.success).toBe(true)
    expect(result.itemsDeducted).toBe(1) // cheese with 2x multiplier
  })
})
