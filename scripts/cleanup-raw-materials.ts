/**
 * Cleanup Script: Organize raw materials in the Ingredient Library
 *
 * The IngredientRecipe model links Ingredient → Ingredient (not Ingredient → InventoryItem)
 * So we keep raw materials as Ingredients but:
 * 1. Mark them as visibility: 'admin_only' (hidden from POS)
 * 2. Create recipe links from Pizza Dough to its components
 * 3. Also create InventoryItems for purchasing/stock tracking
 *
 * Run with: npx tsx scripts/cleanup-raw-materials.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const locationId = 'loc-1'

  console.log('🧹 Organizing raw materials...\n')

  // 1. Create InventoryItems for raw materials (for purchasing/stock tracking)
  const rawMaterials = [
    {
      id: 'inv-flour',
      name: 'All-Purpose Flour',
      category: 'dry_goods',
      department: 'Food',
      itemType: 'food',
      purchaseUnit: 'bag',
      purchaseSize: 50,
      purchaseCost: 22.99,
      storageUnit: 'lb',
      unitsPerPurchase: 50,
    },
    {
      id: 'inv-yeast',
      name: 'Active Dry Yeast',
      category: 'dry_goods',
      department: 'Food',
      itemType: 'food',
      purchaseUnit: 'lb',
      purchaseSize: 1,
      purchaseCost: 5.99,
      storageUnit: 'oz',
      unitsPerPurchase: 16,
    },
    {
      id: 'inv-salt',
      name: 'Kosher Salt',
      category: 'dry_goods',
      department: 'Food',
      itemType: 'food',
      purchaseUnit: 'box',
      purchaseSize: 3,
      purchaseCost: 4.99,
      storageUnit: 'oz',
      unitsPerPurchase: 48,
    },
    {
      id: 'inv-olive-oil',
      name: 'Olive Oil',
      category: 'oils',
      department: 'Food',
      itemType: 'food',
      purchaseUnit: 'gallon',
      purchaseSize: 1,
      purchaseCost: 15.99,
      storageUnit: 'oz',
      unitsPerPurchase: 128,
    },
  ]

  console.log('📦 Creating/updating Inventory Items (for purchasing)...')
  for (const item of rawMaterials) {
    const existing = await prisma.inventoryItem.findFirst({
      where: { locationId, name: item.name }
    })

    if (existing) {
      console.log(`   ✓ ${item.name} already exists`)
    } else {
      const costPerUnit = item.purchaseCost / item.unitsPerPurchase
      await prisma.inventoryItem.create({
        data: {
          id: item.id,
          locationId,
          name: item.name,
          category: item.category,
          department: item.department,
          itemType: item.itemType,
          revenueCenter: 'kitchen',
          purchaseUnit: item.purchaseUnit,
          purchaseSize: item.purchaseSize,
          purchaseCost: item.purchaseCost,
          storageUnit: item.storageUnit,
          unitsPerPurchase: item.unitsPerPurchase,
          costPerUnit,
          currentStock: 100,
          trackInventory: true,
        }
      })
      console.log(`   ✓ Created ${item.name}`)
    }
  }

  // 2. Find Pizza Dough and raw material ingredients
  const pizzaDough = await prisma.ingredient.findFirst({
    where: { locationId, name: 'Pizza Dough', deletedAt: null }
  })

  if (!pizzaDough) {
    console.log('\n⚠️  Pizza Dough ingredient not found.')
    return
  }

  console.log(`\n🍕 Found Pizza Dough: ${pizzaDough.id}`)

  // Find raw material ingredients
  const rawIngredientNames = [
    { name: 'Active Dry Yeast', quantity: 0.5, unit: 'oz' },
    { name: 'Kosher Salt', quantity: 1, unit: 'oz' },
    { name: 'Olive Oil', quantity: 2, unit: 'oz' },
    { name: 'Pizza Dough Flour', quantity: 2, unit: 'lb' },
  ]

  // 3. Update raw materials: hide from POS (admin_only) and link to inventory
  console.log('\n🔧 Updating raw material Ingredients...')

  for (const raw of rawIngredientNames) {
    const ingredient = await prisma.ingredient.findFirst({
      where: { locationId, name: raw.name, deletedAt: null }
    })

    if (ingredient) {
      // Find matching inventory item
      const invName = raw.name === 'Pizza Dough Flour' ? 'All-Purpose Flour' : raw.name
      const inventoryItem = await prisma.inventoryItem.findFirst({
        where: { locationId, name: invName }
      })

      await prisma.ingredient.update({
        where: { id: ingredient.id },
        data: {
          visibility: 'admin_only', // Hidden from POS
          inventoryItemId: inventoryItem?.id || null, // Link to inventory for costing
        }
      })
      console.log(`   ✓ "${raw.name}" → visibility: admin_only${inventoryItem ? ', linked to inventory' : ''}`)

      // 4. Create recipe link if doesn't exist
      const existingRecipe = await prisma.ingredientRecipe.findFirst({
        where: { outputId: pizzaDough.id, componentId: ingredient.id }
      })

      if (!existingRecipe) {
        await prisma.ingredientRecipe.create({
          data: {
            locationId,
            outputId: pizzaDough.id,
            componentId: ingredient.id,
            quantity: raw.quantity,
            unit: raw.unit,
            batchSize: 4,
            batchUnit: 'dough balls',
          }
        })
        console.log(`      → Recipe link created: Pizza Dough uses ${raw.quantity} ${raw.unit} of ${raw.name}`)
      } else {
        console.log(`      → Recipe link already exists`)
      }
    } else {
      console.log(`   - "${raw.name}" not found`)
    }
  }

  console.log('\n✅ Cleanup complete!')
  console.log('\nSummary:')
  console.log('- Raw materials (Flour, Yeast, Salt, Oil) are in the INVENTORY SYSTEM for purchasing')
  console.log('- Raw material Ingredients are now visibility: admin_only (hidden from POS)')
  console.log('- Raw material Ingredients are linked to their InventoryItems for costing')
  console.log('- Pizza Dough has recipe links to its components')
  console.log('\nThe POS will only show customer-facing ingredients (like Pizza Dough, toppings, etc.)')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
