/**
 * Migration 034: Add Datacap token metadata fields
 *
 * Adds fields to OrderCard and Payment for full ByRecordNo operation support,
 * chargeback defense, and Recurring token tracking.
 */
const { columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[034-datacap-token-fields]'

  // OrderCard fields
  const orderCardFields = [
    ['tokenFrequency', 'TEXT'],
    ['acqRefData', 'TEXT'],
    ['processData', 'TEXT'],
    ['aid', 'TEXT'],
    ['cvm', 'TEXT'],
    ['avsResult', 'TEXT'],
    ['authCode', 'TEXT'],
    ['refNo', 'TEXT'],
  ]

  for (const [col, type] of orderCardFields) {
    if (!(await columnExists(prisma, 'OrderCard', col))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "OrderCard" ADD COLUMN "${col}" ${type}`)
    }
  }
  console.log(`${PREFIX} Added Datacap token metadata fields to OrderCard`)

  // Payment fields
  const paymentFields = [
    ['acqRefData', 'TEXT'],
    ['processData', 'TEXT'],
    ['aid', 'TEXT'],
    ['cvmResult', 'TEXT'],
    ['avsResult', 'TEXT'],
    ['level2Status', 'TEXT'],
    ['tokenFrequency', 'TEXT'],
  ]

  for (const [col, type] of paymentFields) {
    if (!(await columnExists(prisma, 'Payment', col))) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Payment" ADD COLUMN "${col}" ${type}`)
    }
  }
  console.log(`${PREFIX} Added Datacap token metadata fields to Payment`)
}

module.exports = { up }
