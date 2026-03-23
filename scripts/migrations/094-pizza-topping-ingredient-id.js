/** Add ingredientId to all pizza component tables for ingredient library linking,
 *  and lastMutatedBy to all 7 pizza tables for bidirectional sync. */
exports.up = async function up(prisma) {
  const tables = ['PizzaTopping', 'PizzaSize', 'PizzaCrust', 'PizzaSauce', 'PizzaCheese']
  for (const table of tables) {
    const exists = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = '${table}' AND column_name = 'ingredientId'
    `)
    if (exists.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "ingredientId" TEXT`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${table}_ingredientId_idx" ON "${table}" ("ingredientId")`)
    }
  }

  // Add lastMutatedBy to all 7 pizza tables for bidirectional sync support
  const allPizzaTables = ['PizzaConfig', 'PizzaTopping', 'PizzaSize', 'PizzaCrust', 'PizzaSauce', 'PizzaCheese', 'PizzaSpecialty']
  for (const table of allPizzaTables) {
    const hasMutatedBy = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = '${table}' AND column_name = 'lastMutatedBy'
    `)
    if (hasMutatedBy.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "lastMutatedBy" TEXT`)
    }
  }
}
