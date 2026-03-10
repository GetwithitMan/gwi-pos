async function up(prisma) {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "MenuItemDailyMetrics"`);
}

module.exports = { up };
