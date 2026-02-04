import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  console.log('=== LIQUOR MENU ITEM CLEANUP ===\n')

  // Get all liquor categories
  const liquorCategories = await db.category.findMany({
    where: { categoryType: 'liquor', deletedAt: null }
  })

  console.log('Liquor categories found:', liquorCategories.map(c => c.name).join(', '))

  // Get all menu items in liquor categories that are NOT linked to a bottle
  const unlinkedItems = await db.menuItem.findMany({
    where: {
      categoryId: { in: liquorCategories.map(c => c.id) },
      deletedAt: null,
      linkedBottleProductId: null
    },
    select: { id: true, name: true, price: true, categoryId: true }
  })

  console.log(`\nFound ${unlinkedItems.length} unlinked liquor menu items (seeded data):`)
  unlinkedItems.forEach(item => {
    const cat = liquorCategories.find(c => c.id === item.categoryId)
    console.log(`  - ${item.name} ($${item.price}) [${cat?.name || 'unknown'}]`)
  })

  // Soft-delete all unlinked items
  if (unlinkedItems.length > 0) {
    const result = await db.menuItem.updateMany({
      where: {
        id: { in: unlinkedItems.map(i => i.id) }
      },
      data: {
        deletedAt: new Date()
      }
    })

    console.log(`\n✅ Soft-deleted ${result.count} seeded menu items`)
  } else {
    console.log('\nNo items to delete')
  }

  // Now show what bottles exist that could become menu items
  const bottles = await db.bottleProduct.findMany({
    where: { deletedAt: null },
    include: { spiritCategory: true, linkedMenuItems: { where: { deletedAt: null } } },
    orderBy: [{ spiritCategory: { name: 'asc' } }, { tier: 'asc' }, { name: 'asc' }]
  })

  console.log(`\n=== BOTTLES AVAILABLE (${bottles.length}) ===`)
  let currentCategory = ''
  bottles.forEach(b => {
    if (b.spiritCategory.name !== currentCategory) {
      currentCategory = b.spiritCategory.name
      console.log(`\n${currentCategory}:`)
    }
    const hasMenuItem = b.linkedMenuItems.length > 0
    console.log(`  ${hasMenuItem ? '✓' : '○'} ${b.name} (${b.tier}) - cost: $${b.unitCost} ${hasMenuItem ? '→ Menu item exists' : ''}`)
  })

  console.log('\n=== CLEANUP COMPLETE ===')
}

main().catch(console.error).finally(() => db.$disconnect())
