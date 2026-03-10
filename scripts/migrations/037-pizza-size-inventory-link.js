// Migration 037: Add inventoryItemId, usageQuantity, usageUnit to PizzaSize
// Allows sizes to be linked to inventory items (e.g., dough balls) just like crusts/sauces/cheeses/toppings
async function up(prisma) {
  const columnExists = async (table, column) => {
    const result = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      table, column
    )
    return result.length > 0
  }

  if (!(await columnExists('PizzaSize', 'inventoryItemId'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "PizzaSize"
      ADD COLUMN "inventoryItemId" TEXT,
      ADD COLUMN "usageQuantity" DECIMAL,
      ADD COLUMN "usageUnit" TEXT
    `)
    console.log('  Added inventoryItemId, usageQuantity, usageUnit to PizzaSize')
  } else {
    console.log('  PizzaSize inventory columns already exist, skipping')
  }
}

module.exports = { up }
