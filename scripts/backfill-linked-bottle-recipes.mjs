/**
 * backfill-linked-bottle-recipes.mjs
 *
 * One-time script: finds all MenuItems with a linkedBottleProductId
 * but NO RecipeIngredient entries, and creates a 1-pour recipe for each.
 *
 * Run: node --env-file=.env.local scripts/backfill-linked-bottle-recipes.mjs
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const LOCATION_ID = 'loc-1'

async function main() {
  const itemsWithoutRecipes = await prisma.menuItem.findMany({
    where: {
      locationId: LOCATION_ID,
      linkedBottleProductId: { not: null },
      recipeIngredients: { none: {} },
      deletedAt: null,
    },
    select: { id: true, name: true, locationId: true, linkedBottleProductId: true },
  })

  console.log(`Found ${itemsWithoutRecipes.length} linked items without recipes:`)
  for (const item of itemsWithoutRecipes) {
    console.log(`  - ${item.name} → bottle ${item.linkedBottleProductId}`)
  }

  if (itemsWithoutRecipes.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  let created = 0
  for (const item of itemsWithoutRecipes) {
    await prisma.recipeIngredient.create({
      data: {
        locationId: item.locationId,
        menuItemId: item.id,
        bottleProductId: item.linkedBottleProductId,
        pourCount: 1,
        isSubstitutable: true,
        sortOrder: 0,
      },
    })
    created++
    console.log(`  ✓ Created recipe for "${item.name}"`)
  }

  console.log(`\nDone. Created ${created} recipe ingredients.`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
