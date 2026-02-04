/**
 * Pizza Inventory Seed Script
 *
 * Creates a proper tiered inventory structure for pizza dough:
 *
 * TIER 1: Raw Ingredients (Purchased)
 * - Pizza Dough Flour (50 lb bag)
 * - Water, Yeast, Olive Oil, Salt
 *
 * TIER 2: Master Batch (Prep Item)
 * - Bulk Dough Batch = 50 lbs flour + water + yeast + oil
 * - Yields approximately 22.5 kg (50 lbs) of dough
 *
 * TIER 3: Dough Balls (Prep Items from Batch)
 * - Small Ball (250g) - for Personal/Small pizzas
 * - Medium Ball (400g) - for Medium pizzas
 * - Large Ball (600g) - for Large/XL pizzas
 *
 * TIER 4: Finished Products (Prep Items from Balls)
 * - Personal Pizza Crust (8") - from Small Ball
 * - Small Pizza Crust (10") - from Small Ball
 * - Medium Pizza Crust (12") - from Medium Ball
 * - Large Pizza Crust (14") - from Large Ball
 * - XL Pizza Crust (16") - from Large Ball
 * - Calzone Shell - from Medium Ball
 * - Breadsticks (6) - from Small Ball
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const LOCATION_ID = 'loc-1'

// Find or get the Bread & Dough category
async function getOrCreateCategory() {
  let category = await prisma.ingredientCategory.findFirst({
    where: { locationId: LOCATION_ID, name: 'Bread & Dough', deletedAt: null }
  })

  if (!category) {
    category = await prisma.ingredientCategory.create({
      data: {
        locationId: LOCATION_ID,
        name: 'Bread & Dough',
        code: 100,
        icon: '🍞',
        color: '#D97706',
        sortOrder: 10,
      }
    })
  }

  return category
}

async function main() {
  console.log('Setting up Pizza Inventory...\n')

  const category = await getOrCreateCategory()
  console.log(`Using category: ${category.name} (${category.id})\n`)

  // ============================================
  // TIER 1: RAW INGREDIENTS (Purchased Items)
  // ============================================
  console.log('=== TIER 1: Raw Ingredients ===')

  // Pizza Dough Flour - 50 lb bag
  const flour = await prisma.ingredient.upsert({
    where: { locationId_name: { locationId: LOCATION_ID, name: 'Pizza Dough Flour' } },
    update: {
      description: 'High-gluten bread flour for pizza dough',
      categoryId: category.id,
      standardQuantity: 50,
      standardUnit: 'lb',
      isBaseIngredient: true,
      visibility: 'visible',
      isActive: true,
    },
    create: {
      locationId: LOCATION_ID,
      name: 'Pizza Dough Flour',
      description: 'High-gluten bread flour for pizza dough',
      categoryId: category.id,
      standardQuantity: 50,
      standardUnit: 'lb',
      isBaseIngredient: true,
      visibility: 'visible',
      isActive: true,
    }
  })
  console.log(`  ✓ ${flour.name} (1 unit = ${flour.standardQuantity} ${flour.standardUnit})`)

  // Water
  const water = await prisma.ingredient.upsert({
    where: { locationId_name: { locationId: LOCATION_ID, name: 'Water' } },
    update: {
      description: 'Filtered water for dough',
      categoryId: category.id,
      standardQuantity: 1,
      standardUnit: 'gallons',
      isBaseIngredient: true,
      visibility: 'admin_only',
      isActive: true,
    },
    create: {
      locationId: LOCATION_ID,
      name: 'Water',
      description: 'Filtered water for dough',
      categoryId: category.id,
      standardQuantity: 1,
      standardUnit: 'gallons',
      isBaseIngredient: true,
      visibility: 'admin_only',
      isActive: true,
    }
  })
  console.log(`  ✓ ${water.name}`)

  // Yeast
  const yeast = await prisma.ingredient.upsert({
    where: { locationId_name: { locationId: LOCATION_ID, name: 'Active Dry Yeast' } },
    update: {
      description: 'For pizza dough',
      categoryId: category.id,
      standardQuantity: 1,
      standardUnit: 'lb',
      isBaseIngredient: true,
      visibility: 'admin_only',
      isActive: true,
    },
    create: {
      locationId: LOCATION_ID,
      name: 'Active Dry Yeast',
      description: 'For pizza dough',
      categoryId: category.id,
      standardQuantity: 1,
      standardUnit: 'lb',
      isBaseIngredient: true,
      visibility: 'admin_only',
      isActive: true,
    }
  })
  console.log(`  ✓ ${yeast.name}`)

  // Olive Oil
  const oil = await prisma.ingredient.upsert({
    where: { locationId_name: { locationId: LOCATION_ID, name: 'Olive Oil' } },
    update: {
      description: 'For pizza dough and cooking',
      categoryId: category.id,
      standardQuantity: 1,
      standardUnit: 'gallons',
      isBaseIngredient: true,
      visibility: 'admin_only',
      isActive: true,
    },
    create: {
      locationId: LOCATION_ID,
      name: 'Olive Oil',
      description: 'For pizza dough and cooking',
      categoryId: category.id,
      standardQuantity: 1,
      standardUnit: 'gallons',
      isBaseIngredient: true,
      visibility: 'admin_only',
      isActive: true,
    }
  })
  console.log(`  ✓ ${oil.name}`)

  // Salt
  const salt = await prisma.ingredient.upsert({
    where: { locationId_name: { locationId: LOCATION_ID, name: 'Kosher Salt' } },
    update: {
      description: 'For seasoning and dough',
      categoryId: category.id,
      standardQuantity: 3,
      standardUnit: 'lb',
      isBaseIngredient: true,
      visibility: 'admin_only',
      isActive: true,
    },
    create: {
      locationId: LOCATION_ID,
      name: 'Kosher Salt',
      description: 'For seasoning and dough',
      categoryId: category.id,
      standardQuantity: 3,
      standardUnit: 'lb',
      isBaseIngredient: true,
      visibility: 'admin_only',
      isActive: true,
    }
  })
  console.log(`  ✓ ${salt.name}`)

  // ============================================
  // TIER 2: MASTER BATCH (Bulk Dough Batch)
  // ============================================
  console.log('\n=== TIER 2: Master Batch ===')

  // Bulk Dough Batch - yields ~22.5 kg from 50 lbs flour
  // 50 lbs flour = 22.7 kg, hydration adds ~65% = ~37 kg total dough
  // At 400g average per ball, that's about 90 dough balls per batch
  const bulkBatch = await prisma.ingredient.upsert({
    where: { locationId_name: { locationId: LOCATION_ID, name: 'Bulk Dough Batch' } },
    update: {
      description: 'One full batch of pizza dough (50 lbs flour + water + yeast + oil)',
      categoryId: category.id,
      standardUnit: 'batches',
      batchYield: 1,
      yieldPercent: 1.0, // 100% - no loss at batch level
      isBaseIngredient: false,
      isDailyCountItem: true,
      countPrecision: 'whole',
      preparationType: 'Mixed',
      visibility: 'visible',
      isActive: true,
      lowStockThreshold: 1,
      criticalStockThreshold: 0,
    },
    create: {
      locationId: LOCATION_ID,
      name: 'Bulk Dough Batch',
      description: 'One full batch of pizza dough (50 lbs flour + water + yeast + oil)',
      categoryId: category.id,
      standardUnit: 'batches',
      batchYield: 1,
      yieldPercent: 1.0,
      isBaseIngredient: false,
      isDailyCountItem: true,
      countPrecision: 'whole',
      preparationType: 'Mixed',
      visibility: 'visible',
      isActive: true,
      lowStockThreshold: 1,
      criticalStockThreshold: 0,
    }
  })
  console.log(`  ✓ ${bulkBatch.name} (1 batch from 50 lbs flour)`)

  // Add recipe components for bulk batch
  const batchRecipes = [
    { componentId: flour.id, quantity: 50, unit: 'lb' },
    { componentId: water.id, quantity: 4, unit: 'gallons' }, // ~65% hydration
    { componentId: yeast.id, quantity: 4, unit: 'oz' },
    { componentId: oil.id, quantity: 2, unit: 'cups' },
    { componentId: salt.id, quantity: 8, unit: 'oz' },
  ]

  for (const recipe of batchRecipes) {
    await prisma.ingredientRecipe.upsert({
      where: {
        outputId_componentId: {
          outputId: bulkBatch.id,
          componentId: recipe.componentId,
        }
      },
      update: { quantity: recipe.quantity, unit: recipe.unit },
      create: {
        locationId: LOCATION_ID,
        outputId: bulkBatch.id,
        componentId: recipe.componentId,
        quantity: recipe.quantity,
        unit: recipe.unit,
      }
    })
  }
  console.log(`    → Recipe: 50 lbs flour + 4 gal water + 4 oz yeast + 2 cups oil + 8 oz salt`)

  // ============================================
  // TIER 3: DOUGH BALLS (from Batch)
  // ============================================
  console.log('\n=== TIER 3: Dough Balls ===')

  // Math: 50 lbs flour + 65% hydration = ~82.5 lbs total dough = 37.4 kg
  // Small Ball (250g): 37,400g / 250g = ~150 balls per batch
  // Medium Ball (400g): 37,400g / 400g = ~93 balls per batch
  // Large Ball (600g): 37,400g / 600g = ~62 balls per batch

  // Small Dough Ball (250g) - for Personal/Small pizzas
  const smallBall = await prisma.ingredient.upsert({
    where: { locationId_name: { locationId: LOCATION_ID, name: 'Small Dough Ball (250g)' } },
    update: {
      description: 'For personal and small pizzas, breadsticks',
      categoryId: category.id,
      standardUnit: 'balls',
      batchYield: 150, // ~150 small balls from one batch
      yieldPercent: 0.98, // 2% loss from portioning
      isBaseIngredient: false,
      isDailyCountItem: true,
      countPrecision: 'whole',
      preparationType: 'Portioned',
      visibility: 'visible',
      isActive: true,
      lowStockThreshold: 20,
      criticalStockThreshold: 10,
    },
    create: {
      locationId: LOCATION_ID,
      name: 'Small Dough Ball (250g)',
      description: 'For personal and small pizzas, breadsticks',
      categoryId: category.id,
      standardUnit: 'balls',
      batchYield: 150,
      yieldPercent: 0.98,
      isBaseIngredient: false,
      isDailyCountItem: true,
      countPrecision: 'whole',
      preparationType: 'Portioned',
      visibility: 'visible',
      isActive: true,
      lowStockThreshold: 20,
      criticalStockThreshold: 10,
    }
  })
  console.log(`  ✓ ${smallBall.name} (~150 per batch)`)

  // Add recipe for small ball
  await prisma.ingredientRecipe.upsert({
    where: {
      outputId_componentId: {
        outputId: smallBall.id,
        componentId: bulkBatch.id,
      }
    },
    update: { quantity: 1, unit: 'batches' },
    create: {
      locationId: LOCATION_ID,
      outputId: smallBall.id,
      componentId: bulkBatch.id,
      quantity: 1,
      unit: 'batches',
    }
  })

  // Medium Dough Ball (400g) - for Medium pizzas, calzones
  const mediumBall = await prisma.ingredient.upsert({
    where: { locationId_name: { locationId: LOCATION_ID, name: 'Medium Dough Ball (400g)' } },
    update: {
      description: 'For medium pizzas, calzones',
      categoryId: category.id,
      standardUnit: 'balls',
      batchYield: 93, // ~93 medium balls from one batch
      yieldPercent: 0.98,
      isBaseIngredient: false,
      isDailyCountItem: true,
      countPrecision: 'whole',
      preparationType: 'Portioned',
      visibility: 'visible',
      isActive: true,
      lowStockThreshold: 15,
      criticalStockThreshold: 8,
    },
    create: {
      locationId: LOCATION_ID,
      name: 'Medium Dough Ball (400g)',
      description: 'For medium pizzas, calzones',
      categoryId: category.id,
      standardUnit: 'balls',
      batchYield: 93,
      yieldPercent: 0.98,
      isBaseIngredient: false,
      isDailyCountItem: true,
      countPrecision: 'whole',
      preparationType: 'Portioned',
      visibility: 'visible',
      isActive: true,
      lowStockThreshold: 15,
      criticalStockThreshold: 8,
    }
  })
  console.log(`  ✓ ${mediumBall.name} (~93 per batch)`)

  await prisma.ingredientRecipe.upsert({
    where: {
      outputId_componentId: {
        outputId: mediumBall.id,
        componentId: bulkBatch.id,
      }
    },
    update: { quantity: 1, unit: 'batches' },
    create: {
      locationId: LOCATION_ID,
      outputId: mediumBall.id,
      componentId: bulkBatch.id,
      quantity: 1,
      unit: 'batches',
    }
  })

  // Large Dough Ball (600g) - for Large/XL pizzas
  const largeBall = await prisma.ingredient.upsert({
    where: { locationId_name: { locationId: LOCATION_ID, name: 'Large Dough Ball (600g)' } },
    update: {
      description: 'For large and XL pizzas',
      categoryId: category.id,
      standardUnit: 'balls',
      batchYield: 62, // ~62 large balls from one batch
      yieldPercent: 0.98,
      isBaseIngredient: false,
      isDailyCountItem: true,
      countPrecision: 'whole',
      preparationType: 'Portioned',
      visibility: 'visible',
      isActive: true,
      lowStockThreshold: 12,
      criticalStockThreshold: 6,
    },
    create: {
      locationId: LOCATION_ID,
      name: 'Large Dough Ball (600g)',
      description: 'For large and XL pizzas',
      categoryId: category.id,
      standardUnit: 'balls',
      batchYield: 62,
      yieldPercent: 0.98,
      isBaseIngredient: false,
      isDailyCountItem: true,
      countPrecision: 'whole',
      preparationType: 'Portioned',
      visibility: 'visible',
      isActive: true,
      lowStockThreshold: 12,
      criticalStockThreshold: 6,
    }
  })
  console.log(`  ✓ ${largeBall.name} (~62 per batch)`)

  await prisma.ingredientRecipe.upsert({
    where: {
      outputId_componentId: {
        outputId: largeBall.id,
        componentId: bulkBatch.id,
      }
    },
    update: { quantity: 1, unit: 'batches' },
    create: {
      locationId: LOCATION_ID,
      outputId: largeBall.id,
      componentId: bulkBatch.id,
      quantity: 1,
      unit: 'batches',
    }
  })

  // ============================================
  // TIER 4: FINISHED PRODUCTS (Pizza Crusts, etc.)
  // ============================================
  console.log('\n=== TIER 4: Finished Products ===')

  // Each product uses 1 dough ball, with ~90% yield after baking
  const products = [
    { id: 'ing-crust-personal', name: 'Personal Pizza Crust (8")', ball: smallBall, yield: 0.90, sortOrder: 1 },
    { id: 'ing-crust-small', name: 'Small Pizza Crust (10")', ball: smallBall, yield: 0.90, sortOrder: 2 },
    { id: 'ing-crust-medium', name: 'Medium Pizza Crust (12")', ball: mediumBall, yield: 0.90, sortOrder: 3 },
    { id: 'ing-crust-large', name: 'Large Pizza Crust (14")', ball: largeBall, yield: 0.90, sortOrder: 4 },
    { id: 'ing-crust-xl', name: 'XL Pizza Crust (16")', ball: largeBall, yield: 0.90, sortOrder: 5 },
    { id: 'ing-calzone-shell', name: 'Calzone Shell', ball: mediumBall, yield: 0.90, sortOrder: 6 },
    { id: 'ing-breadsticks', name: 'Breadsticks (6)', ball: smallBall, yield: 0.90, sortOrder: 7 },
  ]

  for (const product of products) {
    const ing = await prisma.ingredient.upsert({
      where: { locationId_name: { locationId: LOCATION_ID, name: product.name } },
      update: {
        categoryId: category.id,
        standardUnit: product.name.includes('Breadsticks') ? 'pieces' : 'crusts',
        batchYield: 1, // 1 ball = 1 crust/product
        yieldPercent: product.yield,
        isBaseIngredient: false,
        isDailyCountItem: true,
        countPrecision: 'whole',
        preparationType: 'Baked',
        visibility: 'visible',
        isActive: true,
        sortOrder: product.sortOrder,
        lowStockThreshold: 5,
        criticalStockThreshold: 2,
      },
      create: {
        locationId: LOCATION_ID,
        name: product.name,
        categoryId: category.id,
        standardUnit: product.name.includes('Breadsticks') ? 'pieces' : 'crusts',
        batchYield: 1,
        yieldPercent: product.yield,
        isBaseIngredient: false,
        isDailyCountItem: true,
        countPrecision: 'whole',
        preparationType: 'Baked',
        visibility: 'visible',
        isActive: true,
        sortOrder: product.sortOrder,
        lowStockThreshold: 5,
        criticalStockThreshold: 2,
      }
    })

    // Add recipe linking to dough ball
    await prisma.ingredientRecipe.upsert({
      where: {
        outputId_componentId: {
          outputId: ing.id,
          componentId: product.ball.id,
        }
      },
      update: { quantity: 1, unit: 'balls' },
      create: {
        locationId: LOCATION_ID,
        outputId: ing.id,
        componentId: product.ball.id,
        quantity: 1,
        unit: 'balls',
      }
    })

    console.log(`  ✓ ${ing.name} (1 ${product.ball.name.split(' ')[0].toLowerCase()} ball → 1 ${ing.standardUnit})`)
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n' + '='.repeat(50))
  console.log('PIZZA INVENTORY STRUCTURE COMPLETE!')
  console.log('='.repeat(50))
  console.log(`
CONVERSION CHAIN:
─────────────────
50 lbs Flour + Water + Yeast + Oil + Salt
    ↓
1 Bulk Dough Batch (~37 kg total dough)
    ↓
Choose ball size based on product:
    ├── 150x Small Balls (250g) → Personal (8"), Small (10"), Breadsticks
    ├── 93x Medium Balls (400g) → Medium (12"), Calzones
    └── 62x Large Balls (600g)  → Large (14"), XL (16")
    ↓
1 Ball = 1 Finished Product (with 90% bake yield)

DAILY COUNT ITEMS:
─────────────────
• Bulk Dough Batch (batches)
• Small/Medium/Large Dough Balls (balls)
• All Pizza Crusts (crusts)
• Breadsticks (pieces)
`)

  await prisma.$disconnect()
}

main()
  .catch((e) => {
    console.error('Error:', e)
    prisma.$disconnect()
    process.exit(1)
  })
