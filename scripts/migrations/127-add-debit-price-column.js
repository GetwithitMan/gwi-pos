module.exports = { up: async (prisma) => {
  const exists = await prisma.$queryRawUnsafe(`SELECT 1 FROM information_schema.columns WHERE table_name = 'OrderItem' AND column_name = 'debitPrice'`)
  if (exists.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OrderItem" ADD COLUMN "debitPrice" DECIMAL(10,2)`)
  }
}}
