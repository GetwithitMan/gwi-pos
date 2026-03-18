// Migration 079: Add allowNone + nonePrintsToKitchen to ModifierGroup
// and isNoneSelection to OrderItemModifier
// Supports "None" button on required modifier groups in POS

async function up(prisma) {
  // ModifierGroup columns
  const hasAllowNone = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ModifierGroup' AND column_name = 'allowNone'
  `)
  if (hasAllowNone.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierGroup"
      ADD COLUMN "allowNone" BOOLEAN NOT NULL DEFAULT false
    `)
  }

  const hasNonePrints = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ModifierGroup' AND column_name = 'nonePrintsToKitchen'
  `)
  if (hasNonePrints.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierGroup"
      ADD COLUMN "nonePrintsToKitchen" BOOLEAN NOT NULL DEFAULT false
    `)
  }

  // OrderItemModifier column
  const hasIsNone = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'OrderItemModifier' AND column_name = 'isNoneSelection'
  `)
  if (hasIsNone.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItemModifier"
      ADD COLUMN "isNoneSelection" BOOLEAN NOT NULL DEFAULT false
    `)
  }
}

module.exports = { up }
