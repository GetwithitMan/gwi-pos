/**
 * Migration 116: Account Updater PID + Decline Category
 *
 * Alters:
 * - Membership: adds accountUpdaterPid (PID returned by Datacap Account Updater)
 * - SavedCard: adds accountUpdaterPid for standalone saved card token refresh
 * - MembershipCharge: adds declineCategory (hard_decline | soft_decline | processor_error | config_error | unknown)
 *
 * The PID is a special Datacap token that auto-refreshes card data twice monthly.
 * When present, billing uses the PID instead of the raw DC4 token.
 *
 * declineCategory enables dashboard filtering without parsing event JSON.
 */

async function columnExists(prisma, table, column) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2
    LIMIT 1
  `, table, column)
  return rows.length > 0
}

module.exports.up = async function up(prisma) {
  // ── Membership.accountUpdaterPid ──────────────────────────────────────────
  if (!(await columnExists(prisma, 'Membership', 'accountUpdaterPid'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Membership" ADD COLUMN "accountUpdaterPid" TEXT
    `)
    console.log('[116] Added Membership.accountUpdaterPid')
  }

  // ── SavedCard.accountUpdaterPid ──────────────────────────────────────────
  if (!(await columnExists(prisma, 'SavedCard', 'accountUpdaterPid'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "SavedCard" ADD COLUMN "accountUpdaterPid" TEXT
    `)
    console.log('[116] Added SavedCard.accountUpdaterPid')
  }

  // ── MembershipCharge.declineCategory ─────────────────────────────────────
  if (!(await columnExists(prisma, 'MembershipCharge', 'declineCategory'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MembershipCharge" ADD COLUMN "declineCategory" TEXT
    `)
    console.log('[116] Added MembershipCharge.declineCategory')
  }
}
