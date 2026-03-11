/**
 * Migration 039: Customer Profile Fields
 *
 * Adds dedicated columns to Customer for allergy tracking and food/drink preferences.
 * These were previously stored informally in the `notes` field.
 */

async function columnExists(prisma, table, column) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2
    LIMIT 1
  `, table, column)
  return rows.length > 0
}

module.exports.up = async function up(prisma) {
  if (!(await columnExists(prisma, 'Customer', 'allergies'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "allergies" TEXT`)
    console.log('[039] Added Customer.allergies')
  }

  if (!(await columnExists(prisma, 'Customer', 'favoriteDrink'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "favoriteDrink" TEXT`)
    console.log('[039] Added Customer.favoriteDrink')
  }

  if (!(await columnExists(prisma, 'Customer', 'favoriteFood'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN "favoriteFood" TEXT`)
    console.log('[039] Added Customer.favoriteFood')
  }
}
