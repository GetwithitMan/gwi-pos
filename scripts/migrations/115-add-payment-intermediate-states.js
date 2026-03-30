const { enumValueExists } = require('../migration-helpers')

const PREFIX = '[115]'

/**
 * Add intermediate payment states to the PaymentStatus enum:
 *   - processing: submitted to processor, awaiting response
 *   - declined:   processor declined the charge
 *   - failed:     unrecoverable processor/network error
 *
 * These enable the payment state machine to track in-flight processor calls
 * and terminal error states instead of collapsing everything into pending/completed.
 */
module.exports.up = async function up(prisma) {
  const newValues = ['processing', 'declined', 'failed']

  for (const val of newValues) {
    if (!(await enumValueExists(prisma, 'PaymentStatus', val))) {
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS '${val}'`
      )
      console.log(`${PREFIX} Added '${val}' to PaymentStatus enum`)
    } else {
      console.log(`${PREFIX} PaymentStatus.${val} already exists`)
    }
  }
}
