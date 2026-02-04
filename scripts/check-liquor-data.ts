import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  // Get tequila category
  const tequilaCat = await db.category.findFirst({
    where: { name: { contains: 'Tequila' } }
  })
  console.log('=== TEQUILA CATEGORY ===')
  console.log(tequilaCat?.id, tequilaCat?.name)

  // Get menu items in tequila category
  const menuItems = await db.menuItem.findMany({
    where: { categoryId: tequilaCat?.id, deletedAt: null },
    select: { id: true, name: true, price: true }
  })
  console.log('\n=== TEQUILA MENU ITEMS (' + menuItems.length + ') ===')
  menuItems.forEach(m => console.log(`  ${m.name} - $${m.price}`))

  // Get tequila spirit category
  const spiritCat = await db.spiritCategory.findFirst({
    where: { name: { contains: 'Tequila' } }
  })
  console.log('\n=== TEQUILA SPIRIT CATEGORY ===')
  console.log(spiritCat?.id, spiritCat?.name)

  // Get bottle products for tequila
  const bottles = await db.bottleProduct.findMany({
    where: { spiritCategoryId: spiritCat?.id, deletedAt: null },
    select: { id: true, name: true, tier: true, unitCost: true, pourCost: true }
  })
  console.log('\n=== TEQUILA BOTTLES (' + bottles.length + ') ===')
  bottles.forEach(b => console.log(`  ${b.name} (${b.tier}) - cost: $${b.unitCost}, pour: $${b.pourCost}`))

  // Check MenuItem schema for bottle link field
  console.log('\n=== CHECKING MENUITEM SCHEMA ===')
  const sampleItem = await db.menuItem.findFirst({
    select: { id: true, name: true }
  })
  console.log('Sample MenuItem keys:', Object.keys(sampleItem || {}))

  // Check if any modifiers link to bottles
  const linkedMods = await db.modifier.findMany({
    where: { linkedBottleProductId: { not: null } },
    select: { id: true, name: true, linkedBottleProductId: true }
  })
  console.log('\n=== MODIFIERS LINKED TO BOTTLES (' + linkedMods.length + ') ===')
  linkedMods.slice(0, 5).forEach(m => console.log(`  ${m.name} -> ${m.linkedBottleProductId}`))
}

main().catch(console.error).finally(() => db.$disconnect())
