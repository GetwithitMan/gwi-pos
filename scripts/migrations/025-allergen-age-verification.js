/** Add allergen tracking and age verification columns to MenuItem */
async function up(prisma) {
  // Helper: check if column exists
  async function columnExists(table, column) {
    const cols = await prisma.$queryRawUnsafe(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = '${table}' AND column_name = '${column}'
    `)
    return cols.length > 0
  }

  // Add allergens TEXT[] DEFAULT '{}' to MenuItem
  if (!(await columnExists('MenuItem', 'allergens'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MenuItem" ADD COLUMN "allergens" TEXT[] DEFAULT '{}'
    `)
  }

  // Add isAgeRestricted BOOLEAN DEFAULT false to MenuItem
  if (!(await columnExists('MenuItem', 'isAgeRestricted'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MenuItem" ADD COLUMN "isAgeRestricted" BOOLEAN DEFAULT false NOT NULL
    `)
  }
}

module.exports = { up }
