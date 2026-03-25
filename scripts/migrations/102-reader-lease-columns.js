/**
 * Migration 102 — Add reader lease columns to PaymentReader
 *
 * Supports passive card detection (Always-Listening Card Reader).
 * Only ONE terminal can listen on a reader at a time, enforced via DB lease + fencing.
 *
 * PaymentReader:
 *   + leaseTerminalId (TEXT, nullable) — which terminal owns the lease
 *   + leaseSessionId (TEXT, nullable) — unique session UUID
 *   + leaseVersion (INT, NOT NULL, default 0) — fencing token
 *   + leasedUntil (TIMESTAMP, nullable) — expires if terminal dies
 *   + lastHeartbeatAt (TIMESTAMP, nullable) — tracks liveness
 *   + lastDetectionFingerprint (TEXT, nullable) — last detected recordNo (shared suppression)
 *   + lastDetectionAt (TIMESTAMP, nullable) — when last card was detected
 *   + readerState (TEXT, NOT NULL, default 'idle') — offline | idle | listening | busy | error_backoff
 */

const { columnExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[102]'

  // PaymentReader: leaseTerminalId
  if (!(await columnExists(prisma, 'PaymentReader', 'leaseTerminalId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentReader" ADD COLUMN "leaseTerminalId" TEXT`)
    console.log(`${PREFIX} Added PaymentReader.leaseTerminalId`)
  } else {
    console.log(`${PREFIX} PaymentReader.leaseTerminalId already exists`)
  }

  // PaymentReader: leaseSessionId
  if (!(await columnExists(prisma, 'PaymentReader', 'leaseSessionId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentReader" ADD COLUMN "leaseSessionId" TEXT`)
    console.log(`${PREFIX} Added PaymentReader.leaseSessionId`)
  } else {
    console.log(`${PREFIX} PaymentReader.leaseSessionId already exists`)
  }

  // PaymentReader: leaseVersion (NOT NULL with default)
  if (!(await columnExists(prisma, 'PaymentReader', 'leaseVersion'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentReader" ADD COLUMN "leaseVersion" INTEGER NOT NULL DEFAULT 0`)
    console.log(`${PREFIX} Added PaymentReader.leaseVersion`)
  } else {
    console.log(`${PREFIX} PaymentReader.leaseVersion already exists`)
  }

  // PaymentReader: leasedUntil
  if (!(await columnExists(prisma, 'PaymentReader', 'leasedUntil'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentReader" ADD COLUMN "leasedUntil" TIMESTAMP(3)`)
    console.log(`${PREFIX} Added PaymentReader.leasedUntil`)
  } else {
    console.log(`${PREFIX} PaymentReader.leasedUntil already exists`)
  }

  // PaymentReader: lastHeartbeatAt
  if (!(await columnExists(prisma, 'PaymentReader', 'lastHeartbeatAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentReader" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3)`)
    console.log(`${PREFIX} Added PaymentReader.lastHeartbeatAt`)
  } else {
    console.log(`${PREFIX} PaymentReader.lastHeartbeatAt already exists`)
  }

  // PaymentReader: lastDetectionFingerprint
  if (!(await columnExists(prisma, 'PaymentReader', 'lastDetectionFingerprint'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentReader" ADD COLUMN "lastDetectionFingerprint" TEXT`)
    console.log(`${PREFIX} Added PaymentReader.lastDetectionFingerprint`)
  } else {
    console.log(`${PREFIX} PaymentReader.lastDetectionFingerprint already exists`)
  }

  // PaymentReader: lastDetectionAt
  if (!(await columnExists(prisma, 'PaymentReader', 'lastDetectionAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentReader" ADD COLUMN "lastDetectionAt" TIMESTAMP(3)`)
    console.log(`${PREFIX} Added PaymentReader.lastDetectionAt`)
  } else {
    console.log(`${PREFIX} PaymentReader.lastDetectionAt already exists`)
  }

  // PaymentReader: readerState (NOT NULL with default)
  if (!(await columnExists(prisma, 'PaymentReader', 'readerState'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentReader" ADD COLUMN "readerState" TEXT NOT NULL DEFAULT 'idle'`)
    console.log(`${PREFIX} Added PaymentReader.readerState`)
  } else {
    console.log(`${PREFIX} PaymentReader.readerState already exists`)
  }

  console.log(`${PREFIX} Migration 102 complete — reader lease columns added`)
}
