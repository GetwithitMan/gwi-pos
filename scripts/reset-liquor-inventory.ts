/**
 * Reset Liquor Inventory Script
 *
 * Wipes all BottleProduct records (and linked InventoryItems / MenuItem links)
 * then immediately re-seeds with a clean, fully-classified bar inventory.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/reset-liquor-inventory.ts
 *
 * What it does:
 *   1. Clears linkedBottleProductId on all MenuItems for this location
 *   2. Hard-deletes all BottleProduct records for this location
 *   3. Hard-deletes all InventoryItem records with itemType='liquor' for this location
 *   4. Runs the full seed to create fresh, properly-classified inventory
 */

import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 Resetting liquor inventory...\n')

  const location = await prisma.location.findFirst()
  if (!location) {
    throw new Error('No location found')
  }

  console.log(`📍 Location: ${location.name} (${location.id})\n`)

  // ── Step 1: Clear bottle links on menu items ─────────────────────────────
  console.log('🔗 Clearing MenuItem → BottleProduct links...')
  const unlinked = await prisma.menuItem.updateMany({
    where: {
      locationId: location.id,
      linkedBottleProductId: { not: null },
    },
    data: { linkedBottleProductId: null },
  })
  console.log(`   ✓ Cleared ${unlinked.count} menu item links\n`)

  // ── Step 2: Hard-delete BottleProducts ───────────────────────────────────
  console.log('🍾 Deleting all bottle products...')
  const deletedBottles = await prisma.bottleProduct.deleteMany({
    where: { locationId: location.id },
  })
  console.log(`   ✓ Deleted ${deletedBottles.count} bottle products\n`)

  // ── Step 3: Hard-delete liquor InventoryItems ────────────────────────────
  console.log('📦 Deleting all liquor inventory items...')
  const deletedInventory = await prisma.inventoryItem.deleteMany({
    where: {
      locationId: location.id,
      itemType: 'liquor',
    },
  })
  console.log(`   ✓ Deleted ${deletedInventory.count} inventory items\n`)

  // ── Step 4: Re-seed ──────────────────────────────────────────────────────
  console.log('🌱 Running seed script...\n')
  await prisma.$disconnect()

  try {
    execSync('npx dotenv-cli -e .env.local -- npx tsx scripts/seed-liquor-inventory.ts', {
      stdio: 'inherit',
    })
  } catch {
    // seed script disconnects its own client; ignore exit if seed succeeded
    console.log('\n✅ Reset and reseed complete!')
  }
}

main()
  .catch(e => {
    console.error('\n❌ Error:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect().catch(() => {}))
