// Migration 083: Add noneShowOnReceipt to ModifierGroup and OrderItemModifier
// Controls whether "None" selections appear on customer receipts

async function up(prisma) {
  // ModifierGroup column
  const hasGroupCol = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ModifierGroup' AND column_name = 'noneShowOnReceipt'
  `)
  if (hasGroupCol.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierGroup"
      ADD COLUMN "noneShowOnReceipt" BOOLEAN NOT NULL DEFAULT false
    `)
  }

  // OrderItemModifier column — snapshot at order creation time
  const hasModCol = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'OrderItemModifier' AND column_name = 'noneShowOnReceipt'
  `)
  if (hasModCol.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItemModifier"
      ADD COLUMN "noneShowOnReceipt" BOOLEAN NOT NULL DEFAULT false
    `)
  }
}

module.exports = { up }
