/**
 * Migration 092 — Fix remaining sync column gaps found by senior team audit
 *
 * 5 models still missing required sync columns:
 * - Terminal: lastMutatedBy (bidirectional conflict detection)
 * - PmsChargeAttempt: syncedAt (upstream sync tracking)
 * - ReservationEvent: updatedAt + syncedAt (upstream sync)
 * - VenueLog: updatedAt + syncedAt (upstream sync)
 * - DeductionRun: syncedAt + updatedAt (upstream sync tracking)
 */

async function up(prisma) {
  const additions = [
    // [table, column, type]
    ['Terminal', 'lastMutatedBy', 'TEXT'],
    ['PmsChargeAttempt', 'syncedAt', 'TIMESTAMPTZ'],
    ['ReservationEvent', 'updatedAt', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()'],
    ['ReservationEvent', 'syncedAt', 'TIMESTAMPTZ'],
    ['VenueLog', 'updatedAt', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()'],
    ['VenueLog', 'syncedAt', 'TIMESTAMPTZ'],
    ['DeductionRun', 'syncedAt', 'TIMESTAMPTZ'],
    ['DeductionRun', 'updatedAt', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()'],
  ]

  for (const [table, column, type] of additions) {
    const cols = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      table, column
    )
    if (cols.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`)
    }
  }
}

module.exports = { up }
