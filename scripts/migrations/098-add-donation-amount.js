// Migration 098: Add donationAmount column to Order table
// Supports optional donation tracking on orders

async function up(prisma) {
  const columnExists = async (table, column) => {
    const result = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      table,
      column
    )
    return result.length > 0
  }

  if (!(await columnExists('Order', 'donationAmount'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Order" ADD COLUMN "donationAmount" DECIMAL(10, 2)`
    )
    console.log('  Added Order.donationAmount column')
  } else {
    console.log('  Order.donationAmount already exists, skipping')
  }
}

module.exports = { up }
