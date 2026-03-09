const { enumValueExists } = require('../migration-helpers')

async function up(prisma) {
  const exists = await enumValueExists(prisma, 'OrderCardStatus', 'released')
  if (!exists) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "OrderCardStatus" ADD VALUE IF NOT EXISTS 'released'`)
  }
}

module.exports = { up }
