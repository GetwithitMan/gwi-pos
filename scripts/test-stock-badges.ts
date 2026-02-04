/**
 * Test script for stock badges implementation
 *
 * This script verifies that stock status calculation works correctly
 * for menu items based on their prep ingredient stock levels.
 *
 * Run with: npx tsx scripts/test-stock-badges.ts
 */

import { db } from '../src/lib/db'
import { getMenuItemStockStatus, getAllMenuItemsStockStatus } from '../src/lib/stock-status'

async function testStockBadges() {
  console.log('\n🧪 Testing Stock Badge Implementation\n')

  // Get first location
  const location = await db.location.findFirst()
  if (!location) {
    console.error('❌ No location found')
    return
  }

  console.log(`📍 Location: ${location.name} (${location.id})\n`)

  // Get all menu items with ingredients
  const menuItems = await db.menuItem.findMany({
    where: {
      locationId: location.id,
      deletedAt: null,
      isActive: true,
    },
    include: {
      ingredients: {
        where: {
          deletedAt: null,
          ingredient: {
            locationId: location.id,
            deletedAt: null,
            isDailyCountItem: true,
          },
        },
        include: {
          ingredient: true,
        },
      },
    },
  })

  const itemsWithPrepIngredients = menuItems.filter(
    (item) => item.ingredients.length > 0 && item.ingredients.some((link) => link.ingredient)
  )

  console.log(`📦 Found ${menuItems.length} total menu items`)
  console.log(`🥗 Found ${itemsWithPrepIngredients.length} items with prep ingredients\n`)

  if (itemsWithPrepIngredients.length === 0) {
    console.log('⚠️  No menu items with prep ingredients found.')
    console.log('   To test stock badges, you need to:')
    console.log('   1. Create some ingredients with isDailyCountItem = true')
    console.log('   2. Link them to menu items via MenuItemIngredient')
    console.log('   3. Set currentPrepStock, lowStockThreshold, criticalStockThreshold\n')
    return
  }

  // Test individual item stock status
  console.log('🔍 Testing individual item stock status...\n')

  for (const item of itemsWithPrepIngredients.slice(0, 5)) {
    const status = await getMenuItemStockStatus(item.id, location.id)

    console.log(`📝 ${item.name}:`)
    console.log(`   Status: ${status.status}`)
    console.log(`   Lowest Count: ${status.lowestCount ?? 'N/A'}`)
    console.log(`   Lowest Ingredient: ${status.lowestIngredientName ?? 'N/A'}`)
    console.log(`   Critical Ingredients: ${status.criticalIngredients.length}`)

    for (const ing of item.ingredients) {
      if (ing.ingredient) {
        console.log(
          `   - ${ing.ingredient.name}: ${ing.ingredient.currentPrepStock} (low: ${ing.ingredient.lowStockThreshold ?? 10}, critical: ${ing.ingredient.criticalStockThreshold ?? 5})`
        )
      }
    }

    console.log()
  }

  // Test bulk stock status
  console.log('🔍 Testing bulk stock status calculation...\n')

  const bulkStatus = await getAllMenuItemsStockStatus(location.id)

  console.log(`📊 Bulk status results: ${bulkStatus.size} items\n`)

  // Summary by status
  const statusCounts = {
    ok: 0,
    low: 0,
    critical: 0,
    out: 0,
  }

  for (const [itemId, status] of bulkStatus) {
    statusCounts[status.status]++
  }

  console.log('📈 Status Distribution:')
  console.log(`   ✅ OK: ${statusCounts.ok}`)
  console.log(`   🟡 LOW: ${statusCounts.low}`)
  console.log(`   🔴 CRITICAL: ${statusCounts.critical}`)
  console.log(`   ⛔ OUT: ${statusCounts.out}`)
  console.log()

  // Show critical items
  const criticalItems = Array.from(bulkStatus.entries())
    .filter(([_, status]) => status.status === 'critical' || status.status === 'out')
    .slice(0, 5)

  if (criticalItems.length > 0) {
    console.log('🚨 Critical/Out of Stock Items:')
    for (const [itemId, status] of criticalItems) {
      const item = menuItems.find((i) => i.id === itemId)
      console.log(`   - ${item?.name}: ${status.status} (${status.lowestIngredientName}: ${status.lowestCount})`)
    }
    console.log()
  }

  // Test recommendations
  console.log('💡 Test Recommendations:\n')
  console.log('   1. Visit http://localhost:3000/orders and view the menu')
  console.log('   2. Look for stock badges on menu items (amber/red)')
  console.log('   3. Adjust ingredient stock levels at /inventory/quick-adjust')
  console.log('   4. Refresh menu to see badges update')
  console.log('   5. Test with different threshold values\n')

  console.log('✅ Stock badge tests complete!\n')
}

testStockBadges()
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })
  .finally(() => {
    db.$disconnect()
  })
